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
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';
import { idempotentMutation } from '@/lib/idempotency/mutation';
import { MUTATION_IDEM_TTL_SECONDS } from '@/lib/idempotency/ttl';
import { publishEvent } from '@/lib/outbox/publish';

import { SCHEDULING_EVENTS, type CancelReason } from './events';
import { SchedulingValidationError } from './errors';
import { getAppointmentOrThrow, toAppointmentSummary } from './queries';
import {
  appointmentCorrections,
  appointmentImportBatches,
  appointments,
  doctorAbsences,
  procedures,
  recurrenceSeries,
  waitlistEntries,
} from './schema';
import { buildWeeklyOccurrences } from './recurrence-policy';
import { decideAppointmentRecovery } from './recovery-policy';
import { assertTransition, type AppointmentState } from './state-machine';
import { asConflict, idemKey, jsonSafe, requestContext } from './internal/action-helpers';
import { assertCanManageDoctorSchedule } from './internal/availability-scope';
import { assertCanCompleteClinically } from './internal/clinical-completion';
import {
  assertActiveDoctorInClinic,
  assertPatientInClinic,
  buildSnapshot,
  createAppointmentCore,
  insertScheduledAppointment,
  applyTransition,
  publishCreated,
  reserveAppointmentResources,
  setAppointmentResourceReservationsActive,
  rescheduleCore,
  transitionCore,
} from './internal/appointment-core';
import { logAppointmentStateChange } from './internal/state-log';
import {
  assertWalkInOperationalCapacity,
  enqueueWaitingAppointment,
  syncWaitingQueueStatus,
} from './internal/waiting-queue-store';
import {
  CreateDoctorAbsenceSchema,
  HistoricalAppointmentImportSchema,
  CreateRecurringAppointmentsSchema,
  CreateWaitlistEntrySchema,
  CreateWalkInSchema,
  RecoverAppointmentSchema,
  type AppointmentSummary,
  type CreateAppointmentInput,
  type CreateDoctorAbsenceInput,
  type CreateRecurringAppointmentsInput,
  type CreateWaitlistEntryInput,
  type CreateWalkInInput,
  type DoctorAbsenceResult,
  type HistoricalAppointmentImportInput,
  type HistoricalAppointmentImportResult,
  type RescheduleInput,
  type RecoverAppointmentInput,
  type RecurrenceSeriesResult,
  type WaitlistEntryDTO,
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
    // AUTHZ-008 — `edit:agenda` autoriza MOVER A FILA (check-in, chamar,
    // falta, cancelar). Declarar que houve atendimento é ato clínico e exige
    // capacidade clínica fresh + vínculo com o profissional atribuído (ou
    // delegação administrativa). Antes, a factory tratava as seis transições
    // como equivalentes — foi por isso que um atendente encerrou a consulta.
    if (target === 'atendido') {
      const appt = await getAppointmentOrThrow(clinicId, id);
      await assertCanCompleteClinically(user, appt.doctorId);
    }
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

export const confirmAppointment = transitionAction(
  'confirm',
  'confirmado',
  SCHEDULING_EVENTS.CONFIRMED,
);
export const checkInAppointment = transitionAction(
  'checkin',
  'chegou',
  SCHEDULING_EVENTS.CHECKED_IN,
);
export const startAppointment = transitionAction(
  'start',
  'em_atendimento',
  SCHEDULING_EVENTS.STARTED,
);
export const completeAppointment = transitionAction(
  'complete',
  'atendido',
  SCHEDULING_EVENTS.COMPLETED,
);
export const cancelAppointment = transitionAction(
  'cancel',
  'cancelado',
  SCHEDULING_EVENTS.CANCELLED,
  'user',
);
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
  return createAppointmentCore(
    { clinicId, userId: user.userId },
    'user',
    ctx,
    input,
    idempotencyKey,
  );
}

