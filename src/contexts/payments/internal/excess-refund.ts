/** D50 — estorno parcial do valor que não coube no recebível. */
import 'server-only';

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';
import { metrics } from '@/lib/observability/metrics';
import { publishEvent } from '@/lib/outbox/publish';
import { getClinicAsaasClient } from '@/lib/payments/account-store';
import {
  BillingCircuitOpenError,
  BillingProviderError,
  BillingProviderUnreachableError,
  type ProviderRefund,
} from '@/lib/payments/asaas';

/* eslint-disable boundaries/element-types -- contrato público do produtor Financial. */
import type { ExcessRefundRequestedPayload } from '@/contexts/financial';
/* eslint-enable boundaries/element-types */

import { PAYMENTS_EVENTS, type ExcessRefundConfirmedPayload } from '../events';
import { patientCharges, patientRefundIntents } from '../schema';

const CONFIRMED_REFUND_STATUSES = new Set(['REFUNDED', 'DONE', 'CONFIRMED', 'COMPLETED']);
const REJECTED_REFUND_STATUSES = new Set(['DENIED', 'REFUND_DENIED', 'FAILED']);
const DESCRIPTION = 'Estorno de valor pago acima do saldo do atendimento';

export function confirmedRefundTotal(refunds: readonly ProviderRefund[]): number {
  return Number(
    refunds
      .filter((refund) => CONFIRMED_REFUND_STATUSES.has(refund.status))
      .reduce((total, refund) => total + refund.value, 0)
      .toFixed(2),
  );
}

interface ClaimedRefundIntent {
  id: string;
  providerPaymentId: string;
  amount: number;
}

