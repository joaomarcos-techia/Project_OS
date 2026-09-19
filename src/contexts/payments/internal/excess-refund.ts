/**
 * Intenções de estorno de cobranças do paciente (D50 + D77).
 *
 * O Asaas não oferece idempotency-key no POST de estorno. Por isso a intenção é
 * persistida antes da chamada, o baseline autoritativo é gravado antes do POST e
 * qualquer resultado indeterminado passa somente por read-back/webhook. Nunca há
 * retry cego de POST.
 */
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
  type AsaasClient,
  type ProviderRefund,
} from '@/lib/payments/asaas';

/* eslint-disable boundaries/element-types -- contrato público do produtor Financial. */
import type { ExcessRefundRequestedPayload } from '@/contexts/financial';
/* eslint-enable boundaries/element-types */

import { PAYMENTS_EVENTS, type ExcessRefundConfirmedPayload } from '../events';
import { patientCharges, patientRefundIntents } from '../schema';
import { closeChargeInTransaction } from './charge-store';

export type RefundIntentPurpose = 'excess' | 'deposit_closeout';
export type RefundConfirmationOutcome = 'confirmed' | 'failed' | 'pending';
type RefundRequestOutcome = 'submitted' | 'confirmed' | 'already_started' | 'failed';
type RefundClient = Pick<AsaasClient, 'listPaymentRefunds' | 'refundPayment'>;

const CONFIRMED_REFUND_STATUSES = new Set(['DONE']);
const REJECTED_REFUND_STATUSES = new Set(['CANCELLED', 'DENIED', 'REFUND_DENIED', 'FAILED']);
const EXCESS_DESCRIPTION = 'Estorno de valor pago acima do saldo do atendimento';
const DEPOSIT_DESCRIPTION = 'Estorno do sinal do atendimento cancelado';

export function confirmedRefundTotal(refunds: readonly ProviderRefund[]): number {
  return Number(
    refunds
      .filter((refund) => CONFIRMED_REFUND_STATUSES.has(refund.status))
      .reduce((total, refund) => total + refund.value, 0)
      .toFixed(2),
  );
}

export function rejectedRefundCount(refunds: readonly ProviderRefund[]): number {
  return refunds.filter((refund) => REJECTED_REFUND_STATUSES.has(refund.status)).length;
}

interface RefundBaseline {
  confirmedAmount: number;
  refundCount: number;
  rejectedCount: number;
}

function refundBaseline(refunds: readonly ProviderRefund[]): RefundBaseline {
  return {
    confirmedAmount: confirmedRefundTotal(refunds),
    refundCount: refunds.length,
    rejectedCount: rejectedRefundCount(refunds),
  };
}

interface RefundIntentCandidate {
  id: string;
  providerPaymentId: string;
  amount: number;
  purpose: RefundIntentPurpose;
  status: 'pending' | 'submitting' | 'confirmation_pending' | 'confirmed' | 'failed';
}

function asPurpose(value: string): RefundIntentPurpose {
  if (value === 'excess' || value === 'deposit_closeout') return value;
  throw new Error(`[payments] propósito de estorno inválido: ${value}`);
}

/**
 * Persiste e lê a identidade da intenção, mas ainda não a reivindica. Assim uma
 * falha no GET do baseline deixa status=pending e o worker pode tentar novamente
 * sem risco: nenhum POST aconteceu.
 */
