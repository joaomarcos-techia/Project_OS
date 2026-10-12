/**
 * Intenções de estorno de cobranças do paciente (D50 + D77).
 *
 * A intenção é persistida antes da ação manual da clínica e acompanhada por
 * read-back/webhook. Intenções legadas de POST automático continuam reconciliáveis,
 * mas este módulo não solicita novos estornos ao Asaas.
 */
import 'server-only';

import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';
import { metrics } from '@/lib/observability/metrics';
import { publishEvent } from '@/lib/outbox/publish';
import { getClinicAsaasClient } from '@/lib/payments/account-store';
import { type AsaasClient, type ProviderRefund } from '@/lib/payments/asaas';

/* eslint-disable boundaries/element-types -- contrato público do produtor Financial. */
import type { ExcessRefundRequestedPayload } from '@/contexts/financial';
/* eslint-enable boundaries/element-types */

import { PAYMENTS_EVENTS, type ExcessRefundConfirmedPayload } from '../events';
import { patientCharges, patientRefundIntents } from '../schema';
import { closeChargeInTransaction } from './charge-store';

export type RefundIntentPurpose = 'excess' | 'deposit_closeout';
export type RefundConfirmationOutcome = 'confirmed' | 'failed' | 'pending';
type RefundClient = Pick<AsaasClient, 'listPaymentRefunds'>;

const CONFIRMED_REFUND_STATUSES = new Set(['DONE']);
const REJECTED_REFUND_STATUSES = new Set(['CANCELLED', 'DENIED', 'REFUND_DENIED', 'FAILED']);
const MANUAL_REFUND_REQUIRED = 'manual_action_required';
const PROVIDER_READBACK_UNAVAILABLE = 'provider_readback_unavailable';
const LEGACY_REJECTED_REFUND_CODES = ['refund_cancelled', 'refund_denied'] as const;

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
 * Registra a obrigação de devolução sem solicitar movimentação financeira.
 * O baseline anterior à ação da clínica permite observar o resultado posterior
 * pelo webhook/cron, inclusive quando o Asaas não informa id do item de estorno.
 */
async function queueManualRefund(input: {
  clinicId: string;
  chargeId: string;
  amount: number;
  purpose: RefundIntentPurpose;
  sourceEventId: string;
  client?: RefundClient | null;
}): Promise<'queued' | 'already_started' | 'confirmed' | 'failed'> {
  const intent = await ensureRefundIntent(input);
  if (intent.status === 'confirmed' || intent.status === 'failed') return intent.status;
  if (intent.status !== 'pending') return 'already_started';

  const client =
    input.client === undefined ? await getClinicAsaasClient(input.clinicId) : input.client;
  if (!client) {
    await withTenant(input.clinicId, (tx) =>
      tx
        .update(patientRefundIntents)
        .set({ failureCode: 'payment_account_unavailable', updatedAt: sql`now()` })
        .where(
          and(eq(patientRefundIntents.id, intent.id), eq(patientRefundIntents.status, 'pending')),
        ),
    );
    return 'queued';
  }

  let baseline: RefundBaseline;
  try {
    baseline = refundBaseline(
      await client.listPaymentRefunds(intent.providerPaymentId, { attempts: 1 }),
    );
  } catch (error) {
    // Sem baseline não há como correlacionar com segurança uma devolução futura.
    // Mantém a tarefa visível e elegível ao cron, além do retry do outbox.
    await withTenant(input.clinicId, (tx) =>
      tx
        .update(patientRefundIntents)
        .set({ failureCode: PROVIDER_READBACK_UNAVAILABLE, updatedAt: sql`now()` })
        .where(
          and(eq(patientRefundIntents.id, intent.id), eq(patientRefundIntents.status, 'pending')),
        ),
    );
    throw error;
  }
  const changed = await withTenant(input.clinicId, async (tx) => {
    const [queued] = await tx
      .update(patientRefundIntents)
      .set({
        status: 'confirmation_pending',
        baselineRefundedAmount: baseline.confirmedAmount.toFixed(2),
        baselineRefundCount: baseline.refundCount,
        baselineRejectedRefundCount: baseline.rejectedCount,
        failureCode: MANUAL_REFUND_REQUIRED,
        updatedAt: sql`now()`,
      })
      .where(
        and(eq(patientRefundIntents.id, intent.id), eq(patientRefundIntents.status, 'pending')),
      )
      .returning({ id: patientRefundIntents.id });
    return Boolean(queued);
  });
  if (changed) {
    metrics.emit('payments.refund.manual_action_required', {
      clinicId: input.clinicId,
      intentId: intent.id,
      purpose: input.purpose,
    });
  }
  return changed ? 'queued' : 'already_started';
}

