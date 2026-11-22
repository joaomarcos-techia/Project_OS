/**
 * P8.4 — itens executados adicionais da sessão SP/SADT (registro opcional no consultório e na
 * conferência; o médico não é obrigado, a recepção completa).
 *
 * Tabela `hi_appointment_extra_items` = migration CANDIDATA 0167 (docs/convenios/migrations),
 * fora do journal até a aplicação ser autorizada. Por isso o acesso é por SQL e começa por
 * `extraItemsAvailableTx`: sem a tabela, a função diz "indisponível" e nada quebra.
 *
 * Regras (as do banco, conferidas antes para devolver mensagem de regra, não erro técnico):
 *  - só atendimento de convênio SP/SADT, na clínica da sessão (RLS), em atendimento ou atendido;
 *  - só item de CONTRATO SP/SADT da operadora do atendimento, vigente NA DATA DA SESSÃO; código,
 *    descrição e "exige autorização" vêm da linha (o banco copia); nenhum campo clínico;
 *  - um item ativo por procedimento (mais de um = quantidade, 1 a 999);
 *  - guia da sessão já fechada (aprovada em diante): nem inclusão nem cancelamento;
 *  - cancelar exige motivo; cancelado não volta; nada é apagado.
 *
 * FATURAMENTO: decidido por `resolveExtraItemBilling` com a política vigente (P8.4-r). Enquanto
 * ela for `undecided`, este módulo NÃO toca na guia: o item fica registrado e a conferência
 * mostra a pendência.
 */
