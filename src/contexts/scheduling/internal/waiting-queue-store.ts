import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

import { SchedulingValidationError } from '../errors';
import { appointments, waitingQueueEntries, type AppointmentRow } from '../schema';
import type { AppointmentStatusDTO } from '../types';
import {
  calculateWalkInCapacity,
  estimateWaitMinutes,
  type QueueCandidate,
  type QueuePriority,
  type WalkInCapacity,
} from './walkin-queue';

interface CapacityRow extends Record<string, unknown> {
  remaining_availability_minutes: number;
  committed_minutes: number;
}

export async function assertWalkInOperationalCapacity(
  tx: Tx,
  input: {
    clinicId: string;
    doctorId: string;
    unitId: string | null;
    requestedDurationMinutes: number;
  },
): Promise<WalkInCapacity> {
  // Serializa apenas as entradas de fila do mesmo profissional. A quota não é
  // comercial: ela deriva dos minutos de disponibilidade ainda restantes.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.clinicId}:${input.doctorId}:waiting-queue`}, 0))`,
  );

  const rows = await tx.execute<CapacityRow>(sql`
    WITH clinic_clock AS (
      SELECT timezone(c.timezone, now()) AS local_now, c.timezone
        FROM clinics c
       WHERE c.id = ${input.clinicId}
    ), remaining_availability AS (
      SELECT coalesce(sum(greatest(
        0,
        extract(epoch FROM (
          da.end_time - greatest(da.start_time, cc.local_now::time)
        )) / 60
      )), 0)::int AS minutes
        FROM doctor_availability da
        CROSS JOIN clinic_clock cc
       WHERE da.clinic_id = ${input.clinicId}
         AND da.doctor_id = ${input.doctorId}
         AND da.weekday = extract(dow FROM cc.local_now)::int
         AND da.end_time > cc.local_now::time
         AND (
           (${input.unitId}::uuid IS NULL AND da.unit_id IS NULL)
           OR (${input.unitId}::uuid IS NOT NULL AND (da.unit_id IS NULL OR da.unit_id = ${input.unitId}::uuid))
         )
    ), committed AS (
      SELECT coalesce(sum(a.duration_min), 0)::int AS minutes
        FROM appointments a
        CROSS JOIN clinic_clock cc
       WHERE a.clinic_id = ${input.clinicId}
         AND a.doctor_id = ${input.doctorId}
         AND a.status IN ('agendado', 'confirmado', 'chegou', 'em_atendimento')
         AND timezone(cc.timezone, a.scheduled_at)::date = cc.local_now::date
         AND (a.scheduled_at >= now() OR a.status IN ('chegou', 'em_atendimento'))
    )
    SELECT remaining_availability.minutes AS remaining_availability_minutes,
           committed.minutes AS committed_minutes
      FROM remaining_availability, committed
  `);
  const row = rows[0] ?? { remaining_availability_minutes: 0, committed_minutes: 0 };
  const capacity = calculateWalkInCapacity({
    remainingAvailabilityMinutes: Number(row.remaining_availability_minutes),
    committedMinutes: Number(row.committed_minutes),
    requestedDurationMinutes: input.requestedDurationMinutes,
  });
  if (!capacity.accepted) {
    throw new SchedulingValidationError(
      'sem capacidade operacional para este encaixe na disponibilidade restante do profissional',
    );
  }
  return capacity;
}

async function listActiveQueueCandidates(
  tx: Tx,
  clinicId: string,
  doctorId: string,
): Promise<QueueCandidate[]> {
  const rows = await tx
    .select({
      id: waitingQueueEntries.id,
      status: waitingQueueEntries.status,
      priority: waitingQueueEntries.priority,
      queuedAt: waitingQueueEntries.queuedAt,
      durationMinutes: appointments.durationMin,
    })
    .from(waitingQueueEntries)
    .innerJoin(appointments, eq(appointments.id, waitingQueueEntries.appointmentId))
    .where(
      and(
        eq(waitingQueueEntries.clinicId, clinicId),
        eq(waitingQueueEntries.doctorId, doctorId),
        inArray(waitingQueueEntries.status, ['waiting', 'in_service']),
      ),
    );
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    priority: row.priority,
    queuedAt: row.queuedAt.toISOString(),
    durationMinutes: row.durationMinutes,
  }));
}

export async function enqueueWaitingAppointment(
  tx: Tx,
  appointment: AppointmentRow,
  createdBy: string | null,
): Promise<void> {
  const priority: QueuePriority = appointment.urgencia ? 'urgent' : 'normal';
  const current = await listActiveQueueCandidates(tx, appointment.clinicId, appointment.doctorId);
  const estimatedWaitMinutesAtEntry = estimateWaitMinutes(current, priority);
  await tx
    .insert(waitingQueueEntries)
    .values({
      clinicId: appointment.clinicId,
      appointmentId: appointment.id,
      doctorId: appointment.doctorId,
      priority,
      status: 'waiting',
      estimatedWaitMinutesAtEntry,
      createdBy,
    })
    .onConflictDoUpdate({
      target: waitingQueueEntries.appointmentId,
      set: {
        doctorId: appointment.doctorId,
        priority,
        status: 'waiting',
        estimatedWaitMinutesAtEntry,
        startedAt: null,
        endedAt: null,
        updatedAt: sql`now()`,
      },
    });
}

export async function syncWaitingQueueStatus(
  tx: Tx,
  appointment: AppointmentRow,
  target: AppointmentStatusDTO,
  actorId: string | null,
): Promise<void> {
  if (target === 'chegou') {
    await enqueueWaitingAppointment(tx, appointment, actorId);
    return;
  }

  const status =
    target === 'em_atendimento'
      ? 'in_service'
      : target === 'atendido'
        ? 'completed'
        : target === 'cancelado' || target === 'faltou'
          ? 'cancelled'
          : null;
  if (!status) return;

  await tx
    .update(waitingQueueEntries)
    .set({
      status,
      ...(status === 'in_service' ? { startedAt: sql`now()` } : {}),
      ...(status === 'completed' || status === 'cancelled' ? { endedAt: sql`now()` } : {}),
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(waitingQueueEntries.appointmentId, appointment.id),
        eq(waitingQueueEntries.clinicId, appointment.clinicId),
      ),
    );
}
