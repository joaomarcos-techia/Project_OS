/**
 * Repasse profissional de convênio (P10.4, D16, 0157).
 *
 * Um repasse por atendimento de convênio, com a regra REAL do Qoro
 * (`professional_payout_rules`, percentual ou fixo, por profissional e procedimento,
 * vigente na data do atendimento) congelada na criação, e a política da clínica (D16:
 * sobre o recebido — padrão —, na aprovação ou na conclusão). Previsto, elegível,
 * autorizado, devido, repassado e pendente vêm de `hi_payout_positions`, calculados ao
 * vivo da conta da guia: nenhuma segunda fonte de verdade.
 *
 * Mesmos critérios do repasse particular para EXISTIR repasse: o plano da clínica tem
 * políticas financeiras avançadas e o profissional é elegível (ativo, não dono, médico
 * ou com conselho). Sem regra cadastrada, não há repasse (nada é inventado).
 *
 * Movimentos só de inclusão: autorização (até o elegível), repasse realizado (registro
 * do pagamento ao profissional; o Qoro não paga ninguém) e ajuste com motivo. Os tetos
 * e a idempotência são do banco, com a linha do repasse travada.
 */
import { and, eq, sql } from 'drizzle-orm';

// eslint-disable-next-line boundaries/element-types -- billingApiV1 é a API versionada de entitlement; mesmo critério do repasse particular.
import { billingApiV1 } from '@/contexts/billing/api';
import type { Tx } from '@/lib/db';

import { hiClinicSettings, hiPayoutMovements, hiPayouts } from '../schema-clinic';

export class InsurancePayoutError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'InsurancePayoutError';
  }
}

type Row = Record<string, unknown>;

/** Cria o repasse do atendimento de convênio, se houver regra e direito. Idempotente. */
export async function ensureInsurancePayoutTx(
  tx: Tx,
  args: { clinicId: string; appointmentId: string; actor?: { kind: 'automation' } | { kind: 'user'; userId: string } },
): Promise<string | null> {
  const { clinicId, appointmentId } = args;
  const [existing] = await tx
    .select({ id: hiPayouts.id })
    .from(hiPayouts)
    .where(and(eq(hiPayouts.clinicId, clinicId), eq(hiPayouts.appointmentId, appointmentId)))
    .limit(1);
  if (existing) return existing.id;
  if (!(await billingApiV1.hasAdvancedFinancialPolicies(clinicId, tx))) return null;

  // Atendimento faturado por convênio = tem item em guia viva (a fonte de verdade é a guia).
  const [ap] = (await tx.execute(sql`
    SELECT a.doctor_id, a.procedure_id, a.scheduled_at
      FROM public.appointments a
     WHERE a.clinic_id = ${clinicId}::uuid AND a.id = ${appointmentId}::uuid
       AND EXISTS (SELECT 1 FROM public.hi_guide_items gi
                    WHERE gi.clinic_id = a.clinic_id AND gi.appointment_id = a.id AND gi.live)`)) as unknown as Row[];
  if (!ap || !ap.doctor_id) return null;
  const professionalId = String(ap.doctor_id);

  // Mesmo critério do repasse particular (payout-professional-eligibility.ts).
  const eligible = (await tx.execute(sql`
    SELECT 1 FROM public.profiles
     WHERE id = ${professionalId}::uuid AND clinic_id = ${clinicId}::uuid AND deleted_at IS NULL AND ativo = true
       AND role <> 'owner' AND (role = 'doctor' OR (crm IS NOT NULL AND btrim(crm) <> ''))
     LIMIT 1`)) as unknown as Row[];
  if (eligible.length === 0) return null;

  // Regra vigente na data do atendimento: a do procedimento vence a geral.
  const [rule] = (await tx.execute(sql`
    SELECT r.id, r.kind, r.percentage, r.fixed_amount
      FROM public.professional_payout_rules r
     WHERE r.clinic_id = ${clinicId}::uuid AND r.professional_id = ${professionalId}::uuid
       AND (r.procedure_id = ${ap.procedure_id ?? null}::uuid OR r.procedure_id IS NULL)
       AND r.effective_from <= ${ap.scheduled_at}::timestamptz
       AND (r.effective_to IS NULL OR r.effective_to > ${ap.scheduled_at}::timestamptz)
     ORDER BY (r.procedure_id IS NOT NULL) DESC
     LIMIT 1`)) as unknown as Row[];
  if (!rule) return null;

  const [settings] = await tx
    .select({ payoutEligibility: hiClinicSettings.payoutEligibility })
    .from(hiClinicSettings)
    .where(eq(hiClinicSettings.clinicId, clinicId))
    .limit(1);
  const actor = args.actor ?? { kind: 'automation' as const };
  const [created] = await tx
    .insert(hiPayouts)
    .values({
      clinicId,
      appointmentId,
      professionalId,
      procedureId: ap.procedure_id ? String(ap.procedure_id) : null,
      ruleId: String(rule.id),
      ruleKind: rule.kind === 'fixed' ? 'fixed' : 'percentage',
      rulePercentage: rule.kind === 'fixed' ? null : String(rule.percentage),
      ruleFixedCents: rule.kind === 'fixed' ? Math.round(Number(rule.fixed_amount) * 100) : null,
      eligibility: settings?.payoutEligibility ?? 'on_receipt',
      status: 'active',
      createdVia: actor.kind === 'user' ? 'user' : 'automation',
      createdBy: actor.kind === 'user' ? actor.userId : null,
    })
    .onConflictDoNothing()
    .returning({ id: hiPayouts.id });
  if (created) return created.id;
  const [winner] = await tx
    .select({ id: hiPayouts.id })
    .from(hiPayouts)
    .where(and(eq(hiPayouts.clinicId, clinicId), eq(hiPayouts.appointmentId, appointmentId)))
    .limit(1);
  return winner?.id ?? null;
}

