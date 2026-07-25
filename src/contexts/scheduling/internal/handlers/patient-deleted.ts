/**
 * Scheduling consumer: patient deletion → cancela agendamentos futuros (C6).
 *
 * Reage a `patient.core.deleted` — o sinal CANÔNICO de "paciente removido",
 * emitido por AMBOS os caminhos de exclusão (deletePatient E requestLgpdDelete,
 * que passou a emitir core.deleted além do seu evento LGPD-específico). Os docs
 * citavam `patient.deleted` — esse nome NÃO existe. NÃO registramos
 * `patient.lgpd.delete_requested`: o outbox é one-handler-per-event e o handler
 * de safety-net do próprio Patient já o consome.
 *
 * Cancela apenas estados cancelável-elegíveis (agendado/confirmado/chegou) —
 * NUNCA `em_atendimento` (R6: a state machine não permite cancelar atendimento
 * em curso; registra metric e segue). Cancelamento é EXPLÍCITO: emite
 * `scheduling.appointment.cancelled` com `cancelReason='patient_deleted'` para
 * Financial reconciliar (GAP 3) — nada some em silêncio.
 *
 * Idempotente: re-run não re-cancela (status já em 'cancelado' sai do filtro).
 */
import { and, eq, gt, inArray, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';
import { publishEvent } from '@/lib/outbox/publish';
import { registerHandler } from '@/lib/outbox/registry';

import { SCHEDULING_EVENTS } from '../../events';
import { appointments, waitlistEntries } from '../../schema';
import { logAppointmentStateChange } from '../state-log';

// Event name = contrato público do Patient (ver src/contexts/patient/events.ts).
const PATIENT_CORE_DELETED = 'patient.core.deleted';
const PATIENT_CORE_DECEASED = 'patient.core.deceased';

const CANCELLABLE = ['agendado', 'confirmado', 'chegou'] as const;

interface PatientLifecyclePayload {
  patientId: string;
  clinicId: string;
}

async function cancelFutureForPatient(ctx: {
  tx: Tx;
  clinicId: string;
  payload: PatientLifecyclePayload;
  eventId: string;
}, reason: 'patient_deleted' | 'patient_deceased'): Promise<void> {
  const { tx, clinicId, eventId } = ctx;
  const { patientId } = ctx.payload;
  const now = new Date();

  const future = await tx
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        eq(appointments.patientId, patientId),
        gt(appointments.scheduledAt, now),
        inArray(appointments.status, [...CANCELLABLE]),
      ),
    );

  for (const appt of future) {
    await logAppointmentStateChange(tx, {
      clinicId,
      appointmentId: appt.id,
      fromStatus: appt.status,
      toStatus: 'cancelado',
      transitionedBy: null,
      actorType: 'worker',
      reason,
      sourceEventId: eventId,
      correlationId: eventId,
    });
    await tx
      .update(appointments)
      .set({ status: 'cancelado', updatedAt: sql`now()` })
      .where(eq(appointments.id, appt.id));
    await publishEvent(tx, {
      clinicId,
      eventType: SCHEDULING_EVENTS.CANCELLED,
      payload: {
        appointmentId: appt.id,
        clinicId,
        fromStatus: appt.status,
        toStatus: 'cancelado',
        cancelReason: reason,
        reason,
      },
      idempotencyKey: `${reason}:${eventId}:${appt.id}`,
      correlationId: eventId,
    });
  }

  await tx
    .update(waitlistEntries)
    .set({ status: 'cancelled', updatedAt: sql`now()` })
    .where(
      and(
        eq(waitlistEntries.clinicId, clinicId),
        eq(waitlistEntries.patientId, patientId),
        inArray(waitlistEntries.status, ['waiting', 'offered']),
      ),
    );

  // R6: appointments em curso não podem ser cancelados — registra e segue.
  const inProgress = await tx
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        eq(appointments.patientId, patientId),
        gt(appointments.scheduledAt, now),
        eq(appointments.status, 'em_atendimento'),
      ),
    );
  if (inProgress.length > 0) {
    metrics.emit(`scheduling.${reason}.in_progress_skipped`, {
      clinicId,
      patientId,
      count: inProgress.length,
    });
  }
}

registerHandler<PatientLifecyclePayload>(PATIENT_CORE_DELETED, (ctx) =>
  cancelFutureForPatient(ctx, 'patient_deleted'),
);
registerHandler<PatientLifecyclePayload>(PATIENT_CORE_DECEASED, (ctx) =>
  cancelFutureForPatient(ctx, 'patient_deceased'),
);
