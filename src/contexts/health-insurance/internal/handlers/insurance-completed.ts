/**
 * `scheduling.appointment.insurance_completed` → Guia de Consulta automática (P7.4).
 *
 * O Scheduling publica este evento JUNTO com `completed` quando o atendimento é
 * de convênio (mesma transação). O Financeiro ouve o `completed` e NÃO cria
 * recebível cheio para convênio; aqui o atendimento entra no faturamento:
 * `processInsuranceBilling` lê o estado ATUAL do banco (não o do payload, então
 * evento fora de ordem não faz nada errado) e termina com guia pronta para
 * conferência ou com uma pendência persistente com motivo e responsável.
 *
 * Reentrega: a guia é idempotente e a pendência é uma por atendimento. Falha no
 * meio: a transação do worker desfaz tudo (inclusive o número) e o outbox retenta;
 * se o evento esgotar as tentativas, o reconcile periódico retoma o atendimento.
 */
import type { Tx } from '@/lib/db';
import { PoisonPillError } from '@/lib/outbox/errors';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Scheduling (mesma exceção do Financeiro). */
import {
  SCHEDULING_EVENTS,
  type AppointmentInsuranceCompletedPayload,
} from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { processInsuranceBilling } from '../billing-recovery';

export { dateInTimezone } from '../billing-recovery';

export async function handleInsuranceCompleted(ctx: {
  tx: Tx;
  clinicId: string;
  payload: AppointmentInsuranceCompletedPayload;
  eventId: string;
}): Promise<void> {
  const { tx, clinicId, payload } = ctx;
  if (payload.clinicId !== clinicId) {
    throw new PoisonPillError(
      `clinicId divergente: payload=${payload.clinicId} ctx=${clinicId}`,
      'clinic_mismatch',
    );
  }
  await processInsuranceBilling(tx, {
    clinicId,
    appointmentId: payload.appointmentId,
    detectedBy: 'event',
    eventState: 'processed',
    lock: 'wait',
  });
}

registerHandler<AppointmentInsuranceCompletedPayload>(
  SCHEDULING_EVENTS.INSURANCE_COMPLETED,
  handleInsuranceCompleted,
);
