/**
 * Cobrança da coparticipação confirmada (P10.5): o ÚNICO caminho Asaas do convênio.
 *
 * Condições, conferidas no servidor (e de novo no banco):
 *  - assinatura com direito a cobrança de pacientes, fora do trial (decisão central do
 *    #53/D24: `patient_charges`);
 *  - coparticipação CONFIRMADA por uma pessoa, com valor cobrável > 0;
 *  - o recebível do paciente existe e vale exatamente o cobrável confirmado (a 0148
 *    recusa qualquer recebível de convênio acima dele); o valor enviado ao gateway é o
 *    saldo desse recebível, nunca o valor do atendimento;
 *  - sem cobrança anterior (pedido repetido devolve a existente, sem nova chamada);
 *  - conta Asaas ativa e CPF do paciente (o Pagamentos confere).
 * O estado (confirmada → cobrada → paga → estornada) anda só por
 * `hi_copay_sync_charge` (0158), a partir da cobrança e do livro: idempotente.
 */
import { and, eq, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { assertPremiumFeatureTx } from '@/lib/premium-access';

import { hiCopayments } from '../schema-clinic';

export class CopayChargeError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'CopayChargeError';
  }
}

export interface CopayChargeDeps {
  /** O Pagamentos (paymentsApiV1.createCopayCheckout); nos testes, um mock. */
  createCheckout(input: {
    clinicId: string;
    appointmentId: string;
    patientId: string;
    maxAmount: number;
  }): Promise<{ outcome: string; amount: number | null }>;
}

export async function syncCopayChargeTx(tx: Tx, clinicId: string, copaymentId: string): Promise<string> {
  const rows = (await tx.execute(
    sql`SELECT public.hi_copay_sync_charge(${clinicId}::uuid, ${copaymentId}::uuid) AS status`,
  )) as unknown as Array<{ status: string }>;
  return rows[0]!.status;
}

export async function requestCopayCharge(
  deps: CopayChargeDeps,
  args: { clinicId: string; copaymentId: string; actorUserId: string },
): Promise<{ outcome: string; status: string; amountCents: number | null }> {
  const { clinicId, copaymentId, actorUserId } = args;
  const plan = await withTenant(
    clinicId,
    async (tx) => {
      await assertPremiumFeatureTx(tx, clinicId, 'patient_charges');
      const [c] = await tx
        .select()
        .from(hiCopayments)
        .where(and(eq(hiCopayments.clinicId, clinicId), eq(hiCopayments.id, copaymentId)))
        .limit(1);
      if (!c) throw new CopayChargeError('coparticipação inexistente nesta clínica', 'not_found');
      if (c.status === 'charged' || c.status === 'paid') return { already: c.status } as const;
      if (c.status !== 'confirmed') {
        throw new CopayChargeError(`só se cobra coparticipação confirmada (estado: ${c.status})`, 'not_confirmed');
      }
      const chargeable = Number(c.chargeableCents ?? 0);
      if (!(chargeable > 0)) throw new CopayChargeError('coparticipação sem valor a cobrar', 'zero');
      const [l] = (await tx.execute(sql`
        SELECT valor, valor_pago, status::text AS status FROM public.lancamentos
         WHERE clinic_id = ${clinicId}::uuid AND appointment_id = ${c.appointmentId}::uuid AND tipo = 'receber' LIMIT 1`)) as unknown as Array<{ valor: string; valor_pago: string; status: string }>;
      if (!l) throw new CopayChargeError('o recebível da coparticipação ainda não existe; tente em instantes', 'no_receivable');
      const valueCents = Math.round(Number(l.valor) * 100);
      if (valueCents !== chargeable) {
        throw new CopayChargeError('o recebível não confere com a coparticipação confirmada; nada foi cobrado', 'mismatch');
      }
      const balanceCents = valueCents - Math.round(Number(l.valor_pago) * 100);
      if (balanceCents <= 0) throw new CopayChargeError('a coparticipação já foi paga', 'paid');
      return { appointmentId: c.appointmentId, patientId: c.patientId, chargeable, balanceCents } as const;
    },
    actorUserId,
  );
  if ('already' in plan) {
    return { outcome: 'existing', status: plan.already ?? 'charged', amountCents: null };
  }
  const out = await deps.createCheckout({
    clinicId,
    appointmentId: plan.appointmentId,
    patientId: plan.patientId,
    maxAmount: plan.chargeable / 100,
  });
  if (out.amount !== null && Math.round(out.amount * 100) > plan.chargeable) {
    // Defesa em profundidade: nunca deveria acontecer (o Pagamentos confere o teto).
    throw new CopayChargeError('o gateway recebeu valor acima do confirmado', 'above_confirmed');
  }
  const status = await withTenant(clinicId, (tx) => syncCopayChargeTx(tx, clinicId, copaymentId), actorUserId);
  return { outcome: out.outcome, status, amountCents: out.amount === null ? null : Math.round(out.amount * 100) };
}

