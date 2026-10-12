/** Financial pediu a devolução do excedente; Payments é quem fala com o Asaas. */
import { registerDetachedHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento público é a fronteira Financial -> Payments. */
import { FINANCIAL_EVENTS, type ExcessRefundRequestedPayload } from '@/contexts/financial';
/* eslint-enable boundaries/element-types */

import { queueManualExcessRefund } from '../excess-refund';

registerDetachedHandler<ExcessRefundRequestedPayload>(
  FINANCIAL_EVENTS.EXCESS_REFUND_REQUESTED,
  async ({ clinicId, payload, eventId }) => {
    await queueManualExcessRefund({ clinicId, payload, sourceEventId: eventId });
  },
);