export async function createRecurringAppointments(
  input: CreateRecurringAppointmentsInput,
  idempotencyKey: string,
): Promise<RecurrenceSeriesResult> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.EDIT_AGENDA);
  const data = CreateRecurringAppointmentsSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  const occurrenceDates = buildWeeklyOccurrences(data);
  if (occurrenceDates.some((date) => date.getTime() < Date.now())) {
    throw new SchedulingValidationError('não é permitido criar recorrência no passado');
  }

  try {
    return await idempotentMutation(
      {
        idempotency: {
          key: idemKey('recurrence_create', idempotencyKey),
          payload: jsonSafe(data),
          ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
        },
        audit: {
          action: SCHEDULING_EVENTS.RECURRENCE_CREATED,
          resourceType: 'recurrence_series',
          resourceId: null,
          before: null,
          requestContext: ctx,
        },
      },
      async (tx) => {
        const [series] = await tx
          .insert(recurrenceSeries)
          .values({
            clinicId,
            unitId: data.unitId ?? null,
            doctorId: data.doctorId,
            patientId: data.patientId ?? null,
            procedureId: data.procedureId,
            intervalWeeks: data.intervalWeeks,
            occurrences: data.occurrences,
            createdBy: user.userId,
          })
          .returning();

        const created: AppointmentSummary[] = [];
        for (const [index, scheduledAt] of occurrenceDates.entries()) {
          const occurrenceKey = `${idempotencyKey}:occurrence:${index + 1}`;
          created.push(
            await insertScheduledAppointment(tx, {
              clinicId,
              userId: user.userId,
              actorType: 'user',
              correlationId: ctx.correlationId ?? null,
              idempotencyKey: occurrenceKey,
              data: {
                doctorId: data.doctorId,
                patientId: data.patientId ?? null,
                procedureId: data.procedureId,
                unitId: data.unitId ?? null,
                resourceIds: data.resourceIds ?? [],
                scheduledAt: scheduledAt.toISOString(),
                urgencia: data.urgencia ?? false,
                observacoes: data.observacoes,
              },
              scheduledAt,
              recurrence: { seriesId: series!.id, occurrence: index + 1 },
              provenance: { createdVia: 'attendant' },
            }),
          );
        }

        await publishEvent(tx, {
          clinicId,
          eventType: SCHEDULING_EVENTS.RECURRENCE_CREATED,
          payload: {
            seriesId: series!.id,
            clinicId,
            appointmentIds: created.map((appointment) => appointment.id),
            intervalWeeks: data.intervalWeeks,
          },
          idempotencyKey: `${idempotencyKey}:series-created`,
          correlationId: ctx.correlationId ?? null,
        });
        return { seriesId: series!.id, appointments: created };
      },
    );
  } catch (error) {
    return asConflict(error);
  }
}

