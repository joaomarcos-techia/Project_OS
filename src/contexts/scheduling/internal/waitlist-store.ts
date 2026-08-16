import { and, eq, notInArray, or, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { publishEvent } from '@/lib/outbox/publish';

import { SCHEDULING_EVENTS } from '../events';
import { appointments, waitlistEntries, type AppointmentRow } from '../schema';
import { chooseWaitlistCandidate } from '../waitlist-policy';

/**
 * WAIT-001 — oferta da vaga liberada por um cancelamento.
 *
 * `excludeEntryIds` existe para o repasse: quem recusou (ou deixou a oferta
 * expirar) volta para a fila, mas não pode ser reescolhido para a MESMA vaga na
 * mesma transação — senão a vaga fica presa no primeiro candidato para sempre.
 */
export async function offerWaitlistForCancelledAppointment(
  tx: Tx,
  appointment: AppointmentRow,
  input: {
    idempotencyKey: string;
    correlationId: string | null;
    excludeEntryIds?: readonly string[];
  },
): Promise<string | null> {
  const excluded = input.excludeEntryIds ?? [];
  const rows = await tx
    .select()
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.clinicId, appointment.clinicId),
        eq(waitlistEntries.status, 'waiting'),
        eq(waitlistEntries.procedureId, appointment.procedureId),
        or(
          eq(waitlistEntries.doctorId, appointment.doctorId),
          sql`${waitlistEntries.doctorId} IS NULL`,
        ),
        ...(excluded.length > 0 ? [notInArray(waitlistEntries.id, [...excluded])] : []),
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

  // O `status = 'waiting'` no WHERE é o que garante UM vencedor: duas
  // transações concorrentes disputando a mesma entrada — o `FOR UPDATE` acima
  // serializa, e a perdedora não encontra mais a linha em `waiting`.
  const claimed = await tx
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
    )
    .returning({ id: waitlistEntries.id });
  if (claimed.length === 0) return null;

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
      doctorNome: appointment.snapshotDoctorNome,
    },
    // A chave inclui a entrada escolhida: o repasse ao próximo candidato é um
    // evento NOVO, não um replay do primeiro.
    idempotencyKey: `${input.idempotencyKey}:waitlist-offer:${selected.id}`,
    correlationId: input.correlationId,
  });
  return selected.id;
}

export interface WaitlistReleaseResult {
  released: boolean;
  /** Próximo candidato que recebeu a vaga, quando havia um. */
  nextEntryId: string | null;
}

/**
 * WAIT-001 — devolve uma oferta à fila (recusa ou expiração) e REPASSA a vaga.
 *
 * Sem o repasse, uma recusa mataria o horário: a entrada voltaria para `waiting`
 * e ninguém mais seria ofertado, que é o mesmo desfecho de não ter automação
 * nenhuma. Idempotente por construção — só age sobre `status='offered'`, então
 * um replay encontra a linha já em `waiting` e devolve `released: false`.
 */
export async function releaseWaitlistOffer(
  tx: Tx,
  input: {
    clinicId: string;
    entryId: string;
    idempotencyKey: string;
    correlationId: string | null;
  },
): Promise<WaitlistReleaseResult> {
  const [entry] = await tx
    .select()
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.id, input.entryId), eq(waitlistEntries.clinicId, input.clinicId)))
    .for('update')
    .limit(1);
  if (!entry || entry.status !== 'offered') return { released: false, nextEntryId: null };

  const releasedAppointmentId = entry.offeredAppointmentId;
  await tx
    .update(waitlistEntries)
    .set({
      status: 'waiting',
      offeredAppointmentId: null,
      offeredAt: null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(waitlistEntries.id, entry.id), eq(waitlistEntries.clinicId, input.clinicId)));

  if (!releasedAppointmentId) return { released: true, nextEntryId: null };

  const [appointment] = await tx
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.id, releasedAppointmentId),
        eq(appointments.clinicId, input.clinicId),
        // A vaga só existe enquanto o atendimento original continuar cancelado.
        // Se alguém reabriu ou já a preencheu, não há o que repassar.
        eq(appointments.status, 'cancelado'),
      ),
    )
    .limit(1);
  if (!appointment) return { released: true, nextEntryId: null };

  const nextEntryId = await offerWaitlistForCancelledAppointment(tx, appointment, {
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    excludeEntryIds: [entry.id],
  });
  return { released: true, nextEntryId };
}

/**
 * Ofertas sem resposta dentro da janela. A vaga é perecível: segurá-la
 * indefinidamente em quem não respondeu é como não ter lista de espera.
 */
export async function findStaleWaitlistOffers(
  tx: Tx,
  input: { olderThanMinutes: number; limit: number },
): Promise<Array<{ id: string; clinicId: string }>> {
  const rows = await tx
    .select({ id: waitlistEntries.id, clinicId: waitlistEntries.clinicId })
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.status, 'offered'),
        sql`${waitlistEntries.offeredAt} < now() - make_interval(mins => ${input.olderThanMinutes})`,
      ),
    )
    .limit(input.limit);
  return rows;
}
