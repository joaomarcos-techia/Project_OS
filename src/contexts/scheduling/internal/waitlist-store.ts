import { and, eq, or, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { publishEvent } from '@/lib/outbox/publish';

import { SCHEDULING_EVENTS } from '../events';
import { waitlistEntries, type AppointmentRow } from '../schema';
import { chooseWaitlistCandidate } from '../waitlist-policy';

export async function offerWaitlistForCancelledAppointment(
  tx: Tx,
  appointment: AppointmentRow,
  input: { idempotencyKey: string; correlationId: string | null },
): Promise<string | null> {
  const rows = await tx
    .select()
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.clinicId, appointment.clinicId),
        eq(waitlistEntries.status, 'waiting'),
        eq(waitlistEntries.procedureId, appointment.procedureId),
        or(eq(waitlistEntries.doctorId, appointment.doctorId), sql`${waitlistEntries.doctorId} IS NULL`),
      ),
    )
    .for('update');
  const selected = chooseWaitlistCandidate(
    rows.map((row) => ({
      id: row.id,
      doctorId: row.doctorId ?? null,
      procedureId: row.procedureId,
      priority: row.priority,
      preferredFrom: row.preferredFrom ?? null,
      preferredUntil: row.preferredUntil ?? null,
      createdAt: row.createdAt,
    })),
    {
      doctorId: appointment.doctorId,
      procedureId: appointment.procedureId,
      startsAt: appointment.scheduledAt,
    },
  );
  if (!selected) return null;

  await tx
    .update(waitlistEntries)
    .set({
      status: 'offered',
      offeredAppointmentId: appointment.id,
      offeredAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(waitlistEntries.id, selected.id),
        eq(waitlistEntries.clinicId, appointment.clinicId),
        eq(waitlistEntries.status, 'waiting'),
      ),
    );
  await publishEvent(tx, {
    clinicId: appointment.clinicId,
    eventType: SCHEDULING_EVENTS.WAITLIST_OFFERED,
    payload: {
      waitlistEntryId: selected.id,
      clinicId: appointment.clinicId,
      patientId: rows.find((row) => row.id === selected.id)!.patientId,
      releasedAppointmentId: appointment.id,
      doctorId: appointment.doctorId,
      procedureId: appointment.procedureId,
      scheduledAt: appointment.scheduledAt.toISOString(),
    },
    idempotencyKey: `${input.idempotencyKey}:waitlist-offer:${selected.id}`,
    correlationId: input.correlationId,
  });
  return selected.id;
}
