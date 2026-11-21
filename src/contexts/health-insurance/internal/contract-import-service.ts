/**
 * P2.7 — importação da tabela contratual: validar (prévia) e aplicar.
 *
 * Política (mostrada ao usuário antes da confirmação): **atômica**. A planilha só é aplicada
 * inteira; uma linha com erro impede a aplicação (corrige e envia de novo). Linha idêntica ao
 * item vigente é "sem mudança" e não impede nada. Reenviar a mesma planilha já aplicada é recusado
 * (sha256 por operadora), então nada é criado em duplicidade.
 *
 * Mesma regra da tela, sem segunda implementação: cada linha passa por `createContractLineTx`
 * (item novo) ou `reviseContractLineTx` no modo reajuste a partir de uma data (o item vigente vale
 * até a véspera; o passado e as guias emitidas não mudam). TUSS da tabela oficial válido na data,
 * plano ativo da operadora, procedimento do catálogo da clínica, sobreposição, coparticipação e as
 * travas de concorrência vêm de lá.
 *
 * Validar = a mesma sequência numa transação que é DESFEITA no fim (cada linha num ponto de
 * salvamento, o erro registrado). Aplicar = a mesma sequência numa transação real que só confirma
 * sem nenhum erro. A planilha normalizada fica no registro da importação (sem dado pessoal: só
 * contrato), então aplicar não depende de reenviar o arquivo.
 */
import 'server-only';

import { createHash } from 'node:crypto';

import { and, desc, eq, sql } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import type { RequestContext } from '@/lib/audit/types';
import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';

import { hiContractImports, hiPlans } from '../schema-clinic';
import {
  ContractImportFileError,
  normalizeContractSheet,
  readContractSpreadsheet,
  type ContractImportRow,
} from './contract-import';
import {
  InsuranceConfigError,
  createContractLineTx,
  reviseContractLineTx,
  type ContractTermsInput,
} from './config-service';

export type ContractImportAction = 'create' | 'adjust' | 'unchanged' | 'error';

export interface ContractImportRowResult {
  line: number;
  action: ContractImportAction;
  procedureCode: string | null;
  guideType: string | null;
  planName: string | null;
  validFrom: string | null;
  unitValueCents: number | null;
  messages: string[];
}

export interface ContractImportPreview {
  importId: string;
  status: 'validated' | 'rejected';
  policy: 'atomic';
  fileName: string;
  counts: { rows: number; create: number; adjust: number; unchanged: number; error: number };
  missingColumns: string[];
  unknownColumns: string[];
  /** Até 500 linhas para a tela (o registro guarda todas). */
  rows: ContractImportRowResult[];
  /** A mesma planilha já foi aplicada nesta operadora (nada seria feito de novo). */
  alreadyAppliedAt: string | null;
}

export class ContractImportError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ContractImportError';
  }
}

class DryRun extends Error {
  constructor(readonly results: ContractImportRowResult[]) {
    super('validação (desfeita)');
  }
}

type Row = Record<string, unknown>;

const termsOf = (r: ContractImportRow): ContractTermsInput => ({
  unitValueCents: r.unitValueCents,
  requiresAuthorization: r.requiresAuthorization,
  copayKind: r.copayKind,
  copayFixedCents: r.copayFixedCents,
  copayPercentage: r.copayPercentage,
  returnDays: r.returnDays,
  returnBillable: r.returnDays === null ? false : r.returnBillable,
});

function sameTerms(cur: Row, r: ContractImportRow, procedureId: string): boolean {
  const pct = (v: unknown) => (v === null || v === undefined ? null : Number(v).toFixed(2));
  return (
    Number(cur.unit_value_cents) === r.unitValueCents &&
    Boolean(cur.requires_authorization) === r.requiresAuthorization &&
    String(cur.copay_kind) === r.copayKind &&
    (cur.copay_fixed_cents === null ? null : Number(cur.copay_fixed_cents)) === r.copayFixedCents &&
    pct(cur.copay_percentage) === pct(r.copayPercentage) &&
    (cur.return_days === null ? null : Number(cur.return_days)) === r.returnDays &&
    Boolean(cur.return_billable) === (r.returnDays === null ? false : r.returnBillable) &&
    String(cur.procedure_id) === procedureId &&
    (r.description === null || String(cur.description) === r.description.slice(0, 150))
  );
}