export async function importAppointmentHistory(
  input: HistoricalAppointmentImportInput,
  idempotencyKey: string,
): Promise<HistoricalAppointmentImportResult> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.IMPORT_AGENDA);
  const data = HistoricalAppointmentImportSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  const now = Date.now();
  if (data.items.some((item) => new Date(item.scheduledAt).getTime() >= now)) {
    throw new SchedulingValidationError(
      'a importacao historica aceita apenas atendimentos passados',
    );
  }

  try {
    return await idempotentMutation(
      {
        idempotency: {
          key: idemKey('appointment_import', idempotencyKey),
          payload: jsonSafe(data),
          ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
        },
        audit: {
          action: SCHEDULING_EVENTS.IMPORT_COMPLETED,
          resourceType: 'appointment_import_batch',
          resourceId: null,
          before: null,
          requestContext: ctx,
        },
      },
      async (tx) => {
        const [batch] = await tx
          .insert(appointmentImportBatches)
          .values({
            clinicId,
            source: data.source,
            justification: data.justification,
            totalItems: data.items.length,
            createdBy: user.userId,
          })
          .returning({ id: appointmentImportBatches.id });

        const appointmentIds: string[] = [];
        for (const [index, item] of data.items.entries()) {
          const appointment = await insertScheduledAppointment(tx, {
            clinicId,
            userId: user.userId,
            actorType: 'user',
            correlationId: ctx.correlationId ?? null,
            idempotencyKey: `${idempotencyKey}:item:${index + 1}`,
            data: item,
            scheduledAt: new Date(item.scheduledAt),
            provenance: {
              createdVia: 'import',
              initialStatus: item.historicalStatus,
              importBatchId: batch!.id,
              ...(item.externalReference ? { importSourceReference: item.externalReference } : {}),
            },
          });
          appointmentIds.push(appointment.id);
        }

        await tx
          .update(appointmentImportBatches)
          .set({
            status: 'completed',
            importedItems: appointmentIds.length,
            completedAt: sql`now()`,
          })
          .where(
            and(
              eq(appointmentImportBatches.id, batch!.id),
              eq(appointmentImportBatches.clinicId, clinicId),
            ),
          );
        await publishEvent(tx, {
          clinicId,
          eventType: SCHEDULING_EVENTS.IMPORT_COMPLETED,
          payload: {
            batchId: batch!.id,
            clinicId,
            source: data.source,
            importedAppointments: appointmentIds.length,
          },
          idempotencyKey: `${idempotencyKey}:import_completed`,
          correlationId: ctx.correlationId ?? null,
        });
        return {
          batchId: batch!.id,
          importedAppointments: appointmentIds.length,
          appointmentIds,
        };
      },
    );
  } catch (error) {
    return asConflict(error);
  }
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
        idempotency: {
          key: idemKey('walkin', idempotencyKey),
          payload: jsonSafe(data),
          ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
        },
        audit: {
          action: SCHEDULING_EVENTS.CREATED,
          resourceType: 'appointment',
          resourceId: null,
          before: null,
          requestContext: ctx,
        },
      },
      async (tx) => {
        if (data.patientId) await assertPatientInClinic(tx, clinicId, data.patientId);
        const snap = await buildSnapshot(tx, clinicId, data.procedureId, data.doctorId);
        await assertWalkInOperationalCapacity(tx, {
          clinicId,
          doctorId: data.doctorId,
          unitId: data.unitId ?? null,
          requestedDurationMinutes: snap.duracaoMin,
        });
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

        await reserveAppointmentResources(tx, row!, data.resourceIds ?? []);
        await enqueueWaitingAppointment(tx, row!, user.userId);

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

// --- recoverAppointment (fluxo excepcional, separado da state machine) -----

export async function recoverAppointment(
  input: RecoverAppointmentInput,
  idempotencyKey: string,
): Promise<AppointmentSummary> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.EDIT_AGENDA);
  const data = RecoverAppointmentSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  const before = await getAppointmentOrThrow(clinicId, data.appointmentId);

  try {
    return await idempotentMutation(
      {
        idempotency: {
          key: idemKey('recover', idempotencyKey),
          payload: jsonSafe(data),
          ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
        },
        audit: {
          action: SCHEDULING_EVENTS.CORRECTED,
          resourceType: 'appointment',
          resourceId: data.appointmentId,
          before,
          requestContext: ctx,
        },
      },
      async (tx) => {
        const [appointment] = await tx
          .select()
          .from(appointments)
          .where(and(eq(appointments.id, data.appointmentId), eq(appointments.clinicId, clinicId)))
          .for('update')
          .limit(1);
        if (!appointment) {
          throw new SchedulingValidationError(`appointment nao encontrado: ${data.appointmentId}`);
        }

        const decision = decideAppointmentRecovery(appointment.status, data.kind);
        if (decision.requiresNewDoctor) {
          if (data.newDoctorId === appointment.doctorId) {
            throw new SchedulingValidationError('novo profissional deve ser diferente do atual');
          }
          await buildSnapshot(tx, clinicId, appointment.procedureId, data.newDoctorId!);
        }

        await tx.insert(appointmentCorrections).values({
          clinicId,
          appointmentId: appointment.id,
          kind: data.kind,
          fromStatus: appointment.status,
          toStatus: decision.target,
          oldDoctorId: appointment.doctorId,
          newDoctorId: data.newDoctorId ?? null,
          reason: data.reason,
          correctedBy: user.userId,
        });

        if (appointment.status !== decision.target) {
          await logAppointmentStateChange(tx, {
            clinicId,
            appointmentId: appointment.id,
            fromStatus: appointment.status,
            toStatus: decision.target,
            transitionedBy: user.userId,
            actorType: 'user',
            reason: `correction:${data.kind}:${data.reason}`,
            sourceIdempotencyKey: idempotencyKey,
            correlationId: ctx.correlationId ?? null,
          });
        }

        const [updated] = await tx
          .update(appointments)
          .set({
            status: decision.target,
            ...(data.newDoctorId ? { doctorId: data.newDoctorId } : {}),
            updatedAt: sql`now()`,
          })
          .where(and(eq(appointments.id, appointment.id), eq(appointments.clinicId, clinicId)))
          .returning();

        if (decision.target === 'cancelado' || decision.target === 'faltou') {
          await setAppointmentResourceReservationsActive(tx, appointment.id, clinicId, false);
        } else if (appointment.status === 'cancelado' || appointment.status === 'faltou') {
          await setAppointmentResourceReservationsActive(tx, appointment.id, clinicId, true);
        }
        await syncWaitingQueueStatus(tx, updated!, decision.target, user.userId);

        await publishEvent(tx, {
          clinicId,
          eventType: SCHEDULING_EVENTS.CORRECTED,
          payload: {
            appointmentId: appointment.id,
            clinicId,
            kind: data.kind,
            fromStatus: appointment.status,
            toStatus: decision.target,
            oldDoctorId: appointment.doctorId,
            newDoctorId: data.newDoctorId ?? null,
            reason: data.reason,
          },
          idempotencyKey: `${idempotencyKey}:corrected`,
          correlationId: ctx.correlationId ?? null,
        });

        return toAppointmentSummary(updated!);
      },
    );
  } catch (error) {
    return asConflict(error);
  }
}

