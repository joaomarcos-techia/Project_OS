/**
 * R54: o Payments confirmou no Asaas uma devolução feita direto no painel (sem intenção do
 * Qoro). O Financial compensa a baixa original sem apagá-la, abre a pendência para revisão
 * humana e recalcula o repasse (que fica suspenso enquanto houver reversão).
 */
import type { Tx } from '@/lib/db';
import { PoisonPillError } from '@/lib/outbox/errors';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- contrato público é a fronteira Payments -> Financial. */
import { PAYMENTS_EVENTS, type ExternalRefundRecognizedPayload } from '@/contexts/payments';
/* eslint-enable boundaries/element-types */

import { recordExternalRefund } from '../patient-credit-adjustment';
import { refreshProfessionalPayout } from '../professional-payout';

registerHandler<ExternalRefundRecognizedPayload>(
  PAYMENTS_EVENTS.EXTERNAL_REFUND_RECOGNIZED,
  async (ctx: {
    tx: Tx;
    clinicId: string;
    payload: ExternalRefundRecognizedPayload;
    eventId: string;
  }) => {
    if (ctx.payload.clinicId !== ctx.clinicId) {
      throw new PoisonPillError('clinicId divergente no estorno externo', 'clinic_mismatch');
    }
    const outcome = await recordExternalRefund(ctx.tx, {
      clinicId: ctx.clinicId,
      appointmentId: ctx.payload.appointmentId,
      patientChargeId: ctx.payload.chargeId,
      amount: ctx.payload.amount,
      sourceEventId: ctx.eventId,
      occurredAt: new Date(ctx.payload.observedAt),
    });
    if (outcome === 'loss_recorded' || outcome === 'manual_review') {
      await refreshProfessionalPayout(ctx.tx, {
        clinicId: ctx.clinicId,
        appointmentId: ctx.payload.appointmentId,
      });
    }
  },
);
