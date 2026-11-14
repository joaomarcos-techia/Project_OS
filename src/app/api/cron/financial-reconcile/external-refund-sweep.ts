/**
 * R54 — garantia do estorno feito direto no Asaas quando o webhook se perde (ou nunca foi
 * configurado na conta da clínica). O webhook é o caminho principal; isto é a malha.
 *
 * A varredura administrativa (dbAdmin, no chamador) devolve SÓ identificadores — qual
 * cobrança, de qual clínica, com qual pagamento no Asaas —, nunca valor, paciente ou dado
 * clínico. Todo o resto roda por clínica (`withTenant`, RLS), com a chave Asaas DAQUELA
 * clínica: o pagamento lido é sempre o da própria conta dela.
 *
 * Custo: uma leitura (`GET /payments/{id}/refunds`) por cobrança; só quando há estorno
 * DONE vem a segunda (`GET /payments/{id}`). Cobranças pagas nos últimos 30 dias voltam a
 * ser lidas a cada 6 h; de 30 a 180 dias, a cada 3 dias; mais antigas saem da varredura.
 * Cada leitura (com ou sem falha) avança o cursor, então uma conta quebrada não prende a fila.
 */
import { sql } from 'drizzle-orm';

import { syncCopayForAppointment } from '@/contexts/health-insurance';
import { PAYMENTS_EVENTS } from '@/contexts/payments';
import {
  confirmedRefundTotal,
  reconcileRefundIntentsForPayment,
} from '@/contexts/payments/internal/excess-refund';
import {
  markRefundChecked,
  reconcileExternalRefund,
} from '@/contexts/payments/internal/external-refund';
import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';
import { getClinicAsaasClient } from '@/lib/payments/account-store';

import { runOutboxSelectionsNow } from '../outbox/process-soon';

export const REFUND_SWEEP_READ_TIMEOUT_MS = 4_000;

export interface ExternalRefundCandidate {
  chargeId: string;
  clinicId: string;
  providerPaymentId: string;
}

export interface ExternalRefundSweepSummary {
  candidates: number;
  checked: number;
  recorded: number;
  review: number;
  skipped: number;
  failed: number;
  /** Ficaram para a próxima volta por falta de orçamento de tempo (cursor intacto). */
  deferred: number;
}

/** Leitura administrativa só de identificadores (cross-tenant, chamada dentro do dbAdmin). */
export async function scanExternalRefundCandidates(
  tx: Tx,
  limit: number,
): Promise<ExternalRefundCandidate[]> {
  const rows = await tx.execute<{
    chargeId: string;
    clinicId: string;
    providerPaymentId: string;
  }>(sql`
    SELECT id::text AS "chargeId",
           clinic_id::text AS "clinicId",
           provider_payment_id AS "providerPaymentId"
      FROM patient_charges
     WHERE status = 'paid'
       AND provider_payment_id IS NOT NULL
       AND paid_at > now() - interval '180 days'
       AND (refund_checked_at IS NULL
            OR refund_checked_at < now() - CASE WHEN paid_at > now() - interval '30 days'
                                                THEN interval '6 hours'
                                                ELSE interval '3 days' END)
     ORDER BY refund_checked_at ASC NULLS FIRST, paid_at DESC, id ASC
     LIMIT ${limit}
  `);
  return rows as unknown as ExternalRefundCandidate[];
}

export async function reconcileExternalRefundCandidates(
  candidates: readonly ExternalRefundCandidate[],
  opts: { deadlineAt: number },
): Promise<ExternalRefundSweepSummary> {
  const summary: ExternalRefundSweepSummary = {
    candidates: candidates.length,
    checked: 0,
    recorded: 0,
    review: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
  };
  for (const c of candidates) {
    if (Date.now() >= opts.deadlineAt) {
      summary.deferred++;
      continue;
    }
    try {
      const client = await getClinicAsaasClient(c.clinicId);
      if (!client) {
        summary.skipped++;
        await markRefundChecked(c.clinicId, c.chargeId);
        continue;
      }
      const refunds = await client.listPaymentRefunds(c.providerPaymentId, {
        attempts: 1,
        timeoutMs: REFUND_SWEEP_READ_TIMEOUT_MS,
      });
      if (confirmedRefundTotal(refunds) <= 0) {
        summary.checked++;
        await markRefundChecked(c.clinicId, c.chargeId);
        continue;
      }
      const payment = await client.getPayment(c.providerPaymentId, {
        attempts: 1,
        timeoutMs: REFUND_SWEEP_READ_TIMEOUT_MS,
      });
      await reconcileRefundIntentsForPayment({
        clinicId: c.clinicId,
        providerPaymentId: c.providerPaymentId,
        loadRefunds: async () => refunds,
      });
      const result = await reconcileExternalRefund({
        clinicId: c.clinicId,
        providerPaymentId: c.providerPaymentId,
        payment,
        refunds,
        source: 'reconcile',
        asaasEventId: null,
      });
      await markRefundChecked(c.clinicId, c.chargeId);
      summary.checked++;
      if (result.outcome === 'recorded') summary.recorded++;
      if (result.outcome === 'manual_review') summary.review++;
      if (
        (result.outcome === 'recorded' || result.outcome === 'manual_review') &&
        result.eventKey &&
        result.appointmentId
      ) {
        await runOutboxSelectionsNow([
          {
            eventType:
              result.outcome === 'recorded'
                ? PAYMENTS_EVENTS.EXTERNAL_REFUND_RECOGNIZED
                : PAYMENTS_EVENTS.EXTERNAL_REFUND_REVIEW_REQUIRED,
            idempotencyKeys: [result.eventKey],
          },
        ]);
        await syncCopayForAppointment(c.clinicId, result.appointmentId);
      }
    } catch (error) {
      summary.failed++;
      metrics.emit('financial.reconcile.external_refund_error', {
        clinicId: c.clinicId,
        error: error instanceof Error ? error.name : 'unknown',
      });
      try {
        await markRefundChecked(c.clinicId, c.chargeId);
      } catch {
        // O cursor fica; a próxima volta tenta de novo.
      }
    }
  }
  return summary;
}
