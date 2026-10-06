import { sql } from 'drizzle-orm';

import {
  markDepositPaid,
  reconcilePaidChargeEconomics,
} from '@/contexts/payments/internal/charge-store';
import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';
import { getClinicAsaasClient } from '@/lib/payments/account-store';

const SETTLED_PAYMENT_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);
export const PAYMENT_RECONCILE_READ_TIMEOUT_MS = 4_000;

export interface PendingPaymentEconomics {
  chargeId: string;
  clinicId: string;
  providerPaymentId: string;
  /** Início do readback registrado pelo relógio do banco, quando disponível. */
  observedAt?: Date;
}

export interface QuarantinedPatientPayment extends PendingPaymentEconomics {
  failureCode: string;
}

export async function scanQuarantinedPatientPayments(
  tx: Tx,
  limit: number,
): Promise<QuarantinedPatientPayment[]> {
  const rows = await tx.execute<{
    chargeId: string;
    clinicId: string;
    providerPaymentId: string;
    failureCode: string;
  }>(sql`
    WITH candidates AS (
      SELECT id
      FROM patient_charges
      WHERE status = 'pending'
        AND provider_payment_id IS NOT NULL
        AND failure_code IN (
          'payment_method_mismatch',
          'payment_installment_mismatch',
          'payment_amount_mismatch'
        )
      ORDER BY provider_reconcile_checked_at ASC NULLS FIRST, updated_at ASC, id ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE patient_charges charge
       SET provider_reconcile_checked_at = now()
      FROM candidates
     WHERE charge.id = candidates.id
    RETURNING charge.id::text AS "chargeId",
              charge.clinic_id::text AS "clinicId",
              charge.provider_payment_id AS "providerPaymentId",
              charge.failure_code AS "failureCode"
  `);
  return rows as unknown as QuarantinedPatientPayment[];
}

/** Releitura independente do webhook: corrige um readback transitório sem aceitar outro preço. */
export async function reconcileQuarantinedPatientPayments(
  candidates: readonly QuarantinedPatientPayment[],
  now: Date,
): Promise<{ recovered: number; mismatched: number; skipped: number; failed: number }> {
  const result = { recovered: 0, mismatched: 0, skipped: 0, failed: 0 };
  for (const candidate of candidates) {
    try {
      const client = await getClinicAsaasClient(candidate.clinicId);
      if (!client) {
        result.skipped++;
        continue;
      }
      const payment = await client.getPayment(candidate.providerPaymentId, {
        attempts: 1,
        timeoutMs: PAYMENT_RECONCILE_READ_TIMEOUT_MS,
      });
      if (payment.deleted || !SETTLED_PAYMENT_STATUSES.has(payment.status)) {
        result.skipped++;
        continue;
      }
      const outcome = await markDepositPaid({
        clinicId: candidate.clinicId,
        providerPaymentId: candidate.providerPaymentId,
        asaasEventId: `recovery:${candidate.chargeId}:${candidate.providerPaymentId}`,
        eventType: 'PAYMENT_RECONCILE',
        paidAt: now,
        providerGrossAmount: payment.value,
        providerNetAmount: payment.netValue ?? null,
        billingType: payment.billingType,
        checkoutSessionId: payment.checkoutSessionId,
        providerInstallmentId: payment.installmentId ?? null,
        providerInstallmentNumber: payment.installmentNumber ?? null,
      });
      if (outcome === 'paid' || outcome === 'economics_reconciled') result.recovered++;
      else if (outcome.endsWith('_mismatch')) result.mismatched++;
      else result.skipped++;
    } catch (error) {
      result.failed++;
      metrics.emit('financial.reconcile.payment_anomaly_error', {
        clinicId: candidate.clinicId,
        error,
      });
    }
  }
  return result;
}

export interface PaymentEconomicsReconcileSummary {
  candidates: number;
  reconciled: number;
  corrected: number;
  pending: number;
  skipped: number;
  mismatched: number;
  failed: number;
}