import { and, eq, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

import { hiAppointmentCoverages, hiProcedureContracts } from '../schema-clinic';
import { selectEffectiveContract, type ContractLine } from '../tiss/assembly/contract-selection';
import {
  ACTIVE_EXTRA_ITEM_POLICY,
  resolveExtraItemBilling,
  type ExtraItemBilling,
  type ExtraItemPolicy,
} from './extra-item-policy';
import { assertConveniosOperableTx } from './module-guard';

export type ExtraItemErrorCode =
  | 'NOT_AVAILABLE'
  | 'APPOINTMENT_NOT_FOUND'
  | 'APPOINTMENT_NOT_EXECUTED'
  | 'NOT_SADT'
  | 'CONTRACT_INVALID'
  | 'CONTRACT_NOT_EFFECTIVE'
  | 'CONTRACT_AMBIGUOUS'
  | 'QUANTITY_INVALID'
  | 'SOURCE_INVALID'
  | 'DUPLICATE'
  | 'GUIDE_CLOSED'
  | 'ITEM_NOT_FOUND'
  | 'ALREADY_CANCELLED'
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

export type ExtraItemSource = 'consultorio' | 'conferencia';

export interface ExtraItemView {
  id: string;
  tableCode: string;
  procedureCode: string;
  description: string;
  quantity: number;
  requiresAuthorization: boolean;
  source: ExtraItemSource;
  status: 'active' | 'cancelled';
  recordedBy: string;
  recordedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  /** Só para itens ativos; null nos cancelados. */
  billing: ExtraItemBilling | null;
}

const EXECUTED_STATUSES = new Set(['em_atendimento', 'atendido']);

function pgError(e: unknown): { code: string | undefined; constraint: string | undefined } {
  const err = e as { code?: string; constraint_name?: string; cause?: unknown };
  if (err?.code) return { code: err.code, constraint: err.constraint_name };
  const cause = err?.cause as { code?: string; constraint_name?: string } | undefined;
  return { code: cause?.code, constraint: cause?.constraint_name };
}

/** A tabela da candidata 0167 existe neste banco? */
export async function extraItemsAvailableTx(tx: Tx): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT to_regclass('public.hi_appointment_extra_items') IS NOT NULL AS ok`,
  )) as unknown as Array<{ ok: boolean }>;
  return rows[0]?.ok === true;
}

async function requireAvailable(tx: Tx): Promise<void> {
  if (!(await extraItemsAvailableTx(tx))) {
    throw new ExtraItemRuleError('NOT_AVAILABLE', 'Itens executados adicionais ainda não estão disponíveis neste ambiente.');
  }
}

interface SessionFacts {
  status: string;
  date: string;
  insurerId: string;
  planId: string | null;
  membershipId: string | null;
  guideType: string;
  coverageStatus: string;
}

async function sessionFactsTx(tx: Tx, clinicId: string, appointmentId: string): Promise<SessionFacts> {
  const rows = (await tx.execute(sql`
    SELECT a.status::text AS status,
           (a.scheduled_at AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'))::date::text AS date
      FROM public.appointments a
      JOIN public.clinics c ON c.id = a.clinic_id
     WHERE a.clinic_id = ${clinicId}::uuid AND a.id = ${appointmentId}::uuid`)) as unknown as Array<{
    status: string;
    date: string;
  }>;
  const ap = rows[0];
  if (!ap) throw new ExtraItemRuleError('APPOINTMENT_NOT_FOUND', 'Atendimento não encontrado nesta clínica.');
  const [cov] = await tx
    .select({
      guideType: hiAppointmentCoverages.guideType,
      insurerId: hiAppointmentCoverages.insurerId,
      planId: hiAppointmentCoverages.planId,
      membershipId: hiAppointmentCoverages.membershipId,
      status: hiAppointmentCoverages.status,
    })
    .from(hiAppointmentCoverages)
    .where(and(eq(hiAppointmentCoverages.clinicId, clinicId), eq(hiAppointmentCoverages.appointmentId, appointmentId)))
    .limit(1);
  if (!cov || cov.guideType !== 'sp_sadt' || cov.status === 'cancelled') {
    throw new ExtraItemRuleError('NOT_SADT', 'Item executado adicional só em atendimento de convênio SP/SADT.');
  }
  return {
    status: ap.status,
    date: ap.date,
    insurerId: cov.insurerId,
    planId: cov.planId,
    membershipId: cov.membershipId,
    guideType: cov.guideType,
    coverageStatus: cov.status,
  };
}

/** Autorização concedida que cobre o procedimento para a carteirinha e a operadora, com saldo livre. */
async function grantedAuthorizationTx(
  tx: Tx,
  clinicId: string,
  s: SessionFacts,
  tableCode: string,
  procedureCode: string,
): Promise<{ itemId: string; remaining: number } | null> {
  if (!s.membershipId) return null;
  const rows = (await tx.execute(sql`
    SELECT i.id::text AS item_id, (i.quantity_authorized - i.quantity_consumed)::int AS remaining
      FROM public.hi_authorization_items i
      JOIN public.hi_authorizations a ON a.clinic_id = i.clinic_id AND a.id = i.authorization_id
     WHERE i.clinic_id = ${clinicId}::uuid AND a.insurer_id = ${s.insurerId}::uuid
       AND a.membership_id = ${s.membershipId}::uuid AND a.guide_type = 'sp_sadt'
       AND a.status IN ('authorized', 'partially_authorized')
       AND (a.password_valid_until IS NULL OR a.password_valid_until >= ${s.date}::date)
       AND i.table_code = ${tableCode} AND i.procedure_code = ${procedureCode}
       AND i.quantity_authorized - i.quantity_consumed > 0
     ORDER BY remaining DESC, i.id
     LIMIT 1`)) as unknown as Array<{ item_id: string; remaining: number }>;
  const r = rows[0];
  return r ? { itemId: r.item_id, remaining: Number(r.remaining) } : null;
}

interface ExtraItemRow {
  id: string;
  table_code: string;
  procedure_code: string;
  description: string;
  quantity: number;
  requires_authorization: boolean;
  source: ExtraItemSource;
  status: 'active' | 'cancelled';
  recorded_by: string;
  recorded_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

/**
 * Itens da sessão, com a decisão de faturamento de cada ativo pela política vigente. `policy` só
 * existe para a prova de banco exercitar as alternativas; o app usa sempre a vigente.
 */
export async function listExtraItemsTx(
  tx: Tx,
  args: { clinicId: string; appointmentId: string; policy?: ExtraItemPolicy },
): Promise<ExtraItemView[]> {
  if (!(await extraItemsAvailableTx(tx))) return [];
  const policy = args.policy ?? ACTIVE_EXTRA_ITEM_POLICY;
  const rows = (await tx.execute(sql`
    SELECT id::text, table_code, procedure_code, description, quantity, requires_authorization, source, status,
           recorded_by::text, recorded_at::text, cancelled_at::text, cancel_reason
      FROM public.hi_appointment_extra_items
     WHERE clinic_id = ${args.clinicId}::uuid AND appointment_id = ${args.appointmentId}::uuid
     ORDER BY recorded_at, id`)) as unknown as ExtraItemRow[];
  if (rows.length === 0) return [];
  const facts = rows.some((r) => r.status === 'active' && r.requires_authorization) && policy === 'post_authorization'
    ? await sessionFactsTx(tx, args.clinicId, args.appointmentId)
    : null;
  const out: ExtraItemView[] = [];
  for (const r of rows) {
    let billing: ExtraItemBilling | null = null;
    if (r.status === 'active') {
      const granted = facts && r.requires_authorization
        ? await grantedAuthorizationTx(tx, args.clinicId, facts, r.table_code, r.procedure_code)
        : null;
      billing = resolveExtraItemBilling(policy, {
        requiresAuthorization: r.requires_authorization,
        quantity: Number(r.quantity),
        grantedAuthorization: granted,
      });
    }
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
      cancelledAt: r.cancelled_at,
      cancelReason: r.cancel_reason,
      billing,
    });
  }
  return out;
}

function mapWriteError(e: unknown): never {
  const { code, constraint } = pgError(e);
  if (code === '23505' && constraint === 'hi_extra_items_active_uniq') {
    throw new ExtraItemRuleError('DUPLICATE', 'Este procedimento já está registrado nesta sessão. Para mudar a quantidade, cancele e registre de novo.');
  }
  if (code === '23514' && constraint === 'hi_extra_item_guide_closed') {
    throw new ExtraItemRuleError('GUIDE_CLOSED', 'A guia desta sessão já foi fechada. Reabra ou substitua a guia para mudar os itens.');
  }
  if (code === '23514' && constraint === 'hi_extra_item_contract') {
    throw new ExtraItemRuleError('CONTRACT_INVALID', 'O item precisa ser do contrato SP/SADT da operadora do atendimento.');
  }
  if (code === '23514' && constraint === 'hi_extra_item_coverage') {
    throw new ExtraItemRuleError('NOT_SADT', 'Item executado adicional só em atendimento de convênio SP/SADT.');
  }
  if (code === '23514' && constraint === 'hi_extra_item_closed') {
    throw new ExtraItemRuleError('ALREADY_CANCELLED', 'Este item já foi cancelado.');
  }
  throw e;
}

/** Registra um item executado adicional (só item de contrato). */
export async function recordExtraItemTx(
  tx: Tx,
  args: { clinicId: string; appointmentId: string; contractLineId: string; quantity: number; source: ExtraItemSource },
): Promise<{ id: string }> {
  await requireAvailable(tx);
  await assertConveniosOperableTx(tx, args.clinicId);
  if (!Number.isInteger(args.quantity) || args.quantity < 1 || args.quantity > 999) {
    throw new ExtraItemRuleError('QUANTITY_INVALID', 'A quantidade precisa ser um número inteiro de 1 a 999.');
  }
  if (args.source !== 'consultorio' && args.source !== 'conferencia') {
    throw new ExtraItemRuleError('SOURCE_INVALID', 'Origem do registro inválida.');
  }
  const s = await sessionFactsTx(tx, args.clinicId, args.appointmentId);
  if (!EXECUTED_STATUSES.has(s.status)) {
    throw new ExtraItemRuleError('APPOINTMENT_NOT_EXECUTED', 'Itens executados só podem ser registrados com o atendimento em andamento ou concluído.');
  }
  // A linha precisa ser A vigente na data da sessão para aquele procedimento (o valor sai dela).
  const [line] = (await tx
    .select()
    .from(hiProcedureContracts)
    .where(and(eq(hiProcedureContracts.clinicId, args.clinicId), eq(hiProcedureContracts.id, args.contractLineId)))
    .limit(1)) as unknown as ContractLine[];
  if (!line || line.guideType !== 'sp_sadt' || line.insurerId !== s.insurerId) {
    throw new ExtraItemRuleError('CONTRACT_INVALID', 'O item precisa ser do contrato SP/SADT da operadora do atendimento.');
  }
  const lines = (await tx
    .select()
    .from(hiProcedureContracts)
    .where(
      and(
        eq(hiProcedureContracts.clinicId, args.clinicId),
        eq(hiProcedureContracts.insurerId, s.insurerId),
        eq(hiProcedureContracts.guideType, 'sp_sadt'),
      ),
    )) as unknown as ContractLine[];
  const sel = selectEffectiveContract(lines, {
    insurerId: s.insurerId,
    planId: s.planId,
    guideType: 'sp_sadt',
    tableCode: line.tableCode,
    procedureCode: line.procedureCode,
    date: s.date,
  });
  if (sel.kind === 'ambiguous') {
    throw new ExtraItemRuleError('CONTRACT_AMBIGUOUS', `Há mais de um valor de contrato vigente em ${s.date} para ${line.tableCode}/${line.procedureCode}.`);
  }
  if (sel.kind !== 'found' || sel.line.id !== line.id) {
    throw new ExtraItemRuleError('CONTRACT_NOT_EFFECTIVE', `Esta linha do contrato não é a vigente em ${s.date} para ${line.tableCode}/${line.procedureCode}.`);
  }
  try {
    // Código, descrição e "exige autorização" são copiados da linha pelo banco; vão aqui só porque
    // as colunas são NOT NULL (o gatilho sobrescreve).
    const rows = (await tx.execute(sql`
      INSERT INTO public.hi_appointment_extra_items
        (clinic_id, appointment_id, contract_line_id, table_code, procedure_code, description,
         requires_authorization, quantity, source, recorded_by)
      VALUES (${args.clinicId}::uuid, ${args.appointmentId}::uuid, ${args.contractLineId}::uuid,
              ${line.tableCode}, ${line.procedureCode}, ${line.description.slice(0, 150)},
              ${line.requiresAuthorization}, ${args.quantity}, ${args.source},
              '00000000-0000-0000-0000-000000000000'::uuid)
      RETURNING id::text`)) as unknown as Array<{ id: string }>;
    return { id: rows[0]!.id };
  } catch (e) {
    mapWriteError(e);
  }
}

/** Cancela um item (com motivo). Nada é apagado. */
export async function cancelExtraItemTx(
  tx: Tx,
  args: { clinicId: string; itemId: string; reason: string },
): Promise<void> {
  await requireAvailable(tx);
  await assertConveniosOperableTx(tx, args.clinicId);
  const reason = args.reason.trim();
  if (reason.length < 3 || reason.length > 300) {
    throw new ExtraItemRuleError('REASON_REQUIRED', 'Explique o motivo do cancelamento (3 a 300 caracteres).');
  }
  let rows: Array<{ id: string }>;
  try {
    rows = (await tx.execute(sql`
      UPDATE public.hi_appointment_extra_items
         SET status = 'cancelled', cancel_reason = ${reason},
             cancelled_by = '00000000-0000-0000-0000-000000000000'::uuid, cancelled_at = now()
       WHERE clinic_id = ${args.clinicId}::uuid AND id = ${args.itemId}::uuid
      RETURNING id::text`)) as unknown as Array<{ id: string }>;
  } catch (e) {
    mapWriteError(e);
  }
  if (rows.length === 0) throw new ExtraItemRuleError('ITEM_NOT_FOUND', 'Item não encontrado nesta clínica.');
}