export async function queueManualExcessRefund(input: {
  clinicId: string;
  payload: ExcessRefundRequestedPayload;
  sourceEventId: string;
}): Promise<'queued' | 'already_started' | 'confirmed' | 'failed'> {
  if (input.payload.clinicId !== input.clinicId) {
    throw new Error('[payments] clinicId divergente no pedido de estorno');
  }
  return queueManualRefund({
    clinicId: input.clinicId,
    chargeId: input.payload.chargeId,
    amount: input.payload.amount,
    purpose: 'excess',
    sourceEventId: input.sourceEventId,
  });
}

export async function queueManualDepositRefund(input: {
  clinicId: string;
  chargeId: string;
  amount: number;
  sourceEventId: string;
  client: RefundClient | null;
}): Promise<'queued' | 'already_started' | 'confirmed' | 'failed'> {
  return queueManualRefund({ ...input, purpose: 'deposit_closeout' });
}

function failureMetric(purpose: RefundIntentPurpose): string {
  return purpose === 'excess' ? 'payments.excess_refund.failed' : 'payments.deposit.refund_failed';
}

function rejectedFailureCode(refund: ProviderRefund | undefined, manual: boolean): string {
  const code = refund?.status === 'CANCELLED' ? 'refund_cancelled' : 'refund_denied';
  return manual ? `manual_${code}` : code;
}

/**
 * Confirma exclusivamente por estado autoritativo do provider.
 *
 * - refund DONE com valor suficiente: dinheiro devolvido;
 * - refund CANCELLED/negado: falha terminal;
 * - qualquer outro estado: continua pendente.
 */
export async function confirmRefundIntentFromReadback(input: {
  clinicId: string;
  intentId: string;
  refunds: readonly ProviderRefund[];
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
        failureCode: patientRefundIntents.failureCode,
      })
      .from(patientRefundIntents)
      .where(eq(patientRefundIntents.id, input.intentId))
      .for('update')
      .limit(1);
    if (!intent) return 'pending';
    const manualFailed =
      intent.status === 'failed' &&
      (intent.failureCode === 'manual_refund_cancelled' ||
        intent.failureCode === 'manual_refund_denied');
    const legacyDepositFailed =
      intent.status === 'failed' &&
      intent.purpose === 'deposit_closeout' &&
      LEGACY_REJECTED_REFUND_CODES.some((code) => code === intent.failureCode);
    if (intent.status === 'failed' && !manualFailed && !legacyDepositFailed) return 'failed';
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
    const requiredConfirmed = purpose === 'deposit_closeout' ? amount : baselineAmount + amount;
    const confirmed =
      legacyDepositFailed && totalConfirmed + 1e-9 >= amount
        ? true
        : exactRefund !== undefined
          ? CONFIRMED_REFUND_STATUSES.has(exactRefund.status) && exactRefund.value + 1e-9 >= amount
          : totalConfirmed + 1e-9 >= requiredConfirmed;

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
      if (!rejected) return legacyDepositFailed ? 'failed' : 'pending';

      const rejectedRefund =
        exactRefund ?? input.refunds.find((refund) => REJECTED_REFUND_STATUSES.has(refund.status));
      const failureCode = rejectedFailureCode(
        rejectedRefund,
        intent.failureCode === MANUAL_REFUND_REQUIRED || manualFailed,
      );
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
          inArray(patientRefundIntents.status, ['submitting', 'confirmation_pending', 'failed']),
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
  confirmedAt?: Date;
}): Promise<number> {
  const intentIds = await withTenant(input.clinicId, (tx) =>
    tx
      .select({ id: patientRefundIntents.id })
      .from(patientRefundIntents)
      .where(
        and(
          eq(patientRefundIntents.providerPaymentId, input.providerPaymentId),
          or(
            inArray(patientRefundIntents.status, ['submitting', 'confirmation_pending']),
            and(
              eq(patientRefundIntents.status, 'failed'),
              inArray(patientRefundIntents.failureCode, [
                'manual_refund_cancelled',
                'manual_refund_denied',
              ]),
            ),
            and(
              eq(patientRefundIntents.status, 'failed'),
              eq(patientRefundIntents.purpose, 'deposit_closeout'),
              inArray(patientRefundIntents.failureCode, LEGACY_REJECTED_REFUND_CODES),
            ),
          ),
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
      ...(input.confirmedAt ? { confirmedAt: input.confirmedAt } : {}),
    });
    if (outcome === 'confirmed') confirmed += 1;
  }
  return confirmed;
}

