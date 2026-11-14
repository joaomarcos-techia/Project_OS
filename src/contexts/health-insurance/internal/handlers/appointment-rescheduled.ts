/**
 * `scheduling.appointment.rescheduled` → a cobertura do convênio acompanha a remarcação (R50,
 * P4.3). A remarcação cria um atendimento novo; o Scheduling mantém a modalidade e aqui a mesma
 * escolha (operadora, plano, carteirinha) é registrada no novo, com a cobertura do antigo
 * cancelada sem ser apagada. Particular: nada a fazer. Idempotente na reentrega.
 */
import type { Tx } from '@/lib/db';
import { PoisonPillError } from '@/lib/outbox/errors';
import { registerHandler } from '@/lib/outbox/registry';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Scheduling (mesma exceção do Financeiro). */
import { SCHEDULING_EVENTS, type AppointmentRescheduledPayload } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { carryCoverageOnRescheduleTx } from '../../modality-change';

export async function handleAppointmentRescheduled(ctx: {
  tx: Tx;
  clinicId: string;
  payload: AppointmentRescheduledPayload;
}): Promise<void> {
  if (ctx.payload.clinicId !== ctx.clinicId) {
    throw new PoisonPillError('clinicId divergente na remarcação', 'clinic_mismatch');
  }
  await carryCoverageOnRescheduleTx(ctx.tx, {
    clinicId: ctx.clinicId,
    oldAppointmentId: ctx.payload.oldAppointmentId,
    newAppointmentId: ctx.payload.newAppointmentId,
  });
}

registerHandler<AppointmentRescheduledPayload>(
  SCHEDULING_EVENTS.RESCHEDULED,
  handleAppointmentRescheduled,
);
