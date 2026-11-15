/**
 * Peças comuns da emissão das guias (Consulta e SP/SADT): o erro de emissão, a
 * terminologia da versão da guia e os dados congelados do impresso. Módulo próprio
 * para a emissão de cada tipo não depender da outra (sem ciclo de import).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

import { tissTerminologyVersions, tissTerms } from '../schema';
import { assertGuidePrintData, GuidePrintError, type GuidePrintData } from '../tiss/print/print-data';
import { inMemoryLookup } from '../tiss/terminology/lookup';
import type { TerminologyTerm } from '../tiss/terminology/official-sheet';
import type { GuideIssue } from '../tiss/validation/common';

import type { CardNumberRead } from './membership-access';

export interface IssueArgs {
  clinicId: string;
  guideId: string;
  /** Leitura auditada da carteirinha DA GUIA (conferida contra `membership_id`). */
  card: CardNumberRead;
  newborn: boolean;
  professionalName: string | null;
  actorUserId: string;
  /** `AAAA-MM-DD` de hoje no fuso da clínica (regra de "atendimento no futuro"). */
  today: string;
}

export class GuideIssuanceError extends Error {
  constructor(
    message: string,
    readonly issues: GuideIssue[] = [],
  ) {
    super(message);
    this.name = 'GuideIssuanceError';
  }
}

/** Etapas em que a guia já foi aprovada e emitida (a revisão atual tem snapshot). */
const ISSUED_STATUSES = new Set([
  'approved',
  'in_batch',
  'exported',
  'sent',
  'under_review',
  'paid',
  'partially_paid',
  'partially_glossed',
  'fully_glossed',
  'closed',
  'replaced',
]);

/**
 * Recusa de emissão fora de "conferida". Na aprovação concorrente (P14.2) quem perde lê a guia
 * já aprovada: a mensagem diz isso, em vez de só citar a etapa.
 */
export function notReviewedError(status: string): GuideIssuanceError {
  return new GuideIssuanceError(
    ISSUED_STATUSES.has(status)
      ? `esta guia já foi aprovada e emitida (estado: ${status}); atualize a tela`
      : `só se emite guia conferida (estado: ${status})`,
  );
}

/**
 * Tabelas de domínio pequenas que o validador da Consulta consulta inteiras
 * (conselho, indicação de acidente, tipo de consulta, UF, ausência de código de
 * validação, cobertura especial, regime, saúde ocupacional, tabela de referência).
 */
export const CONSULTA_DOMAIN_TABLES = [
  '26',
  '36',
  '52',
  '59',
  '74',
  '75',
  '76',
  '77',
  '87',
] as const;

/**
 * As do validador da SP/SADT: as da Consulta mais caráter do atendimento (23), grau de
 * participação (35), via de acesso (61), técnica (48) e tipo de atendimento (50).
 */
export const SP_SADT_DOMAIN_TABLES = [...CONSULTA_DOMAIN_TABLES, '23', '35', '48', '50', '61'] as const;

/** Termos da guia na versão dela: as tabelas de domínio inteiras; das demais (TUSS 22, CBO 24), só os códigos usados. */
export async function loadTerms(
  tx: Tx,
  version: string,
  needs: ReadonlyArray<[table: string, code: string]>,
  domainTables: readonly string[] = CONSULTA_DOMAIN_TABLES,
) {
  const [v] = await tx
    .select({ id: tissTerminologyVersions.id })
    .from(tissTerminologyVersions)
    .where(eq(tissTerminologyVersions.version, version))
    .limit(1);
  if (!v) throw new GuideIssuanceError(`terminologia ${version} não carregada`);
  const tables: Record<string, TerminologyTerm[]> = {};
  const domain = await tx
    .select({
      tableCode: tissTerms.tableCode,
      code: tissTerms.code,
      term: tissTerms.term,
      startsOn: tissTerms.startsOn,
      endsOn: tissTerms.endsOn,
      implantationEndsOn: tissTerms.implantationEndsOn,
    })
    .from(tissTerms)
    .where(and(eq(tissTerms.versionId, v.id), inArray(tissTerms.tableCode, [...domainTables])));
  for (const { tableCode, ...term } of domain)
    tables[tableCode] = [...(tables[tableCode] ?? []), term];
  for (const [table, code] of needs) {
    const rows = await tx
      .select({
        code: tissTerms.code,
        term: tissTerms.term,
        startsOn: tissTerms.startsOn,
        endsOn: tissTerms.endsOn,
        implantationEndsOn: tissTerms.implantationEndsOn,
      })
      .from(tissTerms)
      .where(
        and(
          eq(tissTerms.versionId, v.id),
          eq(tissTerms.tableCode, table),
          inArray(tissTerms.code, [code]),
        ),
      );
    tables[table] = [...(tables[table] ?? []), ...rows];
  }
  return inMemoryLookup(version, tables);
}

/**
 * Dados que só existem no impresso (P7.6), congelados com o resto da guia: o PDF nunca
 * relê o cadastro atual (o paciente pode mudar de nome depois).
 */
export async function freezePrintData(
  tx: Tx,
  args: { clinicId: string; patientId: string; contractorName: string | null; insurerName: string | null },
): Promise<GuidePrintData> {
  const [names] = await tx.execute<{ patient_nome: string | null; clinic_nome: string | null }>(sql`
    SELECT (SELECT p.nome FROM public.patients p WHERE p.clinic_id = ${args.clinicId}::uuid AND p.id = ${args.patientId}::uuid) AS patient_nome,
           (SELECT c.nome FROM public.clinics c WHERE c.id = ${args.clinicId}::uuid) AS clinic_nome`);
  const print: GuidePrintData = {
    schema: 'qoro.hi.guide-print/1',
    beneficiarioNome: names?.patient_nome?.trim() ?? '',
    nomeSocial: null,
    contratadoNome: (args.contractorName ?? names?.clinic_nome ?? '').trim(),
    operadoraNome: args.insurerName?.trim() || null,
  };
  try {
    assertGuidePrintData(print);
  } catch (e) {
    if (e instanceof GuidePrintError) {
      throw new GuideIssuanceError(`dado obrigatório do impresso: ${e.message}`, [
        { code: 'PRINT_DATA_INVALID', field: 'impresso', message: e.message, owner: 'gestor' },
      ]);
    }
    throw e;
  }
  return print;
}

export function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
