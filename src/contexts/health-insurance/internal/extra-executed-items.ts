/**
 * P8.4 — itens executados adicionais da sessão SP/SADT, com a política P8.4-r APROVADA em
 * 24/11/2026 (`extra-item-policy.ts`; decisão em docs/convenios/decisao-p84r.md).
 *
 * Tabela `hi_appointment_extra_items` = migration 0167. Enquanto ela não estiver no banco, o
 * acesso é por SQL e começa por `extraItemsAvailableTx`: sem a tabela, "indisponível" e nada
 * quebra.
 *
 * Ciclo (o banco confere cada transição de novo, gatilho da 0167):
 *   registrar (consultório ou conferência) → [contrato exige] ligar a autorização concedida da
 *   solicitação da sessão → incluir na guia (faturamento; consome o saldo uma vez) | não faturar,
 *   com motivo (faturamento) | cancelar o registro errado, com motivo.
 *
 * Travas, sempre na mesma ordem (sem impasse entre caminhos): a do item da solicitação (só a
 * inclusão, que mexe na sequência da guia como a conclusão da sessão) → as guias vivas da sessão →
 * o item. A aprovação da guia (sadt-issuance) trava a guia primeiro e confere os pendentes depois.
 */
import { and, eq, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

import { hiAppointmentCoverages, hiProcedureContracts } from '../schema-clinic';
import { selectEffectiveContract, type ContractLine } from '../tiss/assembly/contract-selection';
import {
  decideExtraItem,
  type ExtraItemDecision,
  type ExtraItemStatus,
  type SessionGuideState,
} from './extra-item-policy';
import { insurerRules, type InsurerExtraItemsRule } from './insurer-rules';
import { assertConveniosOperableTx } from './module-guard';

export type ExtraItemErrorCode =
  | 'NOT_AVAILABLE'
  | 'APPOINTMENT_NOT_FOUND'
  | 'APPOINTMENT_NOT_EXECUTED'
  | 'NOT_OWN_SESSION'
  | 'NOT_SADT'
  | 'CONTRACT_INVALID'
  | 'CONTRACT_NOT_EFFECTIVE'
  | 'CONTRACT_AMBIGUOUS'
  | 'CONTRACT_CHANGED'
  | 'QUANTITY_INVALID'
  | 'SOURCE_INVALID'
  | 'DUPLICATE'
  | 'GUIDE_CLOSED'
  | 'GUIDE_NOT_FOUND'
  | 'GUIDE_NOT_OPEN'
  | 'PROCEDURE_ALREADY_IN_GUIDE'
  | 'ITEM_NOT_FOUND'
  | 'ALREADY_DECIDED'
  | 'ALREADY_CANCELLED'
  | 'NOT_REGULARIZABLE'
  | 'AUTHORIZATION_INVALID'
  | 'NOT_INCLUDABLE'
  | 'INSURER_FORBIDS'
  | 'INSURER_CONFIRMATION_REQUIRED'
  | 'REASON_REQUIRED';

export class ExtraItemRuleError extends Error {
  constructor(
    readonly code: ExtraItemErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExtraItemRuleError';
  }
}

function fail(code: ExtraItemErrorCode, message: string): never {
  throw new ExtraItemRuleError(code, message);
}

export type ExtraItemSource = 'consultorio' | 'conferencia';

export interface ExtraItemView {
  id: string;
  tableCode: string;
  procedureCode: string;
  description: string;
  quantity: number;
  requiresAuthorization: boolean;
  source: ExtraItemSource;
  status: ExtraItemStatus;
  recordedBy: string;
  recordedAt: string;
  regularizedAt: string | null;
  includedAt: string | null;
  excludedAt: string | null;
  exclusionReason: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  /** O que a política aprovada diz deste item agora (pendência, ações possíveis, mensagem). */
  decision: ExtraItemDecision;
}

const EXECUTED_STATUSES = new Set(['em_atendimento', 'atendido']);
const EXCLUSION_REASON = { min: 10, max: 300 } as const;
const CANCEL_REASON = { min: 3, max: 300 } as const;

function pgError(e: unknown): { code: string | undefined; constraint: string | undefined; message: string | undefined } {
  const err = e as { code?: string; constraint_name?: string; message?: string; cause?: unknown };
  if (err?.code) return { code: err.code, constraint: err.constraint_name, message: err.message };
  const cause = err?.cause as { code?: string; constraint_name?: string; message?: string } | undefined;
  return { code: cause?.code, constraint: cause?.constraint_name, message: cause?.message };
}

/** A tabela da 0167 existe neste banco? */
export async function extraItemsAvailableTx(tx: Tx): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT to_regclass('public.hi_appointment_extra_items') IS NOT NULL AS ok`,
  )) as unknown as Array<{ ok: boolean }>;
  return rows[0]?.ok === true;
}

async function requireAvailable(tx: Tx): Promise<void> {
  if (!(await extraItemsAvailableTx(tx))) {
    fail('NOT_AVAILABLE', 'Itens executados adicionais ainda não estão disponíveis neste ambiente.');
  }
}

interface SessionFacts {
  status: string;
  date: string;
  doctorId: string;
  insurerId: string;
  planId: string | null;
  sadtRequestItemId: string | null;
}

async function sessionFactsTx(tx: Tx, clinicId: string, appointmentId: string): Promise<SessionFacts> {
  const rows = (await tx.execute(sql`
    SELECT a.status::text AS status, a.doctor_id::text AS doctor_id,
           (a.scheduled_at AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'))::date::text AS date
      FROM public.appointments a
      JOIN public.clinics c ON c.id = a.clinic_id
     WHERE a.clinic_id = ${clinicId}::uuid AND a.id = ${appointmentId}::uuid`)) as unknown as Array<{
    status: string;
    doctor_id: string;
    date: string;
  }>;
  const ap = rows[0];
  if (!ap) fail('APPOINTMENT_NOT_FOUND', 'Atendimento não encontrado nesta clínica.');
  const [cov] = await tx
    .select({
      guideType: hiAppointmentCoverages.guideType,
      insurerId: hiAppointmentCoverages.insurerId,
      planId: hiAppointmentCoverages.planId,
      status: hiAppointmentCoverages.status,
      sadtRequestItemId: hiAppointmentCoverages.sadtRequestItemId,
    })
    .from(hiAppointmentCoverages)
    .where(and(eq(hiAppointmentCoverages.clinicId, clinicId), eq(hiAppointmentCoverages.appointmentId, appointmentId)))
    .limit(1);
  if (!cov || cov.guideType !== 'sp_sadt' || cov.status === 'cancelled') {
    fail('NOT_SADT', 'Item executado adicional só em atendimento de convênio SP/SADT.');
  }
  return {
    status: ap!.status,
    date: ap!.date,
    doctorId: ap!.doctor_id,
    insurerId: cov!.insurerId,
    planId: cov!.planId,
    sadtRequestItemId: cov!.sadtRequestItemId ?? null,
  };
}

/**
 * Exceção do médico (P8.4-r, 24/11): o profissional registra só na PRÓPRIA sessão. Conferido no
 * servidor pela posse do atendimento; nenhuma permissão de Convênios é ampliada.
 */
export async function assertOwnSessionTx(tx: Tx, args: { clinicId: string; appointmentId: string; userId: string }): Promise<void> {
  const s = await sessionFactsTx(tx, args.clinicId, args.appointmentId);
  if (s.doctorId !== args.userId) {
    fail('NOT_OWN_SESSION', 'Só o profissional desta sessão registra itens pelo consultório.');
  }
}

/** Etapa das guias vivas da sessão, SEM travar (leitura). As escritas usam `lockSessionGuidesTx`. */
async function sessionGuideStateTx(tx: Tx, clinicId: string, appointmentId: string): Promise<SessionGuideState> {
  const rows = (await tx.execute(sql`
    SELECT g.status::text AS status FROM public.hi_guides g
     WHERE g.clinic_id = ${clinicId}::uuid AND g.live
       AND EXISTS (SELECT 1 FROM public.hi_guide_items i WHERE i.clinic_id = g.clinic_id AND i.guide_id = g.id
                     AND i.appointment_id = ${appointmentId}::uuid AND i.live)`)) as unknown as Array<{ status: string }>;
  let state: SessionGuideState = 'none';
  for (const r of rows) {
    if (r.status === 'pending_data' || r.status === 'ready_for_review') {
      if (state === 'none') state = 'open';
    } else if (r.status === 'reviewed') {
      if (state === 'none' || state === 'open') state = 'reviewed';
    } else state = 'closed';
  }
  return state;
}

/** Trava as guias vivas da sessão (mesma ordem em todo caminho de escrita) e devolve a etapa. */
async function lockSessionGuidesTx(tx: Tx, clinicId: string, appointmentId: string): Promise<SessionGuideState> {
  await tx.execute(sql`
    SELECT g.id FROM public.hi_guides g
     WHERE g.clinic_id = ${clinicId}::uuid AND g.live
       AND EXISTS (SELECT 1 FROM public.hi_guide_items i WHERE i.clinic_id = g.clinic_id AND i.guide_id = g.id
                     AND i.appointment_id = ${appointmentId}::uuid AND i.live)
     ORDER BY g.id
       FOR NO KEY UPDATE OF g`);
  return sessionGuideStateTx(tx, clinicId, appointmentId);
}

async function insurerRuleTx(tx: Tx, clinicId: string, insurerId: string): Promise<InsurerExtraItemsRule> {
  const rows = (await tx.execute(sql`
    SELECT settings FROM public.hi_insurers WHERE clinic_id = ${clinicId}::uuid AND id = ${insurerId}::uuid`)) as unknown as Array<{
    settings: unknown;
  }>;
  return insurerRules(rows[0]?.settings ?? null).extraItemsAfterSession;
}

interface AuthCandidate {
  itemId: string;
  remaining: number;
}

/** O item da autorização da SOLICITAÇÃO da sessão para o procedimento (a autorização que a guia leva). */
async function requestAuthorizationItemTx(
  tx: Tx,
  clinicId: string,
  s: SessionFacts,
  tableCode: string,
  procedureCode: string,
): Promise<(AuthCandidate & { status: string; validUntil: string | null }) | null> {
  if (!s.sadtRequestItemId) return null;
  const rows = (await tx.execute(sql`
    SELECT i.id::text AS item_id, (i.quantity_authorized - i.quantity_consumed)::int AS remaining,
           a.status::text AS status, a.password_valid_until::text AS valid_until
      FROM public.hi_sadt_request_items ri
      JOIN public.hi_sadt_requests r ON r.clinic_id = ri.clinic_id AND r.id = ri.request_id
      JOIN public.hi_authorizations a ON a.clinic_id = r.clinic_id AND a.id = r.authorization_id
      JOIN public.hi_authorization_items i ON i.clinic_id = a.clinic_id AND i.authorization_id = a.id
     WHERE ri.clinic_id = ${clinicId}::uuid AND ri.id = ${s.sadtRequestItemId}::uuid
       AND i.table_code = ${tableCode} AND i.procedure_code = ${procedureCode}
     ORDER BY i.id
     LIMIT 1`)) as unknown as Array<{ item_id: string; remaining: number; status: string; valid_until: string | null }>;
  const r = rows[0];
  return r ? { itemId: r.item_id, remaining: Number(r.remaining), status: r.status, validUntil: r.valid_until } : null;
}

/** Mesmo critério de `hi_extra_item_authorization_problem` (0167), para a mensagem de regra. */
function authorizationProblem(
  a: { status: string; validUntil: string | null; remaining: number } | null,
  sessionDate: string,
  quantity: number,
): string | null {
  if (!a) return 'a solicitação desta sessão não tem autorização concedida para este procedimento';
  if (a.status !== 'authorized' && a.status !== 'partially_authorized') return 'a autorização não está concedida pela operadora';
  if (a.validUntil && sessionDate > a.validUntil) return 'a senha da autorização venceu antes da data da sessão';
  if (a.remaining < quantity) return `o saldo autorizado (${a.remaining}) é menor que a quantidade executada (${quantity})`;
  return null;
}

interface ExtraItemRow {
  id: string;
  appointment_id: string;
  contract_line_id: string;
  table_code: string;
  procedure_code: string;
  description: string;
  quantity: number;
  requires_authorization: boolean;
  source: ExtraItemSource;
  status: ExtraItemStatus;
  recorded_by: string;
  recorded_at: string;
  authorization_item_id: string | null;
  regularized_at: string | null;
  guide_item_id: string | null;
  included_at: string | null;
  excluded_at: string | null;
  exclusion_reason: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

const ROW_COLUMNS = sql.raw(`id::text, appointment_id::text, contract_line_id::text, table_code, procedure_code, description,
  quantity, requires_authorization, source, status, recorded_by::text, recorded_at::text,
  authorization_item_id::text, regularized_at::text, guide_item_id::text, included_at::text,
  excluded_at::text, exclusion_reason, cancelled_at::text, cancel_reason`);

async function billedInLiveGuideTx(tx: Tx, clinicId: string, r: Pick<ExtraItemRow, 'appointment_id' | 'table_code' | 'procedure_code'>): Promise<boolean> {
  const rows = (await tx.execute(sql`
    SELECT 1 AS ok FROM public.hi_guide_items
     WHERE clinic_id = ${clinicId}::uuid AND appointment_id = ${r.appointment_id}::uuid AND live
       AND table_code = ${r.table_code} AND procedure_code = ${r.procedure_code}
     LIMIT 1`)) as unknown as unknown[];
  return rows.length > 0;
}

async function decisionOfTx(
  tx: Tx,
  clinicId: string,
  r: ExtraItemRow,
  ctx: { facts: SessionFacts; guideState: SessionGuideState; insurerRule: InsurerExtraItemsRule },
): Promise<ExtraItemDecision> {
  let candidate: AuthCandidate | null = null;
  let linkedProblem: string | null = null;
  if (r.requires_authorization && (r.status === 'recorded' || r.status === 'regularized')) {
    const a = await requestAuthorizationItemTx(tx, clinicId, ctx.facts, r.table_code, r.procedure_code);
    if (r.status === 'recorded') {
      // Candidata = autorização concedida e com senha válida na data; a política compara o saldo.
      const granted = a !== null && (a.status === 'authorized' || a.status === 'partially_authorized');
      const inDate = a !== null && !(a.validUntil && ctx.facts.date > a.validUntil);
      candidate = granted && inDate ? { itemId: a!.itemId, remaining: a!.remaining } : null;
    } else {
      // Regularizado: o saldo ainda não foi consumido, então o atual precisa cobrir a quantidade.
      linkedProblem = a && a.itemId === r.authorization_item_id
        ? authorizationProblem(a, ctx.facts.date, Number(r.quantity))
        : 'a autorização ligada não é mais a da solicitação desta sessão';
    }
  }
  return decideExtraItem({
    status: r.status,
    requiresAuthorization: r.requires_authorization,
    quantity: Number(r.quantity),
    guideState: ctx.guideState,
    insurerRule: ctx.insurerRule,
    candidateAuthorization: candidate,
    linkedAuthorizationProblem: linkedProblem,
    billedInLiveGuide: r.status === 'included' ? await billedInLiveGuideTx(tx, clinicId, r) : false,
  });
}

/** Itens da sessão, com a decisão da política aprovada para cada um. */
export async function listExtraItemsTx(tx: Tx, args: { clinicId: string; appointmentId: string }): Promise<ExtraItemView[]> {
  if (!(await extraItemsAvailableTx(tx))) return [];
  const rows = (await tx.execute(sql`
    SELECT ${ROW_COLUMNS}
      FROM public.hi_appointment_extra_items
     WHERE clinic_id = ${args.clinicId}::uuid AND appointment_id = ${args.appointmentId}::uuid
     ORDER BY recorded_at, id`)) as unknown as ExtraItemRow[];
  if (rows.length === 0) return [];
  const facts = await sessionFactsTx(tx, args.clinicId, args.appointmentId);
  const ctx = {
    facts,
    guideState: await sessionGuideStateTx(tx, args.clinicId, args.appointmentId),
    insurerRule: await insurerRuleTx(tx, args.clinicId, facts.insurerId),
  };
  const out: ExtraItemView[] = [];
  for (const r of rows) {
    out.push({
      id: r.id,
      tableCode: r.table_code,
      procedureCode: r.procedure_code,
      description: r.description,
      quantity: Number(r.quantity),
      requiresAuthorization: r.requires_authorization,
      source: r.source,
      status: r.status,
      recordedBy: r.recorded_by,
      recordedAt: r.recorded_at,
      regularizedAt: r.regularized_at,
      includedAt: r.included_at,
      excludedAt: r.excluded_at,
      exclusionReason: r.exclusion_reason,
      cancelledAt: r.cancelled_at,
      cancelReason: r.cancel_reason,
      decision: await decisionOfTx(tx, args.clinicId, r, ctx),
    });
  }
  return out;
}

function mapWriteError(e: unknown): never {
  const { code, constraint, message } = pgError(e);
  if (code === '23505' && constraint === 'hi_extra_items_active_uniq') {
    fail('DUPLICATE', 'Este procedimento já está registrado nesta sessão. Para mudar a quantidade, cancele e registre de novo.');
  }
  if (code === '23505' && constraint === 'hi_guide_items_live_billing_uniq') {
    fail('PROCEDURE_ALREADY_IN_GUIDE', 'Este procedimento já está na guia desta sessão; a quantidade a mais não entra como item novo.');
  }
  if (code === '23514' && constraint === 'hi_extra_item_guide_closed') {
    fail('GUIDE_CLOSED', 'A guia desta sessão já foi fechada. Reabra ou substitua a guia para mudar os itens.');
  }
  if (code === '23514' && constraint === 'hi_extra_item_contract') {
    fail('CONTRACT_INVALID', 'O item precisa ser do contrato SP/SADT da operadora do atendimento.');
  }
  if (code === '23514' && constraint === 'hi_extra_item_coverage') {
    fail('NOT_SADT', 'Item executado adicional só em atendimento de convênio SP/SADT.');
  }
  if (code === '23514' && constraint === 'hi_extra_item_closed') {
    fail('ALREADY_DECIDED', 'Este item já foi decidido e não muda.');
  }
  if (code === '23514' && constraint === 'hi_extra_item_authorization') {
    fail('AUTHORIZATION_INVALID', (message ?? 'A autorização não serve para este item.').replace(/^Autorização/u, 'A autorização'));
  }
  // Consumo acima do autorizado (gatilho da 0146): nunca fatura acima do saldo.
  if (code === '23514' && /Consumo acima do autorizado/u.test(message ?? '')) {
    fail('AUTHORIZATION_INVALID', 'O saldo autorizado não cobre a quantidade executada; nada foi incluído.');
  }
  if (code === '55000' && /Só se consome autorização concedida/u.test(message ?? '')) {
    fail('AUTHORIZATION_INVALID', 'A autorização não está concedida pela operadora; nada foi incluído.');
  }
  throw e;
}

/**
 * Registra um item executado adicional (só item de contrato). Idempotente para quem repete o
 * mesmo registro (mesma pessoa, mesma linha, mesma quantidade): devolve o item que já existe.
 */
export async function recordExtraItemTx(
  tx: Tx,
  args: {
    clinicId: string;
    appointmentId: string;
    contractLineId: string;
    quantity: number;
    source: ExtraItemSource;
    /** Pessoa da sessão (para a repetição idempotente). */
    actorUserId?: string;
  },
): Promise<{ id: string; existing: boolean }> {
  await requireAvailable(tx);
  await assertConveniosOperableTx(tx, args.clinicId);
  if (!Number.isInteger(args.quantity) || args.quantity < 1 || args.quantity > 999) {
    fail('QUANTITY_INVALID', 'A quantidade precisa ser um número inteiro de 1 a 999.');
  }
  if (args.source !== 'consultorio' && args.source !== 'conferencia') {
    fail('SOURCE_INVALID', 'Origem do registro inválida.');
  }
  const s = await sessionFactsTx(tx, args.clinicId, args.appointmentId);
  if (!EXECUTED_STATUSES.has(s.status)) {
    fail('APPOINTMENT_NOT_EXECUTED', 'Itens executados só podem ser registrados com o atendimento em andamento ou concluído.');
  }
  // A linha precisa ser A vigente na data da sessão para aquele procedimento (o valor sai dela).
  const [line] = (await tx
    .select()
    .from(hiProcedureContracts)
    .where(and(eq(hiProcedureContracts.clinicId, args.clinicId), eq(hiProcedureContracts.id, args.contractLineId)))
    .limit(1)) as unknown as ContractLine[];
  if (!line || line.guideType !== 'sp_sadt' || line.insurerId !== s.insurerId) {
    fail('CONTRACT_INVALID', 'O item precisa ser do contrato SP/SADT da operadora do atendimento.');
  }
  const sel = await effectiveLineTx(tx, args.clinicId, s, line!.tableCode, line!.procedureCode);
  if (sel.kind === 'ambiguous') {
    fail('CONTRACT_AMBIGUOUS', `Há mais de um valor de contrato vigente em ${s.date} para ${line!.tableCode}/${line!.procedureCode}.`);
  }
  if (sel.kind !== 'found' || sel.line.id !== line!.id) {
    fail('CONTRACT_NOT_EFFECTIVE', `Esta linha do contrato não é a vigente em ${s.date} para ${line!.tableCode}/${line!.procedureCode}.`);
  }
  // Repetição do mesmo registro (duplo clique, reenvio da tela): devolve o que já existe.
  const same = (await tx.execute(sql`
    SELECT id::text, contract_line_id::text, quantity, recorded_by::text
      FROM public.hi_appointment_extra_items
     WHERE clinic_id = ${args.clinicId}::uuid AND appointment_id = ${args.appointmentId}::uuid
       AND table_code = ${line!.tableCode} AND procedure_code = ${line!.procedureCode} AND status <> 'cancelled'
     LIMIT 1`)) as unknown as Array<{ id: string; contract_line_id: string; quantity: number; recorded_by: string }>;
  if (same[0]) {
    const x = same[0];
    if (args.actorUserId && x.recorded_by === args.actorUserId && x.contract_line_id === line!.id && Number(x.quantity) === args.quantity) {
      return { id: x.id, existing: true };
    }
    fail('DUPLICATE', 'Este procedimento já está registrado nesta sessão. Para mudar a quantidade, cancele e registre de novo.');
  }
  try {
    // Código, descrição e "exige autorização" são copiados da linha pelo banco; vão aqui só porque
    // as colunas são NOT NULL (o gatilho sobrescreve, e grava a pessoa da sessão como autora).
    const rows = (await tx.execute(sql`
      INSERT INTO public.hi_appointment_extra_items
        (clinic_id, appointment_id, contract_line_id, table_code, procedure_code, description,
         requires_authorization, quantity, source, recorded_by)
      VALUES (${args.clinicId}::uuid, ${args.appointmentId}::uuid, ${args.contractLineId}::uuid,
              ${line!.tableCode}, ${line!.procedureCode}, ${line!.description.slice(0, 150)},
              ${line!.requiresAuthorization}, ${args.quantity}, ${args.source},
              '00000000-0000-0000-0000-000000000000'::uuid)
      RETURNING id::text`)) as unknown as Array<{ id: string }>;
    return { id: rows[0]!.id, existing: false };
  } catch (e) {
    mapWriteError(e);
  }
}

async function effectiveLineTx(tx: Tx, clinicId: string, s: SessionFacts, tableCode: string, procedureCode: string) {
  const lines = (await tx
    .select()
    .from(hiProcedureContracts)
    .where(
      and(
        eq(hiProcedureContracts.clinicId, clinicId),
        eq(hiProcedureContracts.insurerId, s.insurerId),
        eq(hiProcedureContracts.guideType, 'sp_sadt'),
      ),
    )) as unknown as ContractLine[];
  return selectEffectiveContract(lines, {
    insurerId: s.insurerId,
    planId: s.planId,
    guideType: 'sp_sadt',
    tableCode,
    procedureCode,
    date: s.date,
  });
}

/** Carrega o item, trava as guias da sessão e depois o item (ordem única de travas). */
async function lockItemTx(tx: Tx, clinicId: string, itemId: string): Promise<{ row: ExtraItemRow; guideState: SessionGuideState }> {
  const head = (await tx.execute(sql`
    SELECT appointment_id::text FROM public.hi_appointment_extra_items
     WHERE clinic_id = ${clinicId}::uuid AND id = ${itemId}::uuid`)) as unknown as Array<{ appointment_id: string }>;
  if (!head[0]) fail('ITEM_NOT_FOUND', 'Item não encontrado nesta clínica.');
  const guideState = await lockSessionGuidesTx(tx, clinicId, head[0]!.appointment_id);
  const rows = (await tx.execute(sql`
    SELECT ${ROW_COLUMNS} FROM public.hi_appointment_extra_items
     WHERE clinic_id = ${clinicId}::uuid AND id = ${itemId}::uuid
       FOR UPDATE`)) as unknown as ExtraItemRow[];
  return { row: rows[0]!, guideState };
}

/** Recepção ou faturamento: liga a autorização concedida da solicitação da sessão ao item (regularização). */
export async function regularizeExtraItemTx(tx: Tx, args: { clinicId: string; itemId: string }): Promise<{ authorizationItemId: string }> {
  await requireAvailable(tx);
  await assertConveniosOperableTx(tx, args.clinicId);
  const { row: r, guideState } = await lockItemTx(tx, args.clinicId, args.itemId);
  if (r.status === 'regularized' && r.authorization_item_id) return { authorizationItemId: r.authorization_item_id };
  if (r.status !== 'recorded') fail('ALREADY_DECIDED', 'Este item já foi decidido e não muda.');
  if (!r.requires_authorization) fail('NOT_REGULARIZABLE', 'O contrato deste item dispensa autorização: não há o que ligar.');
  if (guideState === 'closed') fail('GUIDE_CLOSED', 'A guia desta sessão já foi aprovada. Reabra ou substitua a guia para mudar os itens.');
  const s = await sessionFactsTx(tx, args.clinicId, r.appointment_id);
  const a = await requestAuthorizationItemTx(tx, args.clinicId, s, r.table_code, r.procedure_code);
  const problem = authorizationProblem(a, s.date, Number(r.quantity));
  if (problem) fail('AUTHORIZATION_INVALID', `A autorização não serve para este item: ${problem}.`);
  try {
    await tx.execute(sql`
      UPDATE public.hi_appointment_extra_items
         SET status = 'regularized', authorization_item_id = ${a!.itemId}::uuid
       WHERE clinic_id = ${args.clinicId}::uuid AND id = ${args.itemId}::uuid`);
  } catch (e) {
    mapWriteError(e);
  }
  return { authorizationItemId: a!.itemId };
}

/**
 * Faturamento: inclui o item na guia viva e em edição da sessão. Linha nova da guia com o valor do
 * contrato vigente na data da sessão; contrato que exige autorização consome o saldo UMA vez
 * (chave `extra:<item>`; o gatilho da 0146 trava a linha e recusa passar do autorizado).
 */
export async function includeExtraItemTx(
  tx: Tx,
  args: { clinicId: string; itemId: string; actorUserId: string; insurerRuleConfirmed: boolean },
): Promise<{ guideId: string; guideItemId: string; existing: boolean }> {
  await requireAvailable(tx);
  await assertConveniosOperableTx(tx, args.clinicId);
  const head = (await tx.execute(sql`
    SELECT e.appointment_id::text, c.sadt_request_item_id::text AS request_item_id
      FROM public.hi_appointment_extra_items e
      JOIN public.hi_appointment_coverages c ON c.clinic_id = e.clinic_id AND c.appointment_id = e.appointment_id
     WHERE e.clinic_id = ${args.clinicId}::uuid AND e.id = ${args.itemId}::uuid`)) as unknown as Array<{
    appointment_id: string;
    request_item_id: string | null;
  }>;
  if (!head[0]) fail('ITEM_NOT_FOUND', 'Item não encontrado nesta clínica.');
  // Mesma trava da conclusão da sessão (sadt-guide-service): a sequência da guia não colide.
  if (head[0]!.request_item_id) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`hi:sadt-item:${head[0]!.request_item_id}`}))`);
  }
  const { row: r, guideState } = await lockItemTx(tx, args.clinicId, args.itemId);
  const s = await sessionFactsTx(tx, args.clinicId, r.appointment_id);
  if (r.status === 'included') {
    if (await billedInLiveGuideTx(tx, args.clinicId, r)) {
      const g = (await tx.execute(sql`SELECT guide_id::text FROM public.hi_guide_items
          WHERE clinic_id = ${args.clinicId}::uuid AND id = ${r.guide_item_id}::uuid`)) as unknown as Array<{ guide_id: string }>;
      return { guideId: g[0]?.guide_id ?? '', guideItemId: r.guide_item_id!, existing: true };
    }
  } else if (r.status !== 'recorded' && r.status !== 'regularized') {
    fail('ALREADY_DECIDED', 'Este item já foi decidido e não muda.');
  }
  if (r.requires_authorization && r.status === 'recorded') {
    fail('NOT_INCLUDABLE', 'O contrato exige autorização: ligue a autorização concedida antes de incluir.');
  }
  const rule = await insurerRuleTx(tx, args.clinicId, s.insurerId);
  if (rule === 'forbids') {
    fail('INSURER_FORBIDS', 'Esta operadora está registrada como não aceita item regularizado depois da sessão. Registre que não será faturado, com o motivo.');
  }
  if (rule === 'unknown' && !args.insurerRuleConfirmed) {
    fail('INSURER_CONFIRMATION_REQUIRED', 'A regra desta operadora para item além do solicitado não está registrada. Confirme que o contrato permite antes de incluir.');
  }
  if (guideState !== 'open') {
    fail(
      guideState === 'none' ? 'GUIDE_NOT_FOUND' : 'GUIDE_NOT_OPEN',
      guideState === 'none'
        ? 'A guia desta sessão ainda não existe: ela nasce na conclusão do atendimento.'
        : 'Itens só entram na guia em edição. Devolva a guia para correção para incluir o item.',
    );
  }
  const guides = (await tx.execute(sql`
    SELECT g.id::text, g.authorization_id::text
      FROM public.hi_guides g
     WHERE g.clinic_id = ${args.clinicId}::uuid AND g.live AND g.status IN ('pending_data', 'ready_for_review')
       AND EXISTS (SELECT 1 FROM public.hi_guide_items i WHERE i.clinic_id = g.clinic_id AND i.guide_id = g.id
                     AND i.appointment_id = ${r.appointment_id}::uuid AND i.live)
     ORDER BY g.id`)) as unknown as Array<{ id: string; authorization_id: string | null }>;
  if (guides.length !== 1) fail('GUIDE_NOT_OPEN', 'A sessão não está numa guia única em edição; confira a guia antes de incluir.');
  const guide = guides[0]!;
  if (await billedInLiveGuideTx(tx, args.clinicId, r)) {
    fail('PROCEDURE_ALREADY_IN_GUIDE', 'Este procedimento já está na guia desta sessão; a quantidade a mais não entra como item novo.');
  }
  // Valor do contrato vigente na data da sessão; a linha precisa ser a mesma do registro.
  const sel = await effectiveLineTx(tx, args.clinicId, s, r.table_code, r.procedure_code);
  if (sel.kind !== 'found' || sel.line.id !== r.contract_line_id) {
    fail('CONTRACT_CHANGED', 'O valor de contrato deste procedimento mudou desde o registro: cancele o item e registre de novo.');
  }
  const line = sel.line;
  if (r.requires_authorization) {
    const a = await requestAuthorizationItemTx(tx, args.clinicId, s, r.table_code, r.procedure_code);
    const consumed = (await tx.execute(sql`
      SELECT 1 AS ok FROM public.hi_authorization_consumptions
       WHERE clinic_id = ${args.clinicId}::uuid AND idempotency_key = ${`extra:${r.id}`}`)) as unknown as unknown[];
    if (!a || a.itemId !== r.authorization_item_id) {
      fail('AUTHORIZATION_INVALID', 'A autorização ligada não é mais a da solicitação desta sessão.');
    }
    if (a!.itemId && guide.authorization_id === null) {
      fail('AUTHORIZATION_INVALID', 'A guia desta sessão não leva a autorização da solicitação.');
    }
    if (consumed.length === 0) {
      const problem = authorizationProblem(a, s.date, Number(r.quantity));
      if (problem) fail('AUTHORIZATION_INVALID', `A autorização não serve para este item: ${problem}.`);
      try {
        await tx.execute(sql`
          INSERT INTO public.hi_authorization_consumptions (clinic_id, item_id, quantity, idempotency_key, created_by)
          VALUES (${args.clinicId}::uuid, ${r.authorization_item_id}::uuid, ${Number(r.quantity)}, ${`extra:${r.id}`}, ${args.actorUserId}::uuid)`);
      } catch (e) {
        mapWriteError(e);
      }
    }
  }
  const [{ next }] = (await tx.execute(sql`
    SELECT coalesce(max(sequence), 0) + 1 AS next FROM public.hi_guide_items
     WHERE clinic_id = ${args.clinicId}::uuid AND guide_id = ${guide.id}::uuid`)) as unknown as [{ next: number }];
  const total = Number(r.quantity) * Number(line.unitValueCents);
  let guideItemId: string;
  try {
    const ins = (await tx.execute(sql`
      INSERT INTO public.hi_guide_items
        (clinic_id, guide_id, guide_type, live, sequence, appointment_id, contract_line_id, authorization_item_id,
         executed_on, table_code, procedure_code, description, quantity, factor_hundredths, unit_value_cents, total_value_cents)
      VALUES (${args.clinicId}::uuid, ${guide.id}::uuid, 'sp_sadt', true, ${Number(next)}, ${r.appointment_id}::uuid,
              ${line.id}::uuid, ${r.requires_authorization ? r.authorization_item_id : null}::uuid, ${s.date}::date,
              ${line.tableCode}, ${line.procedureCode}, ${line.description.slice(0, 150)}, ${Number(r.quantity)}, 100,
              ${Number(line.unitValueCents)}, ${total})
      RETURNING id::text`)) as unknown as Array<{ id: string }>;
    guideItemId = ins[0]!.id;
    await tx.execute(sql`
      UPDATE public.hi_guides g
         SET total_value_cents = s.total, expected_value_cents = s.total
        FROM (SELECT coalesce(sum(total_value_cents), 0) AS total FROM public.hi_guide_items
               WHERE clinic_id = ${args.clinicId}::uuid AND guide_id = ${guide.id}::uuid) s
       WHERE g.clinic_id = ${args.clinicId}::uuid AND g.id = ${guide.id}::uuid`);
    await tx.execute(sql`
      UPDATE public.hi_appointment_extra_items
         SET status = 'included', guide_item_id = ${guideItemId}::uuid
       WHERE clinic_id = ${args.clinicId}::uuid AND id = ${r.id}::uuid`);
  } catch (e) {
    mapWriteError(e);
  }
  return { guideId: guide.id, guideItemId: guideItemId!, existing: false };
}