/** Coparticipações confirmadas ou em cobrança, para a tela. */
export async function listCopayChargesTx(tx: Tx, clinicId: string) {
  const rows = (await tx.execute(sql`
    SELECT c.id, c.status, c.chargeable_cents, c.received_cents, c.appointment_id, p.nome AS patient_name, a.scheduled_at,
           pc.status::text AS charge_status, pc.invoice_url IS NOT NULL AS has_link
      FROM public.hi_copayments c
      JOIN public.patients p ON p.clinic_id = c.clinic_id AND p.id = c.patient_id
      JOIN public.appointments a ON a.clinic_id = c.clinic_id AND a.id = c.appointment_id
      LEFT JOIN public.patient_charges pc ON pc.clinic_id = c.clinic_id AND pc.appointment_id = c.appointment_id AND pc.kind = 'remainder'
     WHERE c.clinic_id = ${clinicId}::uuid AND c.status IN ('confirmed', 'charged', 'paid', 'refunded')
     ORDER BY a.scheduled_at DESC LIMIT 200`)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    status: String(r.status),
    chargeableCents: Number(r.chargeable_cents ?? 0),
    receivedCents: Number(r.received_cents ?? 0),
    appointmentId: String(r.appointment_id),
    patientName: String(r.patient_name ?? ''),
    scheduledAt: r.scheduled_at instanceof Date ? r.scheduled_at.toISOString() : String(r.scheduled_at ?? ''),
    chargeStatus: r.charge_status ? String(r.charge_status) : null,
    hasLink: r.has_link === true,
  }));
}

/**
 * Depois da baixa do gateway: põe a coparticipação do atendimento na situação do
 * dinheiro (cobrada → paga; paga → estornada), pela mesma função do banco do botão
 * "Atualizar situação". Idempotente; `null` quando o atendimento não tem
 * coparticipação em cobrança (particular, sinal, convênio sem coparticipação).
 */
export async function syncCopayForAppointment(
  clinicId: string,
  appointmentId: string,
): Promise<{ copaymentId: string; before: string; after: string } | null> {
  return withTenant(clinicId, async (tx) => {
    const [c] = await tx
      .select({ id: hiCopayments.id, status: hiCopayments.status })
      .from(hiCopayments)
      .where(and(eq(hiCopayments.clinicId, clinicId), eq(hiCopayments.appointmentId, appointmentId)))
      .limit(1);
    if (!c || !['confirmed', 'charged', 'paid'].includes(c.status)) return null;
    const after = await syncCopayChargeTx(tx, clinicId, c.id);
    return { copaymentId: c.id, before: c.status, after };
  });
}

export interface CopaySyncSummary {
  candidates: number;
  changed: number;
  unchanged: number;
  failed: number;
  skippedForBudget: number;
}

/** Garantia do cron (financial-reconcile): sincroniza cada candidato sob RLS, com teto de tempo. */
export async function reconcileCopayCharges(
  candidates: ReadonlyArray<{ clinicId: string; copaymentId: string }>,
  opts: { deadlineAt?: number; now?: () => number } = {},
): Promise<CopaySyncSummary> {
  const now = opts.now ?? Date.now;
  const summary: CopaySyncSummary = { candidates: candidates.length, changed: 0, unchanged: 0, failed: 0, skippedForBudget: 0 };
  for (const [index, c] of candidates.entries()) {
    if (opts.deadlineAt !== undefined && now() >= opts.deadlineAt) {
      summary.skippedForBudget = candidates.length - index;
      break;
    }
    try {
      const moved = await withTenant(c.clinicId, async (tx) => {
        const [row] = await tx
          .select({ status: hiCopayments.status })
          .from(hiCopayments)
          .where(and(eq(hiCopayments.clinicId, c.clinicId), eq(hiCopayments.id, c.copaymentId)))
          .limit(1);
        if (!row) return false;
        return (await syncCopayChargeTx(tx, c.clinicId, c.copaymentId)) !== row.status;
      });
      if (moved) summary.changed += 1;
      else summary.unchanged += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}