function errorMessage(e: unknown): string | null {
  if (e instanceof InsuranceConfigError) return e.message;
  const pg = e as { code?: string; cause?: { code?: string; message?: string } };
  const code = pg.code ?? pg.cause?.code;
  if (code && ['23514', '23505', '23503', '55000', '22023'].includes(code)) {
    return pg.cause?.message ?? 'O banco recusou esta linha.';
  }
  return null;
}

/**
 * A sequência da planilha, em ordem de linha, dentro da transação de quem chama. Nunca confirma
 * nada sozinha: quem chama decide (validar desfaz; aplicar confirma só sem erro).
 */
export async function runContractImportTx(
  tx: Tx,
  input: {
    clinicId: string;
    userId: string;
    insurerId: string;
    importId: string | null;
    rows: readonly ContractImportRow[];
    preErrors: ReadonlyArray<{ line: number; messages: string[] }>;
  },
): Promise<ContractImportRowResult[]> {
  const { clinicId, insurerId } = input;
  const plans = await tx
    .select({ id: hiPlans.id, name: hiPlans.name, status: hiPlans.status })
    .from(hiPlans)
    .where(and(eq(hiPlans.clinicId, clinicId), eq(hiPlans.insurerId, insurerId)));
  const planByName = new Map(plans.map((p) => [p.name.trim().toLowerCase(), p]));
  const procs = (await tx.execute(
    sql`SELECT id::text AS id, codigo FROM public.procedures WHERE clinic_id = ${clinicId}::uuid AND codigo IS NOT NULL`,
  )) as unknown as Row[];
  const procByCode = new Map(
    procs.map((p) => [String(p.codigo).trim().toLowerCase(), String(p.id)]),
  );

  const results: ContractImportRowResult[] = input.preErrors.map((e) => ({
    line: e.line,
    action: 'error',
    procedureCode: null,
    guideType: null,
    planName: null,
    validFrom: null,
    unitValueCents: null,
    messages: e.messages,
  }));
  const seen = new Set<string>();
  for (const r of [...input.rows].sort((a, b) => a.line - b.line)) {
    const base = {
      line: r.line,
      procedureCode: r.procedureCode,
      guideType: r.guideType,
      planName: r.planName,
      validFrom: r.validFrom,
      unitValueCents: r.unitValueCents,
    };
    const fail = (m: string) => results.push({ ...base, action: 'error', messages: [m] });
    const plan = r.planName ? planByName.get(r.planName.trim().toLowerCase()) : null;
    if (r.planName && !plan) {
      fail(
        `plano "${r.planName.slice(0, 60)}" não existe nesta operadora; cadastre-o antes na tela.`,
      );
      continue;
    }
    if (plan && plan.status !== 'active') {
      fail(`plano "${plan.name}" está arquivado.`);
      continue;
    }
    const procedureId = procByCode.get(r.clinicProcedureCode.trim().toLowerCase());
    if (!procedureId) {
      fail(
        `procedimento_clinica "${r.clinicProcedureCode.slice(0, 30)}" não está no catálogo da clínica.`,
      );
      continue;
    }
    const key = `${plan?.id ?? '-'}|${r.guideType}|${r.procedureCode}|${r.validFrom}`;
    if (seen.has(key)) {
      fail('linha repetida na planilha (mesmo plano, tipo de guia, código e início de vigência).');
      continue;
    }
    seen.add(key);

    const live = (await tx.execute(sql`
      SELECT c.id::text AS id, c.valid_from::text AS valid_from, c.valid_until::text AS valid_until,
             c.unit_value_cents, c.requires_authorization, c.copay_kind, c.copay_fixed_cents,
             c.copay_percentage, c.return_days, c.return_billable, c.procedure_id::text AS procedure_id,
             c.description
        FROM public.hi_procedure_contracts c
       WHERE c.clinic_id = ${clinicId}::uuid AND c.insurer_id = ${insurerId}::uuid
         AND c.plan_id IS NOT DISTINCT FROM ${plan?.id ?? null}::uuid
         AND c.guide_type = ${r.guideType} AND c.table_code = '22' AND c.procedure_code = ${r.procedureCode}
         AND NOT EXISTS (SELECT 1 FROM public.hi_procedure_contracts s
                          WHERE s.clinic_id = c.clinic_id AND s.supersedes_id = c.id)
       ORDER BY c.valid_from`)) as unknown as Row[];
    const sameStart = live.find((l) => String(l.valid_from) === r.validFrom);
    const covering = live.find(
      (l) =>
        String(l.valid_from) < r.validFrom &&
        (l.valid_until === null || String(l.valid_until) >= r.validFrom),
    );

    if (sameStart) {
      if (
        sameTerms(sameStart, r, procedureId) &&
        (sameStart.valid_until === null ? null : String(sameStart.valid_until)) === r.validUntil
      ) {
        results.push({ ...base, action: 'unchanged', messages: [] });
      } else {
        fail(
          'já existe item vigente com o mesmo início e valores diferentes; para mudar desde o início use "Corrigir" na tela (a planilha não reescreve o passado).',
        );
      }
      continue;
    }
    if (covering && sameTerms(covering, r, procedureId)) {
      results.push({ ...base, action: 'unchanged', messages: [] });
      continue;
    }
    const reason = `Importação de planilha (linha ${r.line}).`;
    try {
      await tx.transaction(async (sp) => {
        if (covering) {
          const curUntil = covering.valid_until === null ? null : String(covering.valid_until);
          if (r.validUntil !== null && r.validUntil !== curUntil) {
            throw new InsuranceConfigError(
              'o reajuste mantém o fim de vigência do item atual; para mudar o fim, use "Encerrar" na tela.',
              'IMPORT_UNTIL',
            );
          }
          await reviseContractLineTx(
            sp,
            clinicId,
            input.userId,
            String(covering.id),
            { mode: 'new_period', from: r.validFrom, terms: termsOf(r), reason },
            { importId: input.importId },
          );
        } else {
          await createContractLineTx(
            sp,
            clinicId,
            input.userId,
            {
              insurerId,
              planId: plan?.id ?? null,
              guideType: r.guideType,
              tableCode: '22',
              procedureCode: r.procedureCode,
              description: r.description,
              procedureId,
              validFrom: r.validFrom,
              validUntil: r.validUntil,
              ...termsOf(r),
            },
            { importId: input.importId },
          );
        }
      });
      results.push({ ...base, action: covering ? 'adjust' : 'create', messages: [] });
    } catch (e) {
      const m = errorMessage(e);
      if (m === null) throw e;
      fail(m.charAt(0).toLowerCase() + m.slice(1));
    }
  }
  return results.sort((a, b) => a.line - b.line);
}