function checkReason(reason: string, bounds: { min: number; max: number }, what: string): string {
  const t = reason.trim();
  if (t.length < bounds.min || t.length > bounds.max) {
    fail('REASON_REQUIRED', `Explique o motivo ${what} (${bounds.min} a ${bounds.max} caracteres).`);
  }
  return t;
}

/** Faturamento: o item fica registrado e NÃO é faturado, com motivo (quem e quando, pelo banco). */
export async function excludeExtraItemTx(tx: Tx, args: { clinicId: string; itemId: string; reason: string }): Promise<void> {
  await requireAvailable(tx);
  await assertConveniosOperableTx(tx, args.clinicId);
  const reason = checkReason(args.reason, EXCLUSION_REASON, 'de não faturar');
  const { row: r, guideState } = await lockItemTx(tx, args.clinicId, args.itemId);
  if (r.status === 'excluded' || r.status === 'cancelled') fail('ALREADY_DECIDED', 'Este item já foi decidido e não muda.');
  if (r.status === 'included' && (await billedInLiveGuideTx(tx, args.clinicId, r))) {
    fail('ALREADY_DECIDED', 'Este item já está na guia.');
  }
  if (guideState === 'closed') fail('GUIDE_CLOSED', 'A guia desta sessão já foi aprovada. Reabra ou substitua a guia para mudar os itens.');
  try {
    await tx.execute(sql`
      UPDATE public.hi_appointment_extra_items SET status = 'excluded', exclusion_reason = ${reason}
       WHERE clinic_id = ${args.clinicId}::uuid AND id = ${args.itemId}::uuid`);
  } catch (e) {
    mapWriteError(e);
  }
}

