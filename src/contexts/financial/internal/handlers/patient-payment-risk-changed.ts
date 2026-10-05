/** Payments observou disputa/perda no provider; Financial projeta no ledger. */
import type { Tx } from '@/lib/db';
import { PoisonPillError } from '@/lib/outbox/errors';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- contrato público é a fronteira Payments -> Financial. */
import { PAYMENTS_EVENTS, type PatientPaymentRiskChangedPayload } from '@/contexts/payments';
/* eslint-enable boundaries/element-types */

import { applyPatientPaymentRisk } from '../patient-credit-adjustment';
import { refreshProfessionalPayout } from '../professional-payout';

registerHandler<PatientPaymentRiskChangedPayload>(
  PAYMENTS_EVENTS.PATIENT_PAYMENT_RISK_CHANGED,
  async (ctx: {
    tx: Tx;
    clinicId: string;
    payload: PatientPaymentRiskChangedPayload;
    eventId: string;
  }) => {
    if (ctx.payload.clinicId !== ctx.clinicId) {
      throw new PoisonPillError('clinicId divergente no risco de pagamento', 'clinic_mismatch');
    }
    const outcome = await applyPatientPaymentRisk(ctx.tx, {
      clinicId: ctx.clinicId,
      payload: ctx.payload,
      sourceEventId: ctx.eventId,
    });
    if (outcome === 'loss_recorded' || outcome === 'manual_review') {
      await refreshProfessionalPayout(ctx.tx, {
        clinicId: ctx.clinicId,
        appointmentId: ctx.payload.appointmentId,
      });
    }
  },
);