function countOf(results: readonly ContractImportRowResult[]) {
  const c = { rows: results.length, create: 0, adjust: 0, unchanged: 0, error: 0 };
  for (const r of results) c[r.action] += 1;
  return c;
}

async function alreadyApplied(tx: Tx, clinicId: string, insurerId: string, sha: string) {
  const [prev] = await tx
    .select({ appliedAt: hiContractImports.appliedAt })
    .from(hiContractImports)
    .where(
      and(
        eq(hiContractImports.clinicId, clinicId),
        eq(hiContractImports.insurerId, insurerId),
        eq(hiContractImports.fileSha256, sha),
        eq(hiContractImports.status, 'applied'),
      ),
    )
    .limit(1);
  return prev?.appliedAt ?? null;
}

/** Lê, normaliza, valida (sem gravar contrato) e registra a importação com a prévia. */
export async function validateContractImport(args: {
  clinicId: string;
  userId: string;
  insurerId: string;
  fileName: string;
  bytes: Uint8Array;
  requestContext: RequestContext;
}): Promise<ContractImportPreview> {
  const fileName = args.fileName.replace(/[\\/]/gu, '_').trim().slice(0, 255) || 'planilha';
  const insurer = await withTenant(args.clinicId, (tx) =>
    tx.execute(
      sql`SELECT status FROM public.hi_insurers WHERE clinic_id = ${args.clinicId}::uuid AND id = ${args.insurerId}::uuid`,
    ),
  );
  const insurerStatus = (insurer as unknown as Row[])[0]?.status;
  if (!insurerStatus)
    throw new ContractImportError('Operadora não encontrada nesta clínica.', 'NOT_FOUND');
  if (insurerStatus === 'archived') {
    throw new ContractImportError(
      'Operadora arquivada não recebe contrato novo.',
      'INSURER_ARCHIVED',
    );
  }
  const sheet = readContractSpreadsheet(fileName, args.bytes);
  const norm = normalizeContractSheet(sheet);
  const sha = createHash('sha256').update(args.bytes).digest('hex');
  if (norm.missingColumns.length > 0 && sheet.rows.length === 0) {
    throw new ContractImportFileError('A planilha não tem cabeçalho reconhecido nem linhas.');
  }

  let results: ContractImportRowResult[] = [];
  if (norm.missingColumns.length === 0) {
    try {
      await withTenant(
        args.clinicId,
        async (tx) => {
          const out = await runContractImportTx(tx, {
            clinicId: args.clinicId,
            userId: args.userId,
            insurerId: args.insurerId,
            importId: null,
            rows: norm.rows,
            preErrors: norm.errors,
          });
          throw new DryRun(out);
        },
        args.userId,
      );
    } catch (e) {
      if (!(e instanceof DryRun)) throw e;
      results = e.results;
    }
  }
  const counts = countOf(results);
  const ok = norm.missingColumns.length === 0 && counts.error === 0 && counts.rows > 0;
  const status: 'validated' | 'rejected' = ok ? 'validated' : 'rejected';

  return withTenant(
    args.clinicId,
    async (tx) => {
      const appliedAt = await alreadyApplied(tx, args.clinicId, args.insurerId, sha);
      const [row] = await tx
        .insert(hiContractImports)
        .values({
          clinicId: args.clinicId,
          insurerId: args.insurerId,
          fileName,
          fileSha256: sha,
          rowCount: counts.rows,
          acceptedCount: counts.rows - counts.error,
          rejectedCount: counts.error,
          status,
          summary: {
            policy: 'atomic',
            missingColumns: norm.missingColumns,
            unknownColumns: norm.unknownColumns,
            counts,
            rows: norm.rows,
            results: results.map((r) => ({ line: r.line, action: r.action, messages: r.messages })),
          },
          createdBy: args.userId,
        })
        .returning({ id: hiContractImports.id });
      await logAudit(tx, {
        clinicId: args.clinicId,
        userId: args.userId,
        action: 'health_insurance.config.contract_import_validated',
        resourceType: 'hi_contract_import',
        resourceId: row!.id,
        before: null,
        after: { insurerId: args.insurerId, fileSha256: sha, status, counts },
        requestContext: args.requestContext,
      });
      return {
        importId: row!.id,
        status,
        policy: 'atomic' as const,
        fileName,
        counts,
        missingColumns: norm.missingColumns,
        unknownColumns: norm.unknownColumns,
        rows: results.slice(0, 500),
        alreadyAppliedAt: appliedAt ? appliedAt.toISOString() : null,
      };
    },
    args.userId,
  );
}