// --- createDoctorAbsence (reorganizacao atomica da agenda futura) ----------

export async function createDoctorAbsence(
  input: CreateDoctorAbsenceInput,
  idempotencyKey: string,
): Promise<DoctorAbsenceResult> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_AVAILABILITY);
  const data = CreateDoctorAbsenceSchema.parse(input);
  // AUTHZ-007 — o gate anterior parava aqui e `assertActiveDoctorInClinic`
  // apenas confirmava que o alvo era da clínica. Um médico com
  // `manage:availability` registrava ausência do OWNER e, em janela ocupada,
  // este mesmo fluxo cancelaria ou transferiria TODAS as consultas
  // agendadas/confirmadas dele, atomicamente e publicando eventos.
  // Ausência dos outros é ato administrativo, não gestão da própria agenda.
  await assertCanManageDoctorSchedule(user, data.doctorId);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  const startsAt = new Date(data.startsAt);
  const endsAt = new Date(data.endsAt);

  try {
    return await idempotentMutation(
      {
        idempotency: {
          key: idemKey('doctor_absence', idempotencyKey),
          payload: jsonSafe(data),
          ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
        },
        audit: {
          action: SCHEDULING_EVENTS.DOCTOR_ABSENCE_CREATED,
          resourceType: 'doctor_absence',
          resourceId: null,
          before: null,
          requestContext: ctx,
        },
      },
      async (tx) => {
        await assertActiveDoctorInClinic(tx, clinicId, data.doctorId);
        if (data.replacementDoctorId) {
          if (data.replacementDoctorId === data.doctorId) {
            throw new SchedulingValidationError('profissional substituto deve ser diferente');
          }
          await assertActiveDoctorInClinic(tx, clinicId, data.replacementDoctorId);
        }

        const affected = await tx
          .select()
          .from(appointments)
          .where(
            and(
              eq(appointments.clinicId, clinicId),
              eq(appointments.doctorId, data.doctorId),
              inArray(appointments.status, ['agendado', 'confirmado']),
              gte(appointments.scheduledAt, startsAt),
              lt(appointments.scheduledAt, endsAt),
            ),
          )
          .for('update');

        const [absence] = await tx
          .insert(doctorAbsences)
          .values({
            clinicId,
            doctorId: data.doctorId,
            startsAt,
            endsAt,
            reason: data.reason,
            strategy: data.strategy,
            replacementDoctorId: data.replacementDoctorId ?? null,
            affectedAppointments: affected.length,
            createdBy: user.userId,
          })
          .returning();

        let cancelled = 0;
        let transferred = 0;
        for (const appointment of affected) {
          if (data.strategy === 'cancel') {
            assertTransition(appointment.status, 'cancelado');
            await logAppointmentStateChange(tx, {
              clinicId,
              appointmentId: appointment.id,
              fromStatus: appointment.status,
              toStatus: 'cancelado',
              transitionedBy: user.userId,
              actorType: 'user',
              reason: `doctor_absence:${data.reason}`,
              sourceIdempotencyKey: idempotencyKey,
              correlationId: ctx.correlationId ?? null,
            });
            await tx
              .update(appointments)
              .set({ status: 'cancelado', updatedAt: sql`now()` })
              .where(and(eq(appointments.id, appointment.id), eq(appointments.clinicId, clinicId)));
            await setAppointmentResourceReservationsActive(tx, appointment.id, clinicId, false);
            await publishEvent(tx, {
              clinicId,
              eventType: SCHEDULING_EVENTS.CANCELLED,
              payload: {
                appointmentId: appointment.id,
                clinicId,
                fromStatus: appointment.status,
                toStatus: 'cancelado',
                cancelReason: 'doctor_absence',
                reason: data.reason,
              },
              idempotencyKey: `${idempotencyKey}:${appointment.id}:cancelled`,
              correlationId: ctx.correlationId ?? null,
            });
            cancelled += 1;
            continue;
          }

          await tx.insert(appointmentCorrections).values({
            clinicId,
            appointmentId: appointment.id,
            kind: 'transfer',
            fromStatus: appointment.status,
            toStatus: appointment.status,
            oldDoctorId: appointment.doctorId,
            newDoctorId: data.replacementDoctorId!,
            reason: data.reason,
            correctedBy: user.userId,
            doctorAbsenceId: absence!.id,
          });
          await tx
            .update(appointments)
            .set({ doctorId: data.replacementDoctorId!, updatedAt: sql`now()` })
            .where(and(eq(appointments.id, appointment.id), eq(appointments.clinicId, clinicId)));
          await publishEvent(tx, {
            clinicId,
            eventType: SCHEDULING_EVENTS.CORRECTED,
            payload: {
              appointmentId: appointment.id,
              clinicId,
              kind: 'transfer',
              fromStatus: appointment.status,
              toStatus: appointment.status,
              oldDoctorId: appointment.doctorId,
              newDoctorId: data.replacementDoctorId!,
              reason: data.reason,
            },
            idempotencyKey: `${idempotencyKey}:${appointment.id}:transferred`,
            correlationId: ctx.correlationId ?? null,
          });
          transferred += 1;
        }

        await publishEvent(tx, {
          clinicId,
          eventType: SCHEDULING_EVENTS.DOCTOR_ABSENCE_CREATED,
          payload: {
            absenceId: absence!.id,
            clinicId,
            doctorId: data.doctorId,
            replacementDoctorId: data.replacementDoctorId ?? null,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            strategy: data.strategy,
            affectedAppointments: affected.length,
          },
          idempotencyKey: `${idempotencyKey}:absence-created`,
          correlationId: ctx.correlationId ?? null,
        });

        return { id: absence!.id, affected: affected.length, cancelled, transferred };
      },
    );
  } catch (error) {
    return asConflict(error);
  }
}