/** Cria os repasses que faltam (atendimentos de convênio com guia viva), sob demanda da clínica. */
export async function syncInsurancePayoutsTx(tx: Tx, clinicId: string, actorUserId: string): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT DISTINCT gi.appointment_id FROM public.hi_guide_items gi
     WHERE gi.clinic_id = ${clinicId}::uuid AND gi.live AND gi.appointment_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.hi_payouts p WHERE p.clinic_id = gi.clinic_id AND p.appointment_id = gi.appointment_id)
     LIMIT 500`)) as unknown as Row[];
  let n = 0;
  for (const r of rows) {
    const id = await ensureInsurancePayoutTx(tx, {
      clinicId,
      appointmentId: String(r.appointment_id),
      actor: { kind: 'user', userId: actorUserId },
    });
    if (id) n += 1;
  }
  return n;
}

async function movement(
  tx: Tx,
  values: typeof hiPayoutMovements.$inferInsert,
): Promise<string> {
  const [m] = await tx.insert(hiPayoutMovements).values(values).returning({ id: hiPayoutMovements.id });
  return m!.id;
}

export function authorizeInsurancePayoutTx(
  tx: Tx,
  a: { clinicId: string; payoutId: string; amountCents: number; idempotencyKey: string; actorUserId: string },
) {
  return movement(tx, {
    clinicId: a.clinicId,
    payoutId: a.payoutId,
    kind: 'authorization',
    amountCents: a.amountCents,
    idempotencyKey: a.idempotencyKey,
    createdBy: a.actorUserId,
  });
}

export function settleInsurancePayoutTx(
  tx: Tx,
  a: { clinicId: string; payoutId: string; amountCents: number; paidOn: string; reference: string | null; idempotencyKey: string; actorUserId: string },
) {
  return movement(tx, {
    clinicId: a.clinicId,
    payoutId: a.payoutId,
    kind: 'settlement',
    amountCents: a.amountCents,
    paidOn: a.paidOn,
    reference: a.reference,
    idempotencyKey: a.idempotencyKey,
    createdBy: a.actorUserId,
  });
}

export function adjustInsurancePayoutTx(
  tx: Tx,
  a: { clinicId: string; payoutId: string; amountCents: number; reason: string; idempotencyKey: string; actorUserId: string },
) {
  if (a.amountCents === 0) throw new InsurancePayoutError('ajuste de valor zero', 'invalid');
  return movement(tx, {
    clinicId: a.clinicId,
    payoutId: a.payoutId,
    kind: 'adjustment',
    amountCents: a.amountCents,
    reason: a.reason,
    idempotencyKey: a.idempotencyKey,
    createdBy: a.actorUserId,
  });
}

/** Cancela o repasse (ex.: atendimento cancelado) — só sem nada repassado; o histórico fica. */
export async function cancelInsurancePayoutTx(
  tx: Tx,
  a: { clinicId: string; payoutId: string; reason: string; actorUserId: string },
): Promise<void> {
  const [pos] = (await tx.execute(sql`
    SELECT settled_cents FROM public.hi_payout_positions WHERE clinic_id = ${a.clinicId}::uuid AND payout_id = ${a.payoutId}::uuid`)) as unknown as Row[];
  if (!pos) throw new InsurancePayoutError('repasse inexistente nesta clínica', 'not_found');
  if (Number(pos.settled_cents) > 0) {
    throw new InsurancePayoutError('já houve repasse realizado: registre um ajuste em vez de cancelar', 'has_settlement');
  }
  const [row] = await tx
    .update(hiPayouts)
    .set({ status: 'cancelled', cancelReason: a.reason, cancelledBy: a.actorUserId, cancelledAt: new Date() })
    .where(and(eq(hiPayouts.clinicId, a.clinicId), eq(hiPayouts.id, a.payoutId), eq(hiPayouts.status, 'active')))
    .returning({ id: hiPayouts.id });
  if (!row) throw new InsurancePayoutError('repasse já cancelado', 'state');
}

export interface InsurancePayoutPosition {
  payoutId: string;
  appointmentId: string;
  professionalId: string;
  eligibility: string;
  status: string;
  ruleKind: string;
  rulePercentage: number | null;
  ruleFixedCents: number | null;
  guideId: string | null;
  guideStatus: string | null;
  itemValueCents: number;
  netDueCents: number;
  receivedCents: number;
  glossDefinitiveCents: number;
  glossOpenCents: number;
  forecastCents: number;
  eligibleCents: number | null;
  decision: string | null;
  authorizedCents: number;
  adjustmentsCents: number;
  settledCents: number;
  dueCents: number;
  pendingAuthorizationCents: number;
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

export async function listInsurancePayoutPositionsTx(
  tx: Tx,
  clinicId: string,
  f: { professionalId?: string; payoutId?: string } = {},
): Promise<InsurancePayoutPosition[]> {
  const rows = (await tx.execute(sql`
    SELECT * FROM public.hi_payout_positions
     WHERE clinic_id = ${clinicId}::uuid
       AND (${f.professionalId ?? null}::uuid IS NULL OR professional_id = ${f.professionalId ?? null}::uuid)
       AND (${f.payoutId ?? null}::uuid IS NULL OR payout_id = ${f.payoutId ?? null}::uuid)
     ORDER BY created_at DESC LIMIT 500`)) as unknown as Row[];
  return rows.map((r) => ({
    payoutId: String(r.payout_id),
    appointmentId: String(r.appointment_id),
    professionalId: String(r.professional_id),
    eligibility: String(r.eligibility),
    status: String(r.status),
    ruleKind: String(r.rule_kind),
    rulePercentage: r.rule_percentage === null ? null : Number(r.rule_percentage),
    ruleFixedCents: r.rule_fixed_cents === null ? null : Number(r.rule_fixed_cents),
    guideId: r.guide_id ? String(r.guide_id) : null,
    guideStatus: r.guide_status ? String(r.guide_status) : null,
    itemValueCents: num(r.item_value_cents),
    netDueCents: num(r.net_due_cents),
    receivedCents: num(r.received_cents),
    glossDefinitiveCents: num(r.gloss_definitive_cents),
    glossOpenCents: num(r.gloss_open_cents),
    forecastCents: num(r.forecast_cents),
    eligibleCents: r.eligible_cents === null ? null : Number(r.eligible_cents),
    decision: r.decision ? String(r.decision) : null,
    authorizedCents: num(r.authorized_cents),
    adjustmentsCents: num(r.adjustments_cents),
    settledCents: num(r.settled_cents),
    dueCents: num(r.due_cents),
    pendingAuthorizationCents: num(r.pending_authorization_cents),
  }));
}
