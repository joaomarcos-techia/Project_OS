/**
 * R54: devolução no Asaas que o Payments não consegue atribuir com segurança (disputa,
 * intenção do Qoro ainda aberta, valor divergente). Só abre
 * a pendência para revisão humana: nada é compensado e nenhuma cobrança é criada.
 */
import type { Tx } from '@/lib/db';
import { PoisonPillError } from '@/lib/outbox/errors';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- contrato público é a fronteira Payments -> Financial. */
import { PAYMENTS_EVENTS, type ExternalRefundReviewRequiredPayload } from '@/contexts/payments';
/* eslint-enable boundaries/element-types */

import { openExternalRefundReview } from '../patient-credit-adjustment';

registerHandler<ExternalRefundReviewRequiredPayload>(
  PAYMENTS_EVENTS.EXTERNAL_REFUND_REVIEW_REQUIRED,
  async (ctx: { tx: Tx; clinicId: string; payload: ExternalRefundReviewRequiredPayload }) => {
    if (ctx.payload.clinicId !== ctx.clinicId) {
      throw new PoisonPillError('clinicId divergente na revisão de estorno', 'clinic_mismatch');
    }
    await openExternalRefundReview(ctx.tx, {
      clinicId: ctx.clinicId,
      appointmentId: ctx.payload.appointmentId,
      amount: ctx.payload.amount,
      reason: ctx.payload.reason,
    });
  },
);
