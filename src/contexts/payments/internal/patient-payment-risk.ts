/** D27 — projeta chargeback sem reescrever o fato clínico. */
import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';
import { publishEvent } from '@/lib/outbox/publish';
import type { ProviderPayment } from '@/lib/payments/asaas';

import { PAYMENTS_EVENTS, type PatientPaymentRiskChangedPayload } from '../events';
import { patientCharges, patientWebhookEvents } from '../schema';

export type PatientPaymentRiskState = PatientPaymentRiskChangedPayload['state'];

const PAID_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);

export function classifyPatientPaymentRisk(
  event: string,
  payment: ProviderPayment,
): PatientPaymentRiskState | null {
  const chargeback = payment.chargebackStatus ?? null;

  if (event === 'PAYMENT_RECEIVED_IN_CASH_UNDONE') {
    return !PAID_STATUSES.has(payment.status) ? 'cash_undone' : null;
  }
  if (payment.status === 'REFUNDED' && chargeback) return 'lost';
  if (chargeback === 'DISPUTE_LOST') return 'lost';
  if (chargeback === 'REQUESTED') return 'requested';
  if (chargeback === 'IN_DISPUTE') return 'in_dispute';
  if (
    event === 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL' &&
    (chargeback === 'REVERSED' || chargeback === 'DONE')
  ) {
    return 'awaiting_reversal';
  }
  if ((chargeback === 'REVERSED' || chargeback === 'DONE') && PAID_STATUSES.has(payment.status)) {
    return 'reversed';
  }
  return null;
}

function canTransitionRisk(
  from: PatientPaymentRiskState | null,
  to: PatientPaymentRiskState,
): boolean {
  if (from === to) return false;
  if (from === 'reversed' || from === 'lost' || from === 'cash_undone') return false;
  if (to === 'lost' || to === 'cash_undone') return true;
  if (from === null) return true;
  if (from === 'requested') {
    return to === 'in_dispute' || to === 'awaiting_reversal' || to === 'reversed';
  }
  if (from === 'in_dispute') return to === 'awaiting_reversal' || to === 'reversed';
  return from === 'awaiting_reversal' && to === 'reversed';
}

function safeReason(reason: string | null | undefined): string | null {
  return reason && /^[A-Z_]{1,80}$/.test(reason) ? reason : null;
}

export type RiskReconcileOutcome = 'changed' | 'ignored' | 'unknown_charge' | 'unchanged';

export async function reconcilePatientPaymentRisk(input: {
  clinicId: string;
  providerPaymentId: string;
  asaasEventId: string;
  eventType: string;
  state: PatientPaymentRiskState;
  reason?: string | null;
  changedAt: Date;
}): Promise<RiskReconcileOutcome> {
  return withTenant(input.clinicId, async (tx) => {
    const dedup = await tx
      .insert(patientWebhookEvents)
      .values({
        clinicId: input.clinicId,
        asaasEventId: input.asaasEventId,
        eventType: input.eventType,
      })
      .onConflictDoNothing()
      .returning({ id: patientWebhookEvents.id });
    if (dedup.length === 0) return 'ignored';

    const [charge] = await tx
      .select({
        id: patientCharges.id,
        appointmentId: patientCharges.appointmentId,
        amount: patientCharges.amount,
        disputeStatus: patientCharges.disputeStatus,
      })
      .from(patientCharges)
      .where(
        and(
          eq(patientCharges.clinicId, input.clinicId),
          eq(patientCharges.providerPaymentId, input.providerPaymentId),
        ),
      )
      .for('update')
      .limit(1);
    if (!charge) return 'unknown_charge';
    if (!canTransitionRisk(charge.disputeStatus, input.state)) return 'unchanged';

    const terminalLoss = input.state === 'lost' || input.state === 'cash_undone';
    await tx
      .update(patientCharges)
      .set({
        disputeStatus: input.state,
        ...(terminalLoss
          ? {
              status: 'refunded' as const,
              refundedAt: input.changedAt,
              holdExpiresAt: null,
            }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(and(eq(patientCharges.id, charge.id), eq(patientCharges.clinicId, input.clinicId)));

    const payload: PatientPaymentRiskChangedPayload = {
      clinicId: input.clinicId,
      appointmentId: charge.appointmentId,
      chargeId: charge.id,
      amount: Number(charge.amount),
      state: input.state,
      reason: safeReason(input.reason),
      changedAt: input.changedAt.toISOString(),
    };
    await publishEvent(tx, {
      clinicId: input.clinicId,
      eventType: PAYMENTS_EVENTS.PATIENT_PAYMENT_RISK_CHANGED,
      payload,
      idempotencyKey: `patient-payment-risk:${charge.id}:${input.state}`,
    });
    return 'changed';
  });
}
