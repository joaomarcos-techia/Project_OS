/**
 * Payments consumer: agendamento cancelado → estorno ou fim do link (ADR-049 1.5,
 * ramo C).
 *
 * **Handler DETACHED**, pela mesma razão do irmão de `no_show`: o corpo chama o
 * Asaas, e isso não pode acontecer dentro da transação do worker.
 *
 * **`cancelledAt` vem do payload, não do relógio.** A regra é de ANTECEDÊNCIA:
 * julgar com `new Date()` faria um cancelamento feito a tempo virar "tarde
 * demais" sempre que o outbox atrasasse — o paciente perderia o sinal por causa
 * de uma fila nossa. O campo é opcional no contrato só para os eventos que já
 * estavam na fila no momento do deploy; para esses, o relógio é o que resta, e a
 * degradação fica registrada em métrica.
 */
import { metrics } from '@/lib/observability/metrics';
import { registerDetachedHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Scheduling (mesma exceção dos demais handlers que consomem contratos de vizinhos). */
import { SCHEDULING_EVENTS, type AppointmentCancelledPayload } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { closeChargeForCancellation } from '../charge-closeout';

registerDetachedHandler<AppointmentCancelledPayload>(SCHEDULING_EVENTS.CANCELLED, async (ctx) => {
  const { cancelledAt } = ctx.payload;
  if (!cancelledAt) {
    metrics.emit('payments.deposit.cancel_without_timestamp', {
      clinicId: ctx.clinicId,
      appointmentId: ctx.payload.appointmentId,
    });
  }
  await closeChargeForCancellation({
    clinicId: ctx.clinicId,
    appointmentId: ctx.payload.appointmentId,
    cancelReason: ctx.payload.cancelReason,
    cancelledAt: cancelledAt ? new Date(cancelledAt) : new Date(),
    sourceEventId: ctx.eventId,
  });
});
