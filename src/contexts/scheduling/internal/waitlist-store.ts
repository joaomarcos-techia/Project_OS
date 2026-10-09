import { and, asc, eq, lte, notInArray, or, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { publishEvent } from '@/lib/outbox/publish';

import { SCHEDULING_EVENTS } from '../events';
import { SchedulingValidationError } from '../errors';
import { appointments, waitlistEntries, type AppointmentRow } from '../schema';
import {
  WAITLIST_OFFER_TTL_MINUTES,
  chooseWaitlistCandidate,
  isWaitlistOfferExpired,
  waitlistOfferExpiresAt,
} from '../waitlist-policy';

const DEFAULT_TZ = 'America/Sao_Paulo';

async function readOfferClock(tx: Tx, clinicId: string): Promise<{ now: Date; timeZone: string }> {
  const [row] = await tx.execute<{ db_now: Date | string; timezone: string | null }>(
    sql`SELECT clock_timestamp() AS db_now, timezone FROM clinics WHERE id = ${clinicId} LIMIT 1`,
  );
  if (!row) throw new SchedulingValidationError('clínica não encontrada');
  return { now: new Date(row.db_now), timeZone: row.timezone ?? DEFAULT_TZ };
}

/** Conferida sob o lock da entrada, antes de criar a consulta. */
export async function assertWaitlistOfferAcceptable(
  tx: Tx,
  input: { clinicId: string; offeredAt: Date | null; scheduledAt: Date },
): Promise<Date> {
  if (!input.offeredAt)
    throw new SchedulingValidationError('não há oferta aberta para esta entrada');
  const clock = await readOfferClock(tx, input.clinicId);
  const expiresAt = waitlistOfferExpiresAt(input.offeredAt, clock.timeZone);
  if (clock.now >= expiresAt) {
    throw new SchedulingValidationError('a oferta da lista de espera expirou');
  }
  if (input.scheduledAt <= clock.now) {
    throw new SchedulingValidationError('o horário ofertado já passou');
  }
  return expiresAt;
}

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
  const clock = await readOfferClock(tx, appointment.clinicId);
  if (appointment.scheduledAt <= clock.now) return null;
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
      offeredAt: sql`clock_timestamp()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(waitlistEntries.id, selected.id),
        eq(waitlistEntries.clinicId, appointment.clinicId),
        eq(waitlistEntries.status, 'waiting'),
        sql`${appointment.scheduledAt} > clock_timestamp()`,
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
    expectedOffer?: { offeredAt: Date; appointmentId: string | null };
  },
): Promise<WaitlistReleaseResult> {
  const [entry] = await tx
    .select()
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.id, input.entryId), eq(waitlistEntries.clinicId, input.clinicId)))
    .for('update')
    .limit(1);
  if (!entry || entry.status !== 'offered') return { released: false, nextEntryId: null };
  if (
    input.expectedOffer &&
    (entry.offeredAt?.getTime() !== input.expectedOffer.offeredAt.getTime() ||
      entry.offeredAppointmentId !== input.expectedOffer.appointmentId)
  ) {
    // O scan pode ter observado uma geração anterior; não liberar a nova oferta.
    return { released: false, nextEntryId: null };
  }

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
 *
 * A janela é a mesma que o seam entrega à C14 (`waitlistOfferExpiresAt`): o TTL
 * corre só nas horas de envio, no fuso de cada clínica (ADR-066). O SQL só
 * pré-filtra, porque a janela nunca fecha antes do TTL corrido. A ordenação por
 * `offered_at` não equivale à ordenação por vencimento entre fusos diferentes:
 * varremos páginas até reunir `limit` ofertas realmente vencidas.
 */
export async function findStaleWaitlistOffers(
  tx: Tx,
  input: { now: Date; limit: number },
): Promise<
  Array<{ id: string; clinicId: string; offeredAt: Date; offeredAppointmentId: string | null }>
> {
  if (input.limit <= 0) return [];
  const offeredBy = new Date(input.now.getTime() - WAITLIST_OFFER_TTL_MINUTES * 60 * 1000);
  const stale: Array<{
    id: string;
    clinicId: string;
    offeredAt: Date;
    offeredAppointmentId: string | null;
  }> = [];
  let offset = 0;
  while (stale.length < input.limit) {
    const rows = await tx
      .select({
        id: waitlistEntries.id,
        clinicId: waitlistEntries.clinicId,
        offeredAt: waitlistEntries.offeredAt,
        offeredAppointmentId: waitlistEntries.offeredAppointmentId,
        timeZone: sql<
          string | null
        >`(SELECT c.timezone FROM clinics c WHERE c.id = ${waitlistEntries.clinicId})`,
      })
      .from(waitlistEntries)
      .where(and(eq(waitlistEntries.status, 'offered'), lte(waitlistEntries.offeredAt, offeredBy)))
      .orderBy(asc(waitlistEntries.offeredAt), asc(waitlistEntries.id))
      .limit(input.limit)
      .offset(offset);
    for (const row of rows) {
      if (
        row.offeredAt &&
        isWaitlistOfferExpired(row.offeredAt, row.timeZone ?? DEFAULT_TZ, input.now)
      ) {
        stale.push({
          id: row.id,
          clinicId: row.clinicId,
          offeredAt: row.offeredAt,
          offeredAppointmentId: row.offeredAppointmentId,
        });
      }
      if (stale.length === input.limit) break;
    }
    if (rows.length < input.limit) break;
    offset += rows.length;
  }
  return stale;
}
