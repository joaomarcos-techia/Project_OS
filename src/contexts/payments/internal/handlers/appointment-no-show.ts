/**
 * Payments consumer: paciente faltou → o sinal é a taxa (ADR-049 1.5, ramo A).
 *
 * **Handler DETACHED de propósito.** O corpo fala com o Asaas, e chamada externa
 * dentro da transação do worker prende conexão do pool pelo tempo do gateway —
 * a mesma razão pela qual a criação da cobrança (1.3) roda fora de TX. As
 * transações curtas ficam dentro do `charge-store`.
 *
 * **Ownership (R3):** não escreve `appointments`. Se houver o que projetar, sai
 * `payments.patient_charge.closed` e o Scheduling projeta.
 */
import { registerDetachedHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Scheduling (mesma exceção dos demais handlers que consomem contratos de vizinhos). */
import { SCHEDULING_EVENTS, type AppointmentNoShowPayload } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { closeChargeForNoShow } from '../charge-closeout';

registerDetachedHandler<AppointmentNoShowPayload>(SCHEDULING_EVENTS.NO_SHOW, (ctx) =>
  closeChargeForNoShow({
    clinicId: ctx.clinicId,
    appointmentId: ctx.payload.appointmentId,
  }),
);
