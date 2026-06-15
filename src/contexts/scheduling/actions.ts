'use server';

/**
 * Scheduling appointment-lifecycle Server Actions (C6). Frozen pipeline (C5):
 *
 *   requireUser → requireFreshPermission → core(actor='user')
 *
 * C12: a lógica de mutação (Zod, state machine, snapshot imutável, anti-conflito,
 * idempotência, audit, eventos) vive em ./internal/appointment-core e é
 * COMPARTILHADA com o AI Agent (ator de sistema 'ai_agent'). Estas Server Actions
 * só resolvem o ator do request (requireUser/permission) e delegam — a IA NÃO
 * tem bypass: passa pelo MESMO core, apenas com actorType diferente.
 *
 * Snapshot é gravado na criação e IMUTÁVEL (trigger). Procedure NUNCA deletado
 * (FK RESTRICT). Conflito (UNIQUE 23505 / EXCLUDE 23P01) → SchedulingConflictError.
 */
import { sql } from 'drizzle-orm';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';
import { idempotentMutation } from '@/lib/idempotency/mutation';

import { SCHEDULING_EVENTS, type CancelReason } from './events';
import { toAppointmentSummary } from './queries';
import { appointments } from './schema';
import { type AppointmentState } from './state-machine';
import { asConflict, idemKey, IDEM_TTL, jsonSafe, requestContext } from './internal/action-helpers';
import {
  buildSnapshot,
  createAppointmentCore,
  publishCreated,
  rescheduleCore,
  transitionCore,
} from './internal/appointment-core';
import { logAppointmentStateChange } from './internal/state-log';
import {
  CreateWalkInSchema,
  type AppointmentSummary,
  type CreateAppointmentInput,
  type CreateWalkInInput,
  type RescheduleInput,
} from './types';

/** Factory for the six single-target transition actions (request actor). */
function transitionAction(
  action: string,
  target: AppointmentState,
  eventName: string,
  cancelReason?: CancelReason,
) {
  return async function (
    id: string,
    idempotencyKey: string,
    reason?: string,
  ): Promise<AppointmentSummary> {
    const user = await requireUser();
    await requireFreshPermission(PERMISSIONS.EDIT_AGENDA);
    const clinicId = await requireClinicId();
    const ctx = await requestContext();
    return transitionCore(
      { clinicId, userId: user.userId },
      'user',
      ctx,
      { action, target, eventName, cancelReason, id, reason: reason ?? undefined },
      idempotencyKey,
    );
  };
}

export const confirmAppointment = transitionAction('confirm', 'confirmado', SCHEDULING_EVENTS.CONFIRMED);
export const checkInAppointment = transitionAction('checkin', 'chegou', SCHEDULING_EVENTS.CHECKED_IN);
export const startAppointment = transitionAction('start', 'em_atendimento', SCHEDULING_EVENTS.STARTED);
export const completeAppointment = transitionAction('complete', 'atendido', SCHEDULING_EVENTS.COMPLETED);
export const cancelAppointment = transitionAction('cancel', 'cancelado', SCHEDULING_EVENTS.CANCELLED, 'user');
export const markNoShow = transitionAction('no_show', 'faltou', SCHEDULING_EVENTS.NO_SHOW);

// --- createAppointment -----------------------------------------------------

export async function createAppointment(
  input: CreateAppointmentInput,
  idempotencyKey: string,
): Promise<AppointmentSummary> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.EDIT_AGENDA);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  return createAppointmentCore({ clinicId, userId: user.userId }, 'user', ctx, input, idempotencyKey);
}

// --- createWalkInAppointment (status='chegou' direto) ----------------------

export async function createWalkInAppointment(
  input: CreateWalkInInput,
  idempotencyKey: string,
): Promise<AppointmentSummary> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.EDIT_AGENDA);
  const data = CreateWalkInSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  try {
    return await idempotentMutation(
      {
        idempotency: { key: idemKey('walkin', idempotencyKey), payload: jsonSafe(data), ttlSeconds: IDEM_TTL },
        audit: {
          action: SCHEDULING_EVENTS.CREATED,
          resourceType: 'appointment',
          resourceId: null,
          before: null,
          requestContext: ctx,
        },
      },
      async (tx) => {
        const snap = await buildSnapshot(tx, clinicId, data.procedureId, data.doctorId);
        const [row] = await tx
          .insert(appointments)
          .values({
            clinicId,
            unitId: data.unitId ?? null,
            doctorId: data.doctorId,
            patientId: data.patientId ?? null,
            procedureId: data.procedureId,
            scheduledAt: sql`now()`, // microssegundos → nunca colide na UNIQUE; isento do EXCLUDE
            durationMin: snap.duracaoMin,
            status: 'chegou',
            valor: snap.valorPadrao,
            snapshotProcedureName: snap.nome,
            snapshotProcedureCodigo: snap.codigo,
            snapshotProcedureCategoria: snap.categoria,
            snapshotProcedureValor: snap.valorPadrao,
            snapshotProcedureDuracaoMin: snap.duracaoMin,
            snapshotDoctorNome: snap.doctorNome,
            createdVia: 'walkin',
            urgencia: data.urgencia ?? false,
            observacoes: data.observacoes ?? null,
            createdBy: user.userId,
          })
          .returning();

        await logAppointmentStateChange(tx, {
          clinicId,
          appointmentId: row!.id,
          fromStatus: null,
          toStatus: 'chegou',
          transitionedBy: user.userId,
          actorType: 'user',
          reason: 'walk-in',
          sourceIdempotencyKey: idempotencyKey,
          correlationId: ctx.correlationId ?? null,
        });

        await publishCreated(tx, row!, idempotencyKey, ctx.correlationId ?? null);
        return toAppointmentSummary(row!);
      },
    );
  } catch (err) {
    return asConflict(err);
  }
}

// --- rescheduleAppointment (= cancel + create; preserva preço — M3) --------

export async function rescheduleAppointment(
  id: string,
  input: RescheduleInput,
  idempotencyKey: string,
): Promise<AppointmentSummary> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.EDIT_AGENDA);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  return rescheduleCore({ clinicId, userId: user.userId }, 'user', ctx, id, input, idempotencyKey);
}
