/** Projeta uma revisão autoritativa da tarifa sem recriar crédito ou reescrever ledger. */
import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';
import { PoisonPillError } from '@/lib/outbox/errors';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- contrato público do Payments. */
import { PAYMENTS_EVENTS, type PatientPaymentEconomicsCorrectedPayload } from '@/contexts/payments';
/* eslint-enable boundaries/element-types */

import { correctCreditEconomics } from '../credit-store';
import { refreshProfessionalPayout } from '../professional-payout';
import { recordProviderFeeAdjustment } from '../provider-expense';

async function applyCorrection(ctx: {
  tx: Tx;
  clinicId: string;
  eventId: string;
  payload: PatientPaymentEconomicsCorrectedPayload;
}): Promise<void> {
  const { tx, clinicId, payload, eventId } = ctx;
  if (payload.clinicId !== clinicId) {
    throw new PoisonPillError('clinicId divergente na revisão econômica', 'clinic_mismatch');
  }
  const observedAt = new Date(payload.observedAt);
  const result = await correctCreditEconomics(tx, {
    clinicId,
    patientChargeId: payload.chargeId,
    appointmentId: payload.appointmentId,
    revision: payload.revision,
    grossAmount: payload.providerGrossAmount,
    feeAmount: payload.providerFeeAmount,
    netAmount: payload.providerNetAmount,
    observedAt,
  });
  if (result.outcome === 'pending') {
    throw new Error('[financial] crédito original ainda pendente para revisão econômica');
  }
  if (result.outcome === 'corrected') {
    await recordProviderFeeAdjustment(tx, {
      clinicId,
      patientChargeId: payload.chargeId,
      providerPaymentId: payload.providerPaymentId,
      revision: payload.revision,
      sourceEventId: eventId,
      deltaCents: result.deltaCents,
      occurredAt: observedAt,
    });
    await refreshProfessionalPayout(tx, {
      clinicId,
      appointmentId: payload.appointmentId,
    });
  }
  metrics.emit('financial.patient_payment.economics_corrected', {
    clinicId,
    chargeId: payload.chargeId,
    revision: payload.revision,
    outcome: result.outcome,
  });
}

registerHandler<PatientPaymentEconomicsCorrectedPayload>(
  PAYMENTS_EVENTS.PAYMENT_ECONOMICS_CORRECTED,
  applyCorrection,
);
