/**
 * Payments consumer: paciente faltou → o sinal é a taxa (ADR-049 1.5, ramo A).
 *
 * **Executado em handler DETACHED de propósito.** O corpo fala com o Asaas, e
 * chamada externa dentro da transação do worker prende conexão do pool pelo
 * tempo do gateway — a mesma razão pela qual a criação da cobrança (1.3) roda
 * fora de TX. As transações curtas ficam dentro do `charge-store`.
 *
 * **Ownership (R3):** não escreve `appointments`. Se houver o que projetar, sai
 * `payments.patient_charge.closed` e o Scheduling projeta.
 */
/* eslint-disable boundaries/element-types -- tipo é o contrato PÚBLICO do Scheduling (mesma exceção dos demais handlers que consomem contratos de vizinhos). */
import type { AppointmentNoShowPayload } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { closeChargeForNoShow } from '../charge-closeout';

/** Fase Payments da composição única registrada pelo app no outbox. */
export async function handleAppointmentNoShowPayment(ctx: {
  clinicId: string;
  payload: AppointmentNoShowPayload;
}): Promise<void> {
  await closeChargeForNoShow({
    clinicId: ctx.clinicId,
    appointmentId: ctx.payload.appointmentId,
  });
}
