/**
 * Clinical consumer: appointment started → cria prontuário rascunho (C7).
 *
 * Reage a `scheduling.appointment.started`. Cria 1 prontuário rascunho vinculado
 * ao appointment, se ainda não existir. Idempotente em DUPLA defesa (R9):
 *   - unique parcial em prontuarios(appointment_id) WHERE appointment_id IS NOT NULL;
 *   - onConflictDoNothing (re-entrega at-least-once não duplica).
 *
 * Walk-in sem paciente (patientId null) → no-op: prontuário exige paciente.
 */
import { sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
import { publishEvent } from '@/lib/outbox/publish';
import { registerHandler } from '@/lib/outbox/registry';

import { encryptJson } from '../content-crypto';

/* eslint-disable boundaries/element-types -- evento + tipo são o contrato PÚBLICO do Scheduling (mesma exceção do handler scheduling/patient-deleted que consome patient.core.deleted). */
import { SCHEDULING_EVENTS, type AppointmentStartedPayload } from '@/contexts/scheduling';
/* eslint-enable boundaries/element-types */

import { CLINICAL_EVENTS } from '../../events';
import { prontuarios } from '../../schema';

async function createDraftProntuario(ctx: {
  tx: Tx;
  clinicId: string;
  payload: AppointmentStartedPayload;
  eventId: string;
}): Promise<void> {
  const { tx, clinicId, payload, eventId } = ctx;
  if (payload.patientId === null) return; // walk-in sem paciente: no-op idempotente

  // AUTHZ-008 — ORDEM CAUSAL. O worker é assíncrono e pode processar `started`
  // DEPOIS de o atendimento já ter terminado. Foi o que o pentest observou: a
  // consulta fechou às cegas e, minutos depois, este handler materializou um
  // rascunho VAZIO, não assinado, atribuído a um médico que não atendeu
  // ninguém — uma trilha clínica falsa criada por um job.
  //
  // A precondição de conclusão (prontuário assinado) já impede o fechamento
  // sem registro; este guard fecha o outro lado: se o appointment já está em
  // estado terminal, não há atendimento em curso para abrir prontuário.
  // No-op idempotente, não erro: reentrega de um evento legítimo cujo
  // appointment terminou no meio do caminho não é falha.
  const [current] = await tx.execute<{ status: string }>(
    sql`SELECT status FROM appointments
         WHERE id = ${payload.appointmentId}::uuid AND clinic_id = ${clinicId}::uuid
         LIMIT 1`,
  );
  const TERMINAL = ['atendido', 'cancelado', 'faltou'];
  if (!current || TERMINAL.includes(current.status)) return;

  const [row] = await tx
    .insert(prontuarios)
    .values({
      clinicId,
      patientId: payload.patientId,
      doctorId: payload.doctorId,
      appointmentId: payload.appointmentId,
      status: 'rascunho',
      contentEncrypted: await encryptJson(clinicId, {}),
      createdBy: payload.doctorId,
    })
    .onConflictDoNothing({
      target: prontuarios.appointmentId,
      where: sql`appointment_id IS NOT NULL`,
    })
    .returning({ id: prontuarios.id });

  if (!row) return; // já existia (unique appointment_id) ⇒ idempotente

  await publishEvent(tx, {
    clinicId,
    eventType: CLINICAL_EVENTS.PRONTUARIO_CREATED,
    payload: {
      prontuarioId: row.id,
      clinicId,
      patientId: payload.patientId,
      doctorId: payload.doctorId,
      appointmentId: payload.appointmentId,
      createdBy: payload.doctorId,
    },
    idempotencyKey: `appt-started:${eventId}`,
    correlationId: eventId,
  });
}

registerHandler<AppointmentStartedPayload>(SCHEDULING_EVENTS.STARTED, createDraftProntuario);