/** Aplica uma importação validada: tudo ou nada, revalidando contra o estado ATUAL. */
export async function applyContractImport(args: {
  clinicId: string;
  userId: string;
  importId: string;
  requestContext: RequestContext;
}): Promise<{
  status: 'applied' | 'rejected';
  counts: ReturnType<typeof countOf>;
  errors: ContractImportRowResult[];
}> {
  try {
    return await withTenant(
      args.clinicId,
      async (tx) => {
        const [imp] = await tx
          .select()
          .from(hiContractImports)
          .where(
            and(
              eq(hiContractImports.clinicId, args.clinicId),
              eq(hiContractImports.id, args.importId),
            ),
          )
          .for('update')
          .limit(1);
        if (!imp)
          throw new ContractImportError('Importação não encontrada nesta clínica.', 'NOT_FOUND');
        if (imp.status === 'applied')
          throw new ContractImportError('Esta importação já foi aplicada.', 'ALREADY_APPLIED');
        if (imp.status !== 'validated') {
          throw new ContractImportError(
            'A planilha tem erros: corrija e envie de novo.',
            'HAS_ERRORS',
          );
        }
        const appliedAt = await alreadyApplied(tx, args.clinicId, imp.insurerId, imp.fileSha256);
        if (appliedAt) {
          throw new ContractImportError(
            `Esta mesma planilha já foi aplicada nesta operadora em ${appliedAt.toISOString().slice(0, 10).split('-').reverse().join('/')}.`,
            'ALREADY_APPLIED',
          );
        }
        const rows = ((imp.summary as { rows?: ContractImportRow[] }).rows ??
          []) as ContractImportRow[];
        const results = await runContractImportTx(tx, {
          clinicId: args.clinicId,
          userId: args.userId,
          insurerId: imp.insurerId,
          importId: imp.id,
          rows,
          preErrors: [],
        });
        // O que a pessoa confirmou foi a PRÉVIA: se o efeito de uma linha mudou desde então
        // (outra pessoa mexeu no contrato), nada é aplicado e a planilha precisa de nova prévia.
        const previewed = new Map(
          (
            (imp.summary as { results?: Array<{ line: number; action: string }> }).results ?? []
          ).map((r) => [r.line, r.action]),
        );
        const label: Record<string, string> = {
          create: 'novo item',
          adjust: 'reajuste',
          unchanged: 'sem mudança',
        };
        for (const r of results) {
          const before = previewed.get(r.line);
          if (r.action !== 'error' && before && before !== r.action) {
            r.messages = [
              `o contrato mudou desde a prévia (era "${label[before] ?? before}", agora "${label[r.action] ?? r.action}"); valide a planilha de novo.`,
            ];
            r.action = 'error';
          }
        }
        const counts = countOf(results);
        if (counts.error > 0) throw new ApplyFailed(results);
        await tx
          .update(hiContractImports)
          .set({
            status: 'applied',
            appliedAt: new Date(),
            summary: { ...(imp.summary as object), appliedCounts: counts },
          })
          .where(
            and(eq(hiContractImports.clinicId, args.clinicId), eq(hiContractImports.id, imp.id)),
          );
        await logAudit(tx, {
          clinicId: args.clinicId,
          userId: args.userId,
          action: 'health_insurance.config.contract_import_applied',
          resourceType: 'hi_contract_import',
          resourceId: imp.id,
          before: { status: 'validated' },
          after: { status: 'applied', insurerId: imp.insurerId, counts },
          requestContext: args.requestContext,
        });
        return { status: 'applied' as const, counts, errors: [] };
      },
      args.userId,
    );
  } catch (e) {
    if (!(e instanceof ApplyFailed)) throw e;
    // O estado mudou desde a prévia (outra pessoa mexeu no contrato): nada foi aplicado; a
    // importação fica recusada com o motivo de cada linha.
    const counts = countOf(e.results);
    await withTenant(
      args.clinicId,
      async (tx) => {
        await tx
          .update(hiContractImports)
          .set({
            status: 'rejected',
            acceptedCount: counts.rows - counts.error,
            rejectedCount: counts.error,
            rowCount: counts.rows,
            summary: sql`${hiContractImports.summary} || ${JSON.stringify({ applyResults: e.results.map((r) => ({ line: r.line, action: r.action, messages: r.messages })), counts })}::jsonb`,
          })
          .where(
            and(
              eq(hiContractImports.clinicId, args.clinicId),
              eq(hiContractImports.id, args.importId),
            ),
          );
      },
      args.userId,
    );
    return { status: 'rejected', counts, errors: e.results.filter((r) => r.action === 'error') };
  }
}