export interface RefundIntentReconcileCandidate {
  id: string;
  providerPaymentId: string;
  manualPreparation: {
    chargeId: string;
    amount: number;
    purpose: RefundIntentPurpose;
    sourceEventId: string;
  } | null;
}

/** Retoma a leitura-base depois que a clínica reconecta sua conta Asaas. */
export async function prepareDisconnectedManualRefund(input: {
  clinicId: string;
  manualPreparation: NonNullable<RefundIntentReconcileCandidate['manualPreparation']>;
  client: RefundClient;
}): Promise<void> {
  await queueManualRefund({
    clinicId: input.clinicId,
    chargeId: input.manualPreparation.chargeId,
    amount: input.manualPreparation.amount,
    purpose: input.manualPreparation.purpose,
    sourceEventId: input.manualPreparation.sourceEventId,
    client: input.client,
  });
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
        patientChargeId: patientRefundIntents.patientChargeId,
        amount: patientRefundIntents.amount,
        purpose: patientRefundIntents.purpose,
        sourceEventId: patientRefundIntents.sourceEventId,
        status: patientRefundIntents.status,
      })
      .from(patientRefundIntents)
      .where(
        and(
          or(
            inArray(patientRefundIntents.status, ['submitting', 'confirmation_pending']),
            and(
              eq(patientRefundIntents.status, 'failed'),
              inArray(patientRefundIntents.failureCode, [
                'manual_refund_cancelled',
                'manual_refund_denied',
              ]),
            ),
            and(
              eq(patientRefundIntents.status, 'failed'),
              eq(patientRefundIntents.purpose, 'deposit_closeout'),
              inArray(patientRefundIntents.failureCode, LEGACY_REJECTED_REFUND_CODES),
            ),
            and(
              eq(patientRefundIntents.status, 'pending'),
              inArray(patientRefundIntents.failureCode, [
                'payment_account_unavailable',
                PROVIDER_READBACK_UNAVAILABLE,
              ]),
            ),
          ),
          or(
            isNotNull(patientRefundIntents.baselineRefundedAmount),
            inArray(patientRefundIntents.failureCode, [
              'payment_account_unavailable',
              PROVIDER_READBACK_UNAVAILABLE,
            ]),
          ),
        ),
      )
      .orderBy(patientRefundIntents.updatedAt)
      .limit(limit)
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          providerPaymentId: row.providerPaymentId,
          manualPreparation:
            row.status === 'pending'
              ? {
                  chargeId: row.patientChargeId,
                  amount: Number(row.amount),
                  purpose: asPurpose(row.purpose),
                  sourceEventId: row.sourceEventId,
                }
              : null,
        })),
      ),
  );
}