/** Somente fatos pagos e ainda sem `netValue` conciliado. */
export async function scanPendingPaymentEconomics(
  tx: Tx,
  limit: number,
  clinicId?: string,
): Promise<PendingPaymentEconomics[]> {
  const rows = await tx.execute<{
    chargeId: string;
    clinicId: string;
    providerPaymentId: string;
  }>(sql`
    WITH candidates AS (
      SELECT id
      FROM patient_charges
      WHERE status = 'paid'
        AND provider_payment_id IS NOT NULL
        AND economics_reconciled_at IS NULL
        ${clinicId ? sql`AND clinic_id = ${clinicId}` : sql``}
      ORDER BY provider_reconcile_checked_at ASC NULLS FIRST, paid_at ASC NULLS FIRST, id ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE patient_charges charge
       SET provider_reconcile_checked_at = now()
      FROM candidates
     WHERE charge.id = candidates.id
    RETURNING charge.id::text AS "chargeId",
              charge.clinic_id::text AS "clinicId",
              charge.provider_payment_id AS "providerPaymentId"
  `);
  return rows as unknown as PendingPaymentEconomics[];
}

/** Revisita pagamentos já conciliados para detectar tarifa corrigida pelo Asaas. */
export async function scanReconciledPaymentEconomics(
  tx: Tx,
  limit: number,
): Promise<PendingPaymentEconomics[]> {
  const rows = await tx.execute<{
    chargeId: string;
    clinicId: string;
    providerPaymentId: string;
    observedAt: Date;
  }>(sql`
    WITH candidates AS (
      SELECT id
      FROM patient_charges
      WHERE status = 'paid'
        AND provider_payment_id IS NOT NULL
        AND economics_reconciled_at IS NOT NULL
        AND (provider_reconcile_checked_at IS NULL
          OR provider_reconcile_checked_at < now() - interval '1 day')
      ORDER BY provider_reconcile_checked_at ASC NULLS FIRST, paid_at ASC NULLS FIRST, id ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE patient_charges charge
       SET provider_reconcile_checked_at = now()
      FROM candidates
     WHERE charge.id = candidates.id
    RETURNING charge.id::text AS "chargeId",
              charge.clinic_id::text AS "clinicId",
              charge.provider_payment_id AS "providerPaymentId",
              charge.provider_reconcile_checked_at AS "observedAt"
  `);
  return rows as unknown as PendingPaymentEconomics[];
}

/**
 * Relê o pagamento na conta Asaas da própria clínica. Uma falha de tenant não
 * impede os demais candidatos; o próximo tick tenta novamente.
 */
export async function reconcilePendingPaymentEconomics(
  candidates: readonly PendingPaymentEconomics[],
  now: Date,
): Promise<PaymentEconomicsReconcileSummary> {
  const summary: PaymentEconomicsReconcileSummary = {
    candidates: candidates.length,
    reconciled: 0,
    corrected: 0,
    pending: 0,
    skipped: 0,
    mismatched: 0,
    failed: 0,
  };

  for (const candidate of candidates) {
    try {
      const client = await getClinicAsaasClient(candidate.clinicId);
      if (!client) {
        summary.skipped++;
        continue;
      }
      const payment = await client.getPayment(candidate.providerPaymentId, {
        attempts: 1,
        timeoutMs: PAYMENT_RECONCILE_READ_TIMEOUT_MS,
      });
      if (!SETTLED_PAYMENT_STATUSES.has(payment.status)) {
        summary.skipped++;
        continue;
      }
      if (payment.netValue == null) {
        summary.pending++;
        continue;
      }

      const outcome = await reconcilePaidChargeEconomics({
        clinicId: candidate.clinicId,
        chargeId: candidate.chargeId,
        providerPaymentId: candidate.providerPaymentId,
        reconciledAt: candidate.observedAt ?? now,
        providerGrossAmount: payment.value,
        providerNetAmount: payment.netValue,
        billingType: payment.billingType,
        providerInstallmentId: payment.installmentId ?? null,
        providerInstallmentNumber: payment.installmentNumber ?? null,
      });
      if (outcome === 'economics_reconciled') summary.reconciled++;
      else if (outcome === 'economics_corrected') summary.corrected++;
      else if (outcome === 'amount_mismatch') summary.mismatched++;
      else summary.skipped++;
    } catch (error) {
      summary.failed++;
      metrics.emit('financial.reconcile.payment_economics_error', {
        clinicId: candidate.clinicId,
        error,
      });
    }
  }
  return summary;
}
