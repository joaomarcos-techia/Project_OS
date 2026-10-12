/** Payments confirmou no provider a devolução do excedente. */
import type { Tx } from '@/lib/db';
import { PoisonPillError } from '@/lib/outbox/errors';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- contrato público é a fronteira Payments -> Financial. */
import { PAYMENTS_EVENTS, type ExcessRefundConfirmedPayload } from '@/contexts/payments';
/* eslint-enable boundaries/element-types */

import { recordExcessRefund } from '../patient-credit-adjustment';
import { refreshProfessionalPayout } from '../professional-payout';

registerHandler<ExcessRefundConfirmedPayload>(
  PAYMENTS_EVENTS.EXCESS_REFUND_CONFIRMED,
  async (ctx: {
    tx: Tx;
    clinicId: string;
    payload: ExcessRefundConfirmedPayload;
    eventId: string;
  }) => {
    if (ctx.payload.clinicId !== ctx.clinicId) {
      throw new PoisonPillError('clinicId divergente no estorno confirmado', 'clinic_mismatch');
    }
    const outcome = await recordExcessRefund(ctx.tx, {
      clinicId: ctx.clinicId,
      appointmentId: ctx.payload.appointmentId,
      patientChargeId: ctx.payload.chargeId,
      amount: ctx.payload.amount,
      sourceEventId: ctx.eventId,
      occurredAt: new Date(ctx.payload.confirmedAt),
    });
    if (outcome === 'recorded') {
      await refreshProfessionalPayout(ctx.tx, {
        clinicId: ctx.clinicId,
        appointmentId: ctx.payload.appointmentId,
      });
    }
  },
);