async function ensureRefundIntent(input: {
  clinicId: string;
  chargeId: string;
  purpose: RefundIntentPurpose;
  amount: number;
  sourceEventId: string;
}): Promise<RefundIntentCandidate> {
  return withTenant(input.clinicId, async (tx) => {
    const [charge] = await tx
      .select({
        id: patientCharges.id,
        kind: patientCharges.kind,
        providerPaymentId: patientCharges.providerPaymentId,
      })
      .from(patientCharges)
      .where(
        and(
          eq(patientCharges.id, input.chargeId),
          eq(patientCharges.clinicId, input.clinicId),
          eq(patientCharges.status, 'paid'),
        ),
      )
      .limit(1);
    if (!charge?.providerPaymentId) {
      throw new Error(`[payments] cobrança paga sem payment id: ${input.chargeId}`);
    }
    if (input.purpose === 'deposit_closeout' && charge.kind !== 'deposit') {
      throw new Error(`[payments] estorno de sinal recebeu cobrança ${charge.kind}`);
    }

    await tx
      .insert(patientRefundIntents)
      .values({
        clinicId: input.clinicId,
        patientChargeId: charge.id,
        purpose: input.purpose,
        amount: input.amount.toFixed(2),
        status: 'pending',
        providerPaymentId: charge.providerPaymentId,
        sourceEventId: input.sourceEventId,
      })
      .onConflictDoNothing();

    const [intent] = await tx
      .select({
        id: patientRefundIntents.id,
        amount: patientRefundIntents.amount,
        purpose: patientRefundIntents.purpose,
        providerPaymentId: patientRefundIntents.providerPaymentId,
        status: patientRefundIntents.status,
      })
      .from(patientRefundIntents)
      .where(
        and(
          eq(patientRefundIntents.clinicId, input.clinicId),
          eq(patientRefundIntents.patientChargeId, charge.id),
          eq(patientRefundIntents.purpose, input.purpose),
        ),
      )
      .limit(1);
    if (!intent) throw new Error('[payments] intenção de estorno não foi persistida');
    if (Number(intent.amount) !== input.amount) {
      throw new Error(`[payments] valor divergente na intenção de estorno ${intent.id}`);
    }
    if (intent.providerPaymentId !== charge.providerPaymentId) {
      throw new Error(`[payments] payment id divergente na intenção de estorno ${intent.id}`);
    }

    return {
      id: intent.id,
      providerPaymentId: intent.providerPaymentId,
      amount: Number(intent.amount),
      purpose: asPurpose(intent.purpose),
      status: intent.status,
    };
  });
}

/**
 * Somente um worker vence esta transição. O baseline e o estado submitting são
 * gravados juntos; portanto todo estado que pode ter alcançado o POST também é
 * elegível ao reconciliador.
 */
async function claimRefundIntentWithBaseline(input: {
  clinicId: string;
  intentId: string;
  baseline: RefundBaseline;
}): Promise<boolean> {
  return withTenant(input.clinicId, async (tx) => {
    const [claimed] = await tx
      .update(patientRefundIntents)
      .set({
        status: 'submitting',
        baselineRefundedAmount: input.baseline.confirmedAmount.toFixed(2),
        baselineRefundCount: input.baseline.refundCount,
        baselineRejectedRefundCount: input.baseline.rejectedCount,
        attemptedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(patientRefundIntents.id, input.intentId),
          eq(patientRefundIntents.status, 'pending'),
        ),
      )
      .returning({ id: patientRefundIntents.id });
    return Boolean(claimed);
  });
}