/** Cancela o REGISTRO errado (com motivo). Nada é apagado. */
export async function cancelExtraItemTx(tx: Tx, args: { clinicId: string; itemId: string; reason: string }): Promise<void> {
  await requireAvailable(tx);
  await assertConveniosOperableTx(tx, args.clinicId);
  const reason = checkReason(args.reason, CANCEL_REASON, 'do cancelamento');
  const { row: r, guideState } = await lockItemTx(tx, args.clinicId, args.itemId);
  if (r.status === 'cancelled') fail('ALREADY_CANCELLED', 'Este item já foi cancelado.');
  if (r.status !== 'recorded' && r.status !== 'regularized') fail('ALREADY_DECIDED', 'Este item já foi decidido e não muda.');
  if (guideState !== 'none' && guideState !== 'open') {
    fail('GUIDE_CLOSED', 'A guia desta sessão já foi fechada. Reabra ou substitua a guia para mudar os itens.');
  }
  try {
    await tx.execute(sql`
      UPDATE public.hi_appointment_extra_items
         SET status = 'cancelled', cancel_reason = ${reason}
       WHERE clinic_id = ${args.clinicId}::uuid AND id = ${args.itemId}::uuid`);
  } catch (e) {
    mapWriteError(e);
  }
}

/**
 * Itens pendentes das sessões da guia (regra 5): registrados ou regularizados, e os incluídos numa
 * guia que morreu sem que outra guia viva cobre o procedimento. Sem a tabela, nenhum.
 */