export async function cancelRecurringSeries(
  seriesId: string,
  reason: string,
  idempotencyKey: string,
): Promise<{ seriesId: string; cancelledAppointments: number }> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.EDIT_AGENDA);
  const normalizedReason = reason.trim();
  if (!normalizedReason || normalizedReason.length > 500) {
    throw new SchedulingValidationError('motivo obrigatório com até 500 caracteres');
  }
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('recurrence_cancel', idempotencyKey),
        payload: jsonSafe({ seriesId, reason: normalizedReason }),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: SCHEDULING_EVENTS.RECURRENCE_CANCELLED,
        resourceType: 'recurrence_series',
        resourceId: seriesId,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [series] = await tx
        .select()
        .from(recurrenceSeries)
        .where(and(eq(recurrenceSeries.id, seriesId), eq(recurrenceSeries.clinicId, clinicId)))
        .for('update')
        .limit(1);
      if (!series) throw new SchedulingValidationError('recorrência não encontrada');
      if (series.status !== 'active') {
        throw new SchedulingValidationError('recorrência não está ativa');
      }
      const future = await tx
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.clinicId, clinicId),
            eq(appointments.recurrenceSeriesId, seriesId),
            inArray(appointments.status, ['agendado', 'confirmado']),
            gte(appointments.scheduledAt, new Date()),
          ),
        )
        .for('update');

      for (const appointment of future) {
        await applyTransition(tx, {
          clinicId,
          appointmentId: appointment.id,
          target: 'cancelado',
          transitionedBy: user.userId,
          actorType: 'user',
          reason: `recurrence_cancel:${normalizedReason}`,
          cancelReason: 'user',
          clientKey: `${idempotencyKey}:${appointment.id}`,
          correlationId: ctx.correlationId ?? null,
        });
      }
      await tx
        .update(recurrenceSeries)
        .set({
          status: 'cancelled',
          cancelledBy: user.userId,
          cancelledAt: sql`now()`,
          cancelReason: normalizedReason,
          updatedAt: sql`now()`,
        })
        .where(and(eq(recurrenceSeries.id, seriesId), eq(recurrenceSeries.clinicId, clinicId)));
      await publishEvent(tx, {
        clinicId,
        eventType: SCHEDULING_EVENTS.RECURRENCE_CANCELLED,
        payload: {
          seriesId,
          clinicId,
          cancelledAppointments: future.length,
          reason: normalizedReason,
        },
        idempotencyKey: `${idempotencyKey}:series-cancelled`,
        correlationId: ctx.correlationId ?? null,
      });
      return { seriesId, cancelledAppointments: future.length };
    },
  );
}