async function returnToPendingBeforePost(clinicId: string, intentId: string): Promise<void> {
  await withTenant(clinicId, (tx) =>
    tx
      .update(patientRefundIntents)
      .set({
        status: 'pending',
        baselineRefundedAmount: null,
        baselineRefundCount: null,
        baselineRejectedRefundCount: null,
        attemptedAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(eq(patientRefundIntents.id, intentId), eq(patientRefundIntents.status, 'submitting')),
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

function failureMetric(purpose: RefundIntentPurpose): string {
  return purpose === 'excess' ? 'payments.excess_refund.failed' : 'payments.deposit.refund_failed';
}

async function markRefundFailed(input: {
  clinicId: string;
  intentId: string;
  purpose: RefundIntentPurpose;
  failureCode: string;
}): Promise<void> {
  const changed = await withTenant(input.clinicId, async (tx) => {
    const [updated] = await tx
      .update(patientRefundIntents)
      .set({ status: 'failed', failureCode: input.failureCode, updatedAt: sql`now()` })
      .where(
        and(
          eq(patientRefundIntents.id, input.intentId),
          inArray(patientRefundIntents.status, ['pending', 'submitting', 'confirmation_pending']),
        ),
      )
      .returning({ id: patientRefundIntents.id });
    return Boolean(updated);
  });
  if (changed) {
    metrics.emit(failureMetric(input.purpose), {
      clinicId: input.clinicId,
      intentId: input.intentId,
      failureCode: input.failureCode,
    });
  }
}

function rejectedFailureCode(refund: ProviderRefund | undefined): string {
  return refund?.status === 'CANCELLED' ? 'refund_cancelled' : 'refund_denied';
}

/**
 * Confirma exclusivamente por estado autoritativo do provider.
 *
 * - refund DONE: dinheiro devolvido;
 * - payment REFUNDED: cobrança integralmente devolvida;
 * - refund CANCELLED/negado: falha terminal;
 * - qualquer outro estado: continua pendente.
 */
export async function confirmRefundIntentFromReadback(input: {
  clinicId: string;
  intentId: string;
  refunds: readonly ProviderRefund[];
  providerPaymentStatus?: string | null;
  confirmedAt?: Date;
}): Promise<RefundConfirmationOutcome> {
  return withTenant(input.clinicId, async (tx) => {
    const [intent] = await tx
      .select({
        id: patientRefundIntents.id,
        patientChargeId: patientRefundIntents.patientChargeId,
        amount: patientRefundIntents.amount,
        purpose: patientRefundIntents.purpose,
        baselineRefundedAmount: patientRefundIntents.baselineRefundedAmount,
        baselineRefundCount: patientRefundIntents.baselineRefundCount,
        baselineRejectedRefundCount: patientRefundIntents.baselineRejectedRefundCount,
        providerRefundId: patientRefundIntents.providerRefundId,
        status: patientRefundIntents.status,
      })
      .from(patientRefundIntents)
      .where(eq(patientRefundIntents.id, input.intentId))
      .for('update')
      .limit(1);
    if (!intent) return 'pending';
    if (intent.status === 'failed') return 'failed';
    if (intent.status === 'confirmed') return 'confirmed';
    if (intent.baselineRefundedAmount === null) return 'pending';

    const purpose = asPurpose(intent.purpose);
    const baselineAmount = Number(intent.baselineRefundedAmount);
    const amount = Number(intent.amount);
    const exactRefund =
      intent.providerRefundId === null
        ? undefined
        : input.refunds.find((refund) => refund.refundId === intent.providerRefundId);
    const totalConfirmed = confirmedRefundTotal(input.refunds);
    const confirmed =
      input.providerPaymentStatus === 'REFUNDED' ||
      (exactRefund !== undefined && CONFIRMED_REFUND_STATUSES.has(exactRefund.status)) ||
      totalConfirmed + 1e-9 >= baselineAmount + amount;

    if (!confirmed) {
      const rejectedWithoutExactId =
        exactRefund === undefined &&
        intent.baselineRefundCount !== null &&
        intent.baselineRejectedRefundCount !== null &&
        input.refunds.length > intent.baselineRefundCount &&
        rejectedRefundCount(input.refunds) > intent.baselineRejectedRefundCount;
      const rejected =
        (exactRefund !== undefined && REJECTED_REFUND_STATUSES.has(exactRefund.status)) ||
        rejectedWithoutExactId;
      if (!rejected) return 'pending';

      const rejectedRefund =
        exactRefund ?? input.refunds.find((refund) => REJECTED_REFUND_STATUSES.has(refund.status));
      const failureCode = rejectedFailureCode(rejectedRefund);
      const [updated] = await tx
        .update(patientRefundIntents)
        .set({ status: 'failed', failureCode, updatedAt: sql`now()` })
        .where(
          and(
            eq(patientRefundIntents.id, intent.id),
            inArray(patientRefundIntents.status, ['submitting', 'confirmation_pending']),
          ),
        )
        .returning({ id: patientRefundIntents.id });
      if (updated) {
        metrics.emit(failureMetric(purpose), {
          clinicId: input.clinicId,
          intentId: intent.id,
          failureCode,
        });
      }
      return 'failed';
    }

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
    if (!updated) return 'pending';

    const [charge] = await tx
      .select({
        appointmentId: patientCharges.appointmentId,
        kind: patientCharges.kind,
        amount: patientCharges.amount,
      })
      .from(patientCharges)
      .where(eq(patientCharges.id, intent.patientChargeId))
      .limit(1);
    if (!charge) throw new Error(`[payments] cobrança do estorno ${intent.id} não existe`);

    if (purpose === 'deposit_closeout') {
      if (charge.kind !== 'deposit' || Number(charge.amount) !== amount) {
        throw new Error(`[payments] intenção de estorno de sinal inválida: ${intent.id}`);
      }
      const closed = await closeChargeInTransaction(tx, {
        clinicId: input.clinicId,
        chargeId: intent.patientChargeId,
        from: 'paid',
        outcome: 'refunded',
        kind: charge.kind,
        appointmentId: charge.appointmentId,
        amount,
        closedAt: confirmedAt,
      });
      if (closed) {
        metrics.emit('payments.deposit.refunded', {
          clinicId: input.clinicId,
          appointmentId: charge.appointmentId,
          chargeId: intent.patientChargeId,
          amount,
        });
      }
      return 'confirmed';
    }

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
    return 'confirmed';
  });
}

/** O webhook apenas acorda o read-back; o corpo nunca confirma o estorno. */
export async function reconcileRefundIntentsForPayment(input: {
  clinicId: string;
  providerPaymentId: string;
  loadRefunds: () => Promise<readonly ProviderRefund[]>;
  providerPaymentStatus?: string | null;
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
    const outcome = await confirmRefundIntentFromReadback({
      clinicId: input.clinicId,
      intentId: intent.id,
      refunds,
      ...(input.providerPaymentStatus !== undefined
        ? { providerPaymentStatus: input.providerPaymentStatus }
        : {}),
      ...(input.confirmedAt ? { confirmedAt: input.confirmedAt } : {}),
    });
    if (outcome === 'confirmed') confirmed += 1;
  }
  return confirmed;
}

async function requestRefund(input: {
  clinicId: string;
  chargeId: string;
  amount: number;
  purpose: RefundIntentPurpose;
  sourceEventId: string;
  description: string;
  client?: RefundClient | null;
}): Promise<RefundRequestOutcome> {
  const intent = await ensureRefundIntent(input);
  if (intent.status === 'confirmed') return 'confirmed';
  if (intent.status === 'failed') return 'failed';
  if (intent.status !== 'pending') return 'already_started';

  const client =
    input.client === undefined ? await getClinicAsaasClient(input.clinicId) : input.client;
  if (!client) {
    await markRefundFailed({
      clinicId: input.clinicId,
      intentId: intent.id,
      purpose: intent.purpose,
      failureCode: 'payment_account_unavailable',
    });
    return 'failed';
  }

  let baseline: RefundBaseline;
  try {
    baseline = refundBaseline(
      await client.listPaymentRefunds(intent.providerPaymentId, { attempts: 1 }),
    );
  } catch (error) {
    // A intenção segue pending: nenhum POST ocorreu e o retry continua seguro.
    throw error;
  }

  const claimed = await claimRefundIntentWithBaseline({
    clinicId: input.clinicId,
    intentId: intent.id,
    baseline,
  });
  if (!claimed) return 'already_started';

  try {
    const refund = await client.refundPayment(intent.providerPaymentId, {
      value: intent.amount,
      description: input.description,
    });
    await markConfirmationPending({
      clinicId: input.clinicId,
      intentId: intent.id,
      providerRefundId: refund.refundId,
    });
  } catch (error) {
    if (error instanceof BillingProviderError) {
      await markRefundFailed({
        clinicId: input.clinicId,
        intentId: intent.id,
        purpose: intent.purpose,
        failureCode: error.providerErrorCodes[0] ?? `http_${error.httpStatus ?? 400}`,
      });
      return 'failed';
    }
    if (error instanceof BillingCircuitOpenError) {
      // O breaker recusou antes do HTTP; este é o único caso pós-claim em que
      // voltar a pending e permitir uma nova tentativa é comprovadamente seguro.
      await returnToPendingBeforePost(input.clinicId, intent.id);
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
    const outcome = await confirmRefundIntentFromReadback({
      clinicId: input.clinicId,
      intentId: intent.id,
      refunds,
    });
    if (outcome === 'confirmed' || outcome === 'failed') return outcome;
  } catch (error) {
    metrics.emit(
      intent.purpose === 'excess'
        ? 'payments.excess_refund.readback_failed'
        : 'payments.deposit.refund_readback_failed',
      {
        clinicId: input.clinicId,
        intentId: intent.id,
        error,
      },
    );
  }
  return 'submitted';
}

export async function requestExcessRefund(input: {
  clinicId: string;
  payload: ExcessRefundRequestedPayload;
  sourceEventId: string;
}): Promise<'submitted' | 'already_started' | 'failed'> {
  if (input.payload.clinicId !== input.clinicId) {
    throw new Error('[payments] clinicId divergente no pedido de estorno');
  }
  const outcome = await requestRefund({
    clinicId: input.clinicId,
    chargeId: input.payload.chargeId,
    amount: input.payload.amount,
    purpose: 'excess',
    sourceEventId: input.sourceEventId,
    description: EXCESS_DESCRIPTION,
  });
  return outcome === 'confirmed' ? 'submitted' : outcome;
}

/** Inicia o estorno integral do sinal sem projetar devolução antes de DONE. */
export async function requestDepositRefund(input: {
  clinicId: string;
  chargeId: string;
  amount: number;
  sourceEventId: string;
  client: RefundClient;
}): Promise<RefundRequestOutcome> {
  return requestRefund({
    ...input,
    purpose: 'deposit_closeout',
    description: DEPOSIT_DESCRIPTION,
  });
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