class ApplyFailed extends Error {
  constructor(readonly results: ContractImportRowResult[]) {
    super('aplicação desfeita: há linha com erro');
  }
}

export interface ContractImportHistoryItem {
  id: string;
  fileName: string;
  status: string;
  rowCount: number;
  acceptedCount: number;
  rejectedCount: number;
  createdAt: string;
  appliedAt: string | null;
}

export async function listContractImports(
  clinicId: string,
  insurerId: string,
): Promise<ContractImportHistoryItem[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select({
        id: hiContractImports.id,
        fileName: hiContractImports.fileName,
        status: hiContractImports.status,
        rowCount: hiContractImports.rowCount,
        acceptedCount: hiContractImports.acceptedCount,
        rejectedCount: hiContractImports.rejectedCount,
        createdAt: hiContractImports.createdAt,
        appliedAt: hiContractImports.appliedAt,
      })
      .from(hiContractImports)
      .where(
        and(eq(hiContractImports.clinicId, clinicId), eq(hiContractImports.insurerId, insurerId)),
      )
      .orderBy(desc(hiContractImports.createdAt))
      .limit(20);
    return rows.map((r) => ({
      ...r,
      createdAt: (r.createdAt as Date).toISOString(),
      appliedAt: r.appliedAt ? r.appliedAt.toISOString() : null,
    }));
  });
}