async function claimRefundIntent(input: {
  clinicId: string;
  payload: ExcessRefundRequestedPayload;
  sourceEventId: string;
}): Promise<ClaimedRefundIntent | null> {
  return withTenant(input.clinicId, async (tx) => {
    const [charge] = await tx
      .select({ id: patientCharges.id, providerPaymentId: patientCharges.providerPaymentId })
      .from(patientCharges)
      .where(
        and(
          eq(patientCharges.id, input.payload.chargeId),
          eq(patientCharges.clinicId, input.clinicId),
          eq(patientCharges.status, 'paid'),
        ),
      )
      .limit(1);
    if (!charge?.providerPaymentId) {
      throw new Error(`[payments] cobrança paga sem payment id: ${input.payload.chargeId}`);
    }

    await tx
      .insert(patientRefundIntents)
      .values({
        clinicId: input.clinicId,
        patientChargeId: charge.id,
        purpose: 'excess',
        amount: input.payload.amount.toFixed(2),
        status: 'pending',
        providerPaymentId: charge.providerPaymentId,
        sourceEventId: input.sourceEventId,
      })
      .onConflictDoNothing();

    const [intent] = await tx
      .select({
        id: patientRefundIntents.id,
        amount: patientRefundIntents.amount,
        providerPaymentId: patientRefundIntents.providerPaymentId,
        status: patientRefundIntents.status,
      })
      .from(patientRefundIntents)
      .where(
        and(
          eq(patientRefundIntents.clinicId, input.clinicId),
          eq(patientRefundIntents.patientChargeId, charge.id),
          eq(patientRefundIntents.purpose, 'excess'),
        ),
      )
      .limit(1);
    if (!intent) throw new Error(`[payments] intenção de estorno não foi persistida`);
    if (Number(intent.amount) !== input.payload.amount) {
      throw new Error(`[payments] valor divergente na intenção de estorno ${intent.id}`);
    }
    if (intent.status !== 'pending') return null;

    const [claimed] = await tx
      .update(patientRefundIntents)
      .set({ status: 'submitting', attemptedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(eq(patientRefundIntents.id, intent.id), eq(patientRefundIntents.status, 'pending')),
      )
      .returning({ id: patientRefundIntents.id });
    return claimed
      ? {
          id: intent.id,
          providerPaymentId: intent.providerPaymentId,
          amount: Number(intent.amount),
        }
      : null;
  });
}

async function storeRefundBaseline(input: {
  clinicId: string;
  intentId: string;
  baseline: number;
}): Promise<void> {
  await withTenant(input.clinicId, (tx) =>
    tx
      .update(patientRefundIntents)
      .set({ baselineRefundedAmount: input.baseline.toFixed(2), updatedAt: sql`now()` })
      .where(
        and(
          eq(patientRefundIntents.id, input.intentId),
          eq(patientRefundIntents.status, 'submitting'),
        ),
      ),
  );
}

async function returnToPendingBeforePost(clinicId: string, intentId: string): Promise<void> {
  await withTenant(clinicId, (tx) =>
    tx
      .update(patientRefundIntents)
      .set({ status: 'pending', attemptedAt: null, updatedAt: sql`now()` })
      .where(
        and(
          eq(patientRefundIntents.id, intentId),
          eq(patientRefundIntents.status, 'submitting'),
          sql`${patientRefundIntents.baselineRefundedAmount} is null`,
        ),
      ),
  );
}

async function markConfirmationPending(input: {
  clinicId: string;
  intentId: string;
  providerRefundId?: string | null;
  failureCode?: string | null;
}): Promise<void> {
  await withTenant(input.clinicId, (tx) =>
    tx
      .update(patientRefundIntents)
      .set({
        status: 'confirmation_pending',
        providerRefundId: input.providerRefundId ?? undefined,
        failureCode: input.failureCode ?? null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(patientRefundIntents.id, input.intentId),
          inArray(patientRefundIntents.status, ['submitting', 'confirmation_pending']),
        ),
      ),
  );
}

async function markRefundFailed(input: {
  clinicId: string;
  intentId: string;
  failureCode: string;
}): Promise<void> {
  await withTenant(input.clinicId, (tx) =>
    tx
      .update(patientRefundIntents)
      .set({ status: 'failed', failureCode: input.failureCode, updatedAt: sql`now()` })
      .where(
        and(
          eq(patientRefundIntents.id, input.intentId),
          inArray(patientRefundIntents.status, ['submitting', 'confirmation_pending']),
        ),
      ),
  );
  metrics.emit('payments.excess_refund.failed', {
    clinicId: input.clinicId,
    intentId: input.intentId,
    failureCode: input.failureCode,
  });
}

export async function confirmRefundIntentFromReadback(input: {
  clinicId: string;
  intentId: string;
  refunds: readonly ProviderRefund[];
  confirmedAt?: Date;
}): Promise<boolean> {
  return withTenant(input.clinicId, async (tx) => {
    const [intent] = await tx
      .select({
        id: patientRefundIntents.id,
        patientChargeId: patientRefundIntents.patientChargeId,
        amount: patientRefundIntents.amount,
        baselineRefundedAmount: patientRefundIntents.baselineRefundedAmount,
        providerRefundId: patientRefundIntents.providerRefundId,
        status: patientRefundIntents.status,
      })
      .from(patientRefundIntents)
      .where(eq(patientRefundIntents.id, input.intentId))
      .for('update')
      .limit(1);
    if (!intent || intent.status === 'failed') return false;
    if (intent.status === 'confirmed') return true;
    const baseline = Number(intent.baselineRefundedAmount ?? 0);
    const amount = Number(intent.amount);
    const idConfirmed =
      intent.providerRefundId !== null &&
      input.refunds.some(
        (refund) =>
          refund.refundId === intent.providerRefundId &&
          CONFIRMED_REFUND_STATUSES.has(refund.status),
      );
    const idRejected =
      intent.providerRefundId !== null &&
      input.refunds.some(
        (refund) =>
          refund.refundId === intent.providerRefundId &&
          REJECTED_REFUND_STATUSES.has(refund.status),
      );
    if (idRejected) {
      await tx
        .update(patientRefundIntents)
        .set({ status: 'failed', failureCode: 'refund_denied', updatedAt: sql`now()` })
        .where(
          and(
            eq(patientRefundIntents.id, intent.id),
            inArray(patientRefundIntents.status, ['submitting', 'confirmation_pending']),
          ),
        );
      metrics.emit('payments.excess_refund.failed', {
        clinicId: input.clinicId,
        intentId: intent.id,
        failureCode: 'refund_denied',
      });
      return false;
    }
    const totalConfirmed = confirmedRefundTotal(input.refunds);
    if (!idConfirmed && totalConfirmed + 1e-9 < baseline + amount) return false;

    const confirmedAt = input.confirmedAt ?? new Date();
    const [updated] = await tx
      .update(patientRefundIntents)
      .set({ status: 'confirmed', confirmedAt, failureCode: null, updatedAt: sql`now()` })
      .where(
        and(
          eq(patientRefundIntents.id, intent.id),
          inArray(patientRefundIntents.status, ['submitting', 'confirmation_pending']),
        ),
      )
      .returning({ id: patientRefundIntents.id });
    if (!updated) return false;

    const [charge] = await tx
      .select({ appointmentId: patientCharges.appointmentId })
      .from(patientCharges)
      .where(eq(patientCharges.id, intent.patientChargeId))
      .limit(1);
    if (!charge) throw new Error(`[payments] cobrança do estorno ${intent.id} não existe`);
    const payload: ExcessRefundConfirmedPayload = {
      clinicId: input.clinicId,
      appointmentId: charge.appointmentId,
      chargeId: intent.patientChargeId,
      refundIntentId: intent.id,
      amount,
      confirmedAt: confirmedAt.toISOString(),
    };
    await publishEvent(tx, {
      clinicId: input.clinicId,
      eventType: PAYMENTS_EVENTS.EXCESS_REFUND_CONFIRMED,
      payload,
      idempotencyKey: `excess-refund-confirmed:${intent.id}`,
    });
    return true;
  });
}

/** Confirma por webhook usando apenas o read-back autoritativo do provider. */
export async function reconcileRefundIntentsForPayment(input: {
  clinicId: string;
  providerPaymentId: string;
  loadRefunds: () => Promise<readonly ProviderRefund[]>;
  confirmedAt?: Date;
}): Promise<number> {
  const intentIds = await withTenant(input.clinicId, (tx) =>
    tx
      .select({ id: patientRefundIntents.id })
      .from(patientRefundIntents)
      .where(
        and(
          eq(patientRefundIntents.providerPaymentId, input.providerPaymentId),
          inArray(patientRefundIntents.status, ['submitting', 'confirmation_pending']),
          isNotNull(patientRefundIntents.baselineRefundedAmount),
        ),
      ),
  );
  if (intentIds.length === 0) return 0;
  const refunds = await input.loadRefunds();
  let confirmed = 0;
  for (const intent of intentIds) {
    if (
      await confirmRefundIntentFromReadback({
        clinicId: input.clinicId,
        intentId: intent.id,
        refunds,
        ...(input.confirmedAt ? { confirmedAt: input.confirmedAt } : {}),
      })
    ) {
      confirmed += 1;
    }
  }
  return confirmed;
}

export async function requestExcessRefund(input: {
  clinicId: string;
  payload: ExcessRefundRequestedPayload;
  sourceEventId: string;
}): Promise<'submitted' | 'already_started' | 'failed'> {
  if (input.payload.clinicId !== input.clinicId) {
    throw new Error('[payments] clinicId divergente no pedido de estorno');
  }
  const intent = await claimRefundIntent(input);
  if (!intent) return 'already_started';
  const client = await getClinicAsaasClient(input.clinicId);
  if (!client) {
    await markRefundFailed({
      clinicId: input.clinicId,
      intentId: intent.id,
      failureCode: 'payment_account_unavailable',
    });
    return 'failed';
  }

  let baseline: number;
  try {
    baseline = confirmedRefundTotal(
      await client.listPaymentRefunds(intent.providerPaymentId, { attempts: 1 }),
    );
    await storeRefundBaseline({ clinicId: input.clinicId, intentId: intent.id, baseline });
  } catch (error) {
    // Nenhum POST ocorreu: este único caso pode voltar com segurança para retry.
    await returnToPendingBeforePost(input.clinicId, intent.id);
    throw error;
  }

  let providerRefundId: string | null = null;
  try {
    const refund = await client.refundPayment(intent.providerPaymentId, {
      value: intent.amount,
      description: DESCRIPTION,
    });
    providerRefundId = refund.refundId;
    await markConfirmationPending({
      clinicId: input.clinicId,
      intentId: intent.id,
      providerRefundId,
    });
  } catch (error) {
    if (error instanceof BillingProviderError) {
      await markRefundFailed({
        clinicId: input.clinicId,
        intentId: intent.id,
        failureCode: error.providerErrorCodes[0] ?? `http_${error.httpStatus ?? 400}`,
      });
      return 'failed';
    }
    if (error instanceof BillingCircuitOpenError) {
      // O breaker recusou antes do HTTP. O POST comprovadamente não aconteceu.
      await withTenant(input.clinicId, (tx) =>
        tx
          .update(patientRefundIntents)
          .set({
            status: 'pending',
            baselineRefundedAmount: null,
            attemptedAt: null,
            updatedAt: sql`now()`,
          })
          .where(eq(patientRefundIntents.id, intent.id)),
      );
      throw error;
    }
    await markConfirmationPending({
      clinicId: input.clinicId,
      intentId: intent.id,
      failureCode:
        error instanceof BillingProviderUnreachableError ? error.code : 'submission_unknown',
    });
    return 'submitted';
  }

  try {
    const refunds = await client.listPaymentRefunds(intent.providerPaymentId, { attempts: 1 });
    await confirmRefundIntentFromReadback({
      clinicId: input.clinicId,
      intentId: intent.id,
      refunds,
    });
  } catch (error) {
    metrics.emit('payments.excess_refund.readback_failed', {
      clinicId: input.clinicId,
      intentId: intent.id,
      error,
    });
  }
  return 'submitted';
}

export interface RefundIntentReconcileCandidate {
  id: string;
  providerPaymentId: string;
}

export async function listRefundIntentReconcileCandidates(
  clinicId: string,
  limit = 100,
): Promise<RefundIntentReconcileCandidate[]> {
  return withTenant(clinicId, (tx) =>
    tx
      .select({
        id: patientRefundIntents.id,
        providerPaymentId: patientRefundIntents.providerPaymentId,
      })
      .from(patientRefundIntents)
      .where(
        and(
          inArray(patientRefundIntents.status, ['submitting', 'confirmation_pending']),
          isNotNull(patientRefundIntents.baselineRefundedAmount),
        ),
      )
      .orderBy(patientRefundIntents.updatedAt)
      .limit(limit),
  );
}