function waitlistDto(row: typeof waitlistEntries.$inferSelect): WaitlistEntryDTO {
  return {
    id: row.id,
    patientId: row.patientId,
    doctorId: row.doctorId ?? null,
    procedureId: row.procedureId,
    priority: row.priority,
    status: row.status,
    preferredFrom: row.preferredFrom?.toISOString() ?? null,
    preferredUntil: row.preferredUntil?.toISOString() ?? null,
    offeredAppointmentId: row.offeredAppointmentId ?? null,
    bookedAppointmentId: row.bookedAppointmentId ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createWaitlistEntry(
  input: CreateWaitlistEntryInput,
  idempotencyKey: string,
): Promise<WaitlistEntryDTO> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.EDIT_AGENDA);
  const data = CreateWaitlistEntrySchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('waitlist_create', idempotencyKey),
        payload: jsonSafe(data),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'scheduling.waitlist.created',
        resourceType: 'waitlist_entry',
        resourceId: null,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      await assertPatientInClinic(tx, clinicId, data.patientId);
      if (data.doctorId) {
        await buildSnapshot(tx, clinicId, data.procedureId, data.doctorId);
      } else {
        const [procedure] = await tx
          .select({ id: procedures.id })
          .from(procedures)
          .where(
            and(
              eq(procedures.id, data.procedureId),
              eq(procedures.clinicId, clinicId),
              eq(procedures.ativo, true),
            ),
          )
          .limit(1);
        if (!procedure) throw new SchedulingValidationError('procedimento inválido');
      }
      const [row] = await tx
        .insert(waitlistEntries)
        .values({
          clinicId,
          patientId: data.patientId,
          doctorId: data.doctorId ?? null,
          procedureId: data.procedureId,
          priority: data.priority ?? 'normal',
          preferredFrom: data.preferredFrom ? new Date(data.preferredFrom) : null,
          preferredUntil: data.preferredUntil ? new Date(data.preferredUntil) : null,
          notes: data.notes ?? null,
          createdBy: user.userId,
        })
        .returning();
      return waitlistDto(row!);
    },
  );
}

export async function cancelWaitlistEntry(
  id: string,
  idempotencyKey: string,
): Promise<WaitlistEntryDTO> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.EDIT_AGENDA);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('waitlist_cancel', idempotencyKey),
        payload: jsonSafe({ id }),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'scheduling.waitlist.cancelled',
        resourceType: 'waitlist_entry',
        resourceId: id,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [row] = await tx
        .update(waitlistEntries)
        .set({
          status: 'cancelled',
          cancelledBy: user.userId,
          cancelledAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(waitlistEntries.id, id),
            eq(waitlistEntries.clinicId, clinicId),
            inArray(waitlistEntries.status, ['waiting', 'offered']),
          ),
        )
        .returning();
      if (!row) throw new SchedulingValidationError('entrada da lista não encontrada ou encerrada');
      return waitlistDto(row);
    },
  );
}

export async function markWaitlistEntryBooked(
  id: string,
  appointmentId: string,
  idempotencyKey: string,
): Promise<WaitlistEntryDTO> {
  await requireUser();
  await requireFreshPermission(PERMISSIONS.EDIT_AGENDA);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('waitlist_book', idempotencyKey),
        payload: jsonSafe({ id, appointmentId }),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'scheduling.waitlist.booked',
        resourceType: 'waitlist_entry',
        resourceId: id,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const [entry] = await tx
        .select()
        .from(waitlistEntries)
        .where(and(eq(waitlistEntries.id, id), eq(waitlistEntries.clinicId, clinicId)))
        .for('update')
        .limit(1);
      const [appointment] = await tx
        .select()
        .from(appointments)
        .where(and(eq(appointments.id, appointmentId), eq(appointments.clinicId, clinicId)))
        .limit(1);
      if (
        !entry ||
        !appointment ||
        entry.status === 'cancelled' ||
        entry.patientId !== appointment.patientId ||
        entry.procedureId !== appointment.procedureId
      ) {
        throw new SchedulingValidationError('agendamento não corresponde à entrada da lista');
      }
      const [row] = await tx
        .update(waitlistEntries)
        .set({ status: 'booked', bookedAppointmentId: appointmentId, updatedAt: sql`now()` })
        .where(and(eq(waitlistEntries.id, id), eq(waitlistEntries.clinicId, clinicId)))
        .returning();
      return waitlistDto(row!);
    },
  );
}
