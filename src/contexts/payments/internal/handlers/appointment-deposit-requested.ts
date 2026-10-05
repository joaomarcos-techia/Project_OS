/**
 * A confirmação de um agendamento pela IA antecipa a varredura do sinal.
 * O Asaas roda fora da transação do outbox; o scan periódico continua como
 * recuperação, e o claim único de Payments impede cobranças duplicadas.
 */
import { metrics } from '@/lib/observability/metrics';
import { registerDetachedHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- contrato público de Scheduling, consultado com escopo tenant antes da cobrança. */
import {
  SCHEDULING_EVENTS,
  schedulingApiV1,
  type AppointmentDepositRequestedPayload,
} from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { createDepositCharge } from '../deposit-charge';

registerDetachedHandler<AppointmentDepositRequestedPayload>(
  SCHEDULING_EVENTS.DEPOSIT_REQUESTED,
  async ({ clinicId, payload }) => {
    if (payload.clinicId !== clinicId) {
      throw new Error('clínica do pedido de sinal difere do evento');
    }
    const appointment = await schedulingApiV1.lookupDepositCandidate(
      clinicId,
      payload.appointmentId,
    );
    if (!appointment) {
      metrics.emit('payments.deposit.request_skipped_ineligible', {
        clinicId,
        appointmentId: payload.appointmentId,
      });
      return;
    }
    await createDepositCharge({ clinicId, appointment });
  },
);
