/** Read-back D50: confirma timeout de estorno sem repetir POST. */
import 'server-only';

import { metrics } from '@/lib/observability/metrics';
import { getClinicAsaasClient } from '@/lib/payments/account-store';

import { listClinicsWithDepositEnabled } from './deposit-scan';
import {
  confirmRefundIntentFromReadback,
  listRefundIntentReconcileCandidates,
} from './excess-refund';

export interface ExcessRefundReconcileSummary extends Record<string, unknown> {
  clinics: number;
  candidates: number;
  confirmed: number;
  pending: number;
  failed: number;
}

export async function runExcessRefundReconcile(opts?: {
  maxClinics?: number;
  maxCandidatesPerClinic?: number;
}): Promise<ExcessRefundReconcileSummary> {
  const summary: ExcessRefundReconcileSummary = {
    clinics: 0,
    candidates: 0,
    confirmed: 0,
    pending: 0,
    failed: 0,
  };
  const clinicIds = await listClinicsWithDepositEnabled(opts?.maxClinics ?? 500);
  summary.clinics = clinicIds.length;

  for (const clinicId of clinicIds) {
    const candidates = await listRefundIntentReconcileCandidates(
      clinicId,
      opts?.maxCandidatesPerClinic ?? 100,
    );
    summary.candidates += candidates.length;
    if (candidates.length === 0) continue;
    const client = await getClinicAsaasClient(clinicId);
    if (!client) {
      summary.failed += candidates.length;
      continue;
    }

    for (const candidate of candidates) {
      try {
        const refunds = await client.listPaymentRefunds(candidate.providerPaymentId, {
          attempts: 1,
        });
        const confirmed = await confirmRefundIntentFromReadback({
          clinicId,
          intentId: candidate.id,
          refunds,
        });
        if (confirmed) summary.confirmed += 1;
        else summary.pending += 1;
      } catch (error) {
        summary.failed += 1;
        metrics.emit('payments.excess_refund.reconcile_failed', {
          clinicId,
          intentId: candidate.id,
          error,
        });
      }
    }
  }
  return summary;
}
