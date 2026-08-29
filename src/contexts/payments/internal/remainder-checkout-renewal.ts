/** Renova os links de restante por até 7 dias, sem duplicar a dívida (D58). */
import 'server-only';

import { metrics } from '@/lib/observability/metrics';
import { getClinicAsaasClient } from '@/lib/payments/account-store';
import { BillingProviderError } from '@/lib/payments/asaas';

import {
  expireRemainderCheckoutCollection,
  findPaymentCustomer,
  listRemainderCheckoutExpiryCandidates,
  listRemainderCheckoutRenewalCandidates,
  markDepositPaid,
} from './charge-store';
import { listClinicsWithDepositEnabled } from './deposit-scan';
import { renewRemainderHostedCheckout } from './hosted-checkout';

export interface RemainderCheckoutRenewalSummary extends Record<string, unknown> {
  clinics: number;
  candidates: number;
  renewed: number;
  paymentExists: number;
  expired: number;
  failed: number;
}

const SETTLED_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);
const CANCELLABLE_STATUSES = new Set(['PENDING', 'OVERDUE']);
const CLOSED_STATUSES = new Set(['REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS', 'DELETED']);

function isNotFound(error: unknown): boolean {
  return error instanceof BillingProviderError && error.httpStatus === 404;
}

export async function runRemainderCheckoutRenewal(opts?: {
  maxClinics?: number;
  maxCandidatesPerClinic?: number;
  now?: Date;
}): Promise<RemainderCheckoutRenewalSummary> {
  const summary: RemainderCheckoutRenewalSummary = {
    clinics: 0,
    candidates: 0,
    renewed: 0,
    paymentExists: 0,
    expired: 0,
    failed: 0,
  };
  const now = opts?.now ?? new Date();
  const clinicIds = await listClinicsWithDepositEnabled(opts?.maxClinics ?? 500);
  summary.clinics = clinicIds.length;

  for (const clinicId of clinicIds) {
    const expiryCandidates = await listRemainderCheckoutExpiryCandidates(
      clinicId,
      now,
      opts?.maxCandidatesPerClinic ?? 100,
    );
    const candidates = await listRemainderCheckoutRenewalCandidates(
      clinicId,
      now,
      opts?.maxCandidatesPerClinic ?? 100,
    );
    summary.candidates += candidates.length;
    if (candidates.length === 0 && expiryCandidates.length === 0) continue;

    const client = await getClinicAsaasClient(clinicId);
    if (!client) {
      summary.failed += candidates.length + expiryCandidates.length;
      metrics.emit('payments.remainder.renewal_no_account', {
        clinicId,
        candidates: candidates.length + expiryCandidates.length,
      });
      continue;
    }

    for (const candidate of expiryCandidates) {
      try {
        const payment = candidate.providerPaymentId
          ? await client
              .getPayment(candidate.providerPaymentId, { attempts: 1 })
              .catch((error: unknown) => {
                if (isNotFound(error)) return null;
                throw error;
              })
          : await client.findPaymentByCheckoutSession(candidate.providerCheckoutId, {
              attempts: 1,
            });

        if (payment && !payment.deleted && SETTLED_STATUSES.has(payment.status)) {
          await markDepositPaid({
            clinicId,
            providerPaymentId: payment.paymentId,
            checkoutSessionId: payment.checkoutSessionId,
            asaasEventId: `reconcile:checkout-expiry:${payment.paymentId}`,
            eventType: 'PAYMENT_RECONCILED',
            paidAt: new Date(),
            billingType: payment.billingType,
          });
          summary.paymentExists += 1;
          continue;
        }

        if (payment && !payment.deleted && CANCELLABLE_STATUSES.has(payment.status)) {
          await client.cancelPayment(payment.paymentId).catch((error: unknown) => {
            if (!isNotFound(error)) throw error;
          });
        } else if (payment && !payment.deleted && !CLOSED_STATUSES.has(payment.status)) {
          throw new Error(`[payments] estado não fechável no fim da coleta: ${payment.status}`);
        }

        const expired = await expireRemainderCheckoutCollection({
          clinicId,
          chargeId: candidate.chargeId,
          expiredAt: now,
        });
        if (expired) summary.expired += 1;
      } catch (error) {
        summary.failed += 1;
        metrics.emit('payments.remainder.expiry_error', {
          clinicId,
          chargeId: candidate.chargeId,
          error,
        });
      }
    }

    for (const candidate of candidates) {
      try {
        const customerId = await findPaymentCustomer(clinicId, candidate.patientId);
        if (!customerId) {
          summary.failed += 1;
          metrics.emit('payments.remainder.renewal_no_customer', {
            clinicId,
            chargeId: candidate.chargeId,
          });
          continue;
        }

        const outcome = await renewRemainderHostedCheckout({
          client,
          clinicId,
          customerId,
          candidate,
          now,
        });
        if (outcome === 'created') summary.renewed += 1;
        else if (outcome === 'payment_exists') summary.paymentExists += 1;
      } catch (error) {
        summary.failed += 1;
        metrics.emit('payments.remainder.renewal_error', {
          clinicId,
          chargeId: candidate.chargeId,
          error,
        });
      }
    }
  }

  return summary;
}