export async function pendingExtraItemsForGuideTx(tx: Tx, args: { clinicId: string; guideId: string }): Promise<string[]> {
  if (!(await extraItemsAvailableTx(tx))) return [];
  const rows = (await tx.execute(sql`
    SELECT e.id::text
      FROM public.hi_appointment_extra_items e
     WHERE e.clinic_id = ${args.clinicId}::uuid
       AND e.appointment_id IN (SELECT i.appointment_id FROM public.hi_guide_items i
                                 WHERE i.clinic_id = ${args.clinicId}::uuid AND i.guide_id = ${args.guideId}::uuid
                                   AND i.appointment_id IS NOT NULL)
       AND (e.status IN ('recorded', 'regularized')
            OR (e.status = 'included' AND NOT EXISTS (
                  SELECT 1 FROM public.hi_guide_items x
                   WHERE x.clinic_id = e.clinic_id AND x.appointment_id = e.appointment_id AND x.live
                     AND x.table_code = e.table_code AND x.procedure_code = e.procedure_code)))
     ORDER BY e.recorded_at, e.id`)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** "Aprovar sem o item": registra a não inclusão de TODOS os pendentes da guia, com o mesmo motivo. */
export async function excludePendingExtraItemsForGuideTx(
  tx: Tx,
  args: { clinicId: string; guideId: string; reason: string },
): Promise<string[]> {
  checkReason(args.reason, EXCLUSION_REASON, 'de aprovar sem o item');
  const ids = await pendingExtraItemsForGuideTx(tx, args);
  for (const itemId of ids) await excludeExtraItemTx(tx, { clinicId: args.clinicId, itemId, reason: args.reason });
  return ids;
}
