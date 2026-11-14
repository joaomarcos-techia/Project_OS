/**
 * Payments consumer (P4.3): a forma de atendimento mudou antes da chegada.
 *
 * Virou CONVÊNIO: a cobrança particular ainda aberta (sinal ou saldo) é anulada — atendimento
 * coberto nunca mantém link de valor cheio. Virou PARTICULAR: nada aqui; o recebível nasce na
 * conclusão pelo caminho normal e nenhuma cobrança é criada pela troca.
 *
 * **Handler DETACHED**: anular o link chama o Asaas, que não pode rodar dentro da transação do
 * worker (mesma razão do `appointment-cancelled`). Reentrega é segura: só cobrança `pending`
 * é anulada e o fechamento é monotônico.
 */
import { metrics } from '@/lib/observability/metrics';
import { registerDetachedHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Scheduling (mesma exceção dos demais handlers que consomem contratos de vizinhos). */
import {
  SCHEDULING_EVENTS,
  type AppointmentBillingModeChangedPayload,
} from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { closeChargesForBillingModeChange } from '../charge-closeout';

registerDetachedHandler<AppointmentBillingModeChangedPayload>(
  SCHEDULING_EVENTS.BILLING_MODE_CHANGED,
  async (ctx) => {
    if (ctx.payload.to !== 'convenio') {
      metrics.emit('payments.billing_mode_changed.ignored', {
        clinicId: ctx.clinicId,
        to: ctx.payload.to,
      });
      return;
    }
    await closeChargesForBillingModeChange({
      clinicId: ctx.clinicId,
      appointmentId: ctx.payload.appointmentId,
      sourceEventId: ctx.eventId,
    });
  },
);
