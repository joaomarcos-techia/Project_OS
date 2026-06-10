'use server';

/**
 * Scheduling appointment-lifecycle Server Actions (C6). Frozen pipeline (C5):
 *
 *   requireUser → requireFreshPermission → Zod → idempotentMutation(
 *     { idempotency, audit }, async (tx) => {
 *       SELECT … FOR UPDATE        // R13 — serializa transições concorrentes
 *       assertTransition(…)         // REGRA 3 — única porta de status
 *       logAppointmentStateChange   // forense (actor/source/correlation)
 *       UPDATE status               // ou INSERT na criação
 *       publishEvent(tx, …)         // MESMA tx
 *       return AppointmentSummary
 *     })
 *
 * Snapshot é gravado na criação e IMUTÁVEL (trigger). Procedure NUNCA deletado
 * (FK RESTRICT). Conflito (UNIQUE 23505 / EXCLUDE 23P01) → SchedulingConflictError.
 */
import { and, eq, sql } from 'drizzle-orm';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';
import { idempotentMutation } from '@/lib/idempotency/mutation';
import { publishEvent } from '@/lib/outbox/publish';
import type { Tx } from '@/lib/db';

import { ProcedureNotFoundError, SchedulingValidationError } from './errors';
import { SCHEDULING_EVENTS, type CancelReason } from './events';
import { getAppointmentOrThrow, toAppointmentSummary } from './queries';
import { appointments, procedures, type AppointmentRow } from './schema';
import {
  assertTransition,
  TRANSITION_EVENT,
  type AppointmentState,
} from './state-machine';
import { asConflict, idemKey, IDEM_TTL, jsonSafe, requestContext } from './internal/action-helpers';
import { logAppointmentStateChange } from './internal/state-log';
import {
  CreateAppointmentSchema,
  CreateWalkInSchema,
  RescheduleSchema,
  type AppointmentSummary,
  type CreateAppointmentInput,
  type CreateWalkInInput,
  type RescheduleInput,
} from './types';

/** Build the outbox payload for a transition INTO `target`. */
function transitionPayload(
  target: AppointmentState,
  appt: AppointmentRow,
  reason: string | null,
  cancelReason: CancelReason,
): { eventType: string; payload: Record<string, unknown> } {
  const eventType = TRANSITION_EVENT[target]!;
  const base = { appointmentId: appt.id, clinicId: appt.clinicId };
  switch (eventType) {
    case SCHEDULING_EVENTS.STARTED:
      return {
        eventType,
        payload: {
          ...base,
          doctorId: appt.doctorId,
          patientId: appt.patientId ?? null,
          procedureId: appt.procedureId,
        },
      };
    case SCHEDULING_EVENTS.COMPLETED:
      return {
        eventType,
        payload: {
          ...base,
          doctorId: appt.doctorId,
          patientId: appt.patientId ?? null,
          procedureId: appt.procedureId,
          unitId: appt.unitId ?? null,
          valor: Number(appt.valor),
          snapshotProcedureName: appt.snapshotProcedureName,
          snapshotDoctorNome: appt.snapshotDoctorNome,
          scheduledAt: (appt.scheduledAt as Date).toISOString(),
        },
      };
    case SCHEDULING_EVENTS.CANCELLED:
      return {
        eventType,
        payload: { ...base, fromStatus: appt.status, toStatus: target, cancelReason, reason },
      };
    case SCHEDULING_EVENTS.NO_SHOW:
      return {
        eventType,
        payload: { ...base, patientId: appt.patientId ?? null, fromStatus: appt.status, toStatus: target },
      };
    default: // CONFIRMED / CHECKED_IN
      return { eventType, payload: { ...base, fromStatus: appt.status, toStatus: target, reason } };
  }
}

interface TransitionOpts {
  clinicId: string;
  appointmentId: string;
  target: AppointmentState;
  transitionedBy: string;
  reason?: string | null | undefined;
  cancelReason?: CancelReason | undefined;
  clientKey: string;
  correlationId: string | null;
}

/** Shared transition core: FOR UPDATE → assert → log → update → publish. */
async function applyTransition(tx: Tx, o: TransitionOpts): Promise<AppointmentSummary> {
  const [appt] = await tx
    .select()
    .from(appointments)
    .where(eq(appointments.id, o.appointmentId))
    .for('update')
    .limit(1);
  if (!appt) throw new SchedulingValidationError(`appointment não encontrado: ${o.appointmentId}`);

  const from = appt.status as AppointmentState;
  assertTransition(from, o.target);

  await logAppointmentStateChange(tx, {
    clinicId: o.clinicId,
    appointmentId: o.appointmentId,
    fromStatus: from,
    toStatus: o.target,
    transitionedBy: o.transitionedBy,
    actorType: 'user',
    reason: o.reason ?? null,
    sourceIdempotencyKey: o.clientKey,
    correlationId: o.correlationId,
  });

  const [updated] = await tx
    .update(appointments)
    .set({ status: o.target, updatedAt: sql`now()` })
    .where(eq(appointments.id, o.appointmentId))
    .returning();

  const { eventType, payload } = transitionPayload(
    o.target,
    appt,
    o.reason ?? null,
    o.cancelReason ?? 'user',
  );
  await publishEvent(tx, {
    clinicId: o.clinicId,
    eventType,
    payload,
    idempotencyKey: `${o.clientKey}:${o.target}`,
    correlationId: o.correlationId,
  });

  return toAppointmentSummary(updated!);
}

/** Factory for the six single-target transition actions. */
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
    const before = await getAppointmentOrThrow(clinicId, id);

    return idempotentMutation(
      {
        idempotency: {
          key: idemKey(action, idempotencyKey),
          payload: jsonSafe({ id, reason: reason ?? null }),
          ttlSeconds: IDEM_TTL,
        },
        audit: {
          action: eventName,
          resourceType: 'appointment',
          resourceId: id,
          before,
          requestContext: ctx,
        },
      },
      (tx) =>
        applyTransition(tx, {
          clinicId,
          appointmentId: id,
          target,
          transitionedBy: user.userId,
          reason: reason ?? null,
          cancelReason,
          clientKey: idempotencyKey,
          correlationId: ctx.correlationId ?? null,
        }),
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
  const data = CreateAppointmentSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();

  const scheduledAt = new Date(data.scheduledAt);
  if (!data.isHistoricalImport && scheduledAt.getTime() < Date.now()) {
    throw new SchedulingValidationError('não é permitido agendar no passado');
  }

  try {
    return await idempotentMutation(
      {
        idempotency: { key: idemKey('create', idempotencyKey), payload: jsonSafe(data), ttlSeconds: IDEM_TTL },
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
        const valor = data.valorAjustado ? data.valor!.toFixed(2) : snap.valorPadrao;

        const [row] = await tx
          .insert(appointments)
          .values({
            clinicId,
            unitId: data.unitId ?? null,
            doctorId: data.doctorId,
            patientId: data.patientId ?? null,
            procedureId: data.procedureId,
            scheduledAt,
            durationMin: snap.duracaoMin,
            status: 'agendado',
            valor,
            valorAjustado: data.valorAjustado ?? false,
            valorAjusteMotivo: data.valorAjustado ? (data.valorAjusteMotivo ?? null) : null,
            snapshotProcedureName: snap.nome,
            snapshotProcedureCodigo: snap.codigo,
            snapshotProcedureCategoria: snap.categoria,
            snapshotProcedureValor: snap.valorPadrao,
            snapshotProcedureDuracaoMin: snap.duracaoMin,
            snapshotDoctorNome: snap.doctorNome,
            createdVia: data.createdVia ?? 'attendant',
            urgencia: data.urgencia ?? false,
            observacoes: data.observacoes ?? null,
            createdBy: user.userId,
          })
          .returning();

        await logAppointmentStateChange(tx, {
          clinicId,
          appointmentId: row!.id,
          fromStatus: null,
          toStatus: 'agendado',
          transitionedBy: user.userId,
          actorType: 'user',
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
  const data = RescheduleSchema.parse(input);
  const clinicId = await requireClinicId();
  const ctx = await requestContext();
  const before = await getAppointmentOrThrow(clinicId, id);

  const newScheduledAt = new Date(data.newScheduledAt);
  if (newScheduledAt.getTime() < Date.now()) {
    throw new SchedulingValidationError('não é permitido reagendar para o passado');
  }
  const correlationId = ctx.correlationId ?? null;

  try {
    return await idempotentMutation(
      {
        idempotency: { key: idemKey('reschedule', idempotencyKey), payload: jsonSafe({ id, data }), ttlSeconds: IDEM_TTL },
        audit: {
          action: SCHEDULING_EVENTS.RESCHEDULED,
          resourceType: 'appointment',
          resourceId: id,
          before,
          requestContext: ctx,
        },
      },
      async (tx) => {
        const [old] = await tx
          .select()
          .from(appointments)
          .where(eq(appointments.id, id))
          .for('update')
          .limit(1);
        if (!old) throw new SchedulingValidationError(`appointment não encontrado: ${id}`);
        assertTransition(old.status as AppointmentState, 'cancelado');

        // 1. cancela o original
        await logAppointmentStateChange(tx, {
          clinicId,
          appointmentId: id,
          fromStatus: old.status as AppointmentState,
          toStatus: 'cancelado',
          transitionedBy: user.userId,
          actorType: 'user',
          reason: data.reason ?? 'reschedule',
          sourceIdempotencyKey: idempotencyKey,
          correlationId,
        });
        await tx
          .update(appointments)
          .set({ status: 'cancelado', updatedAt: sql`now()` })
          .where(eq(appointments.id, id));

        // 2. cria o novo carregando snapshot + valor originais (preserva preço)
        const [created] = await tx
          .insert(appointments)
          .values({
            clinicId,
            unitId: old.unitId,
            doctorId: old.doctorId,
            patientId: old.patientId,
            procedureId: old.procedureId,
            scheduledAt: newScheduledAt,
            durationMin: old.durationMin,
            status: 'agendado',
            valor: old.valor,
            valorAjustado: old.valorAjustado,
            valorAjusteMotivo: old.valorAjusteMotivo,
            snapshotProcedureName: old.snapshotProcedureName,
            snapshotProcedureCodigo: old.snapshotProcedureCodigo,
            snapshotProcedureCategoria: old.snapshotProcedureCategoria,
            snapshotProcedureValor: old.snapshotProcedureValor,
            snapshotProcedureDuracaoMin: old.snapshotProcedureDuracaoMin,
            snapshotDoctorNome: old.snapshotDoctorNome,
            snapshotDoctorCrm: old.snapshotDoctorCrm,
            snapshotDoctorEspecialidade: old.snapshotDoctorEspecialidade,
            createdVia: old.createdVia,
            urgencia: old.urgencia,
            observacoes: old.observacoes,
            createdBy: user.userId,
            rescheduledFromAppointmentId: old.id,
          })
          .returning();

        await logAppointmentStateChange(tx, {
          clinicId,
          appointmentId: created!.id,
          fromStatus: null,
          toStatus: 'agendado',
          transitionedBy: user.userId,
          actorType: 'user',
          reason: 'reschedule',
          sourceIdempotencyKey: idempotencyKey,
          correlationId,
        });

        await publishEvent(tx, {
          clinicId,
          eventType: SCHEDULING_EVENTS.CANCELLED,
          payload: {
            appointmentId: old.id,
            clinicId,
            fromStatus: old.status,
            toStatus: 'cancelado',
            cancelReason: 'reschedule' as const,
            reason: data.reason ?? null,
          },
          idempotencyKey: `${idempotencyKey}:cancelled`,
          correlationId,
        });
        await publishEvent(tx, {
          clinicId,
          eventType: SCHEDULING_EVENTS.RESCHEDULED,
          payload: {
            oldAppointmentId: old.id,
            newAppointmentId: created!.id,
            clinicId,
            scheduledAt: newScheduledAt.toISOString(),
          },
          idempotencyKey: `${idempotencyKey}:rescheduled`,
          correlationId,
        });

        return toAppointmentSummary(created!);
      },
    );
  } catch (err) {
    return asConflict(err);
  }
}

// --- internal helpers ------------------------------------------------------

interface Snapshot {
  nome: string;
  codigo: string;
  categoria: string | null;
  valorPadrao: string; // numeric string
  duracaoMin: number;
  doctorNome: string;
}

/** Reads procedure (ativo) + doctor name; builds the immutable snapshot. */
async function buildSnapshot(
  tx: Tx,
  clinicId: string,
  procedureId: string,
  doctorId: string,
): Promise<Snapshot> {
  const [proc] = await tx
    .select()
    .from(procedures)
    .where(and(eq(procedures.clinicId, clinicId), eq(procedures.id, procedureId), eq(procedures.ativo, true)))
    .limit(1);
  if (!proc) throw new ProcedureNotFoundError(procedureId);

  // doctor nome via raw SQL (RLS scopes to clinic) — evita import cross-context.
  const docRows = await tx.execute<{ nome: string }>(
    sql`SELECT nome FROM profiles WHERE id = ${doctorId} LIMIT 1`,
  );
  const doctorNome = docRows[0]?.nome;
  if (!doctorNome) throw new SchedulingValidationError('médico inválido para esta clínica');

  return {
    nome: proc.descricao,
    codigo: proc.codigo,
    categoria: proc.categoria ?? null,
    valorPadrao: proc.valorPadrao,
    duracaoMin: proc.duracaoPadraoMin,
    doctorNome,
  };
}

async function publishCreated(
  tx: Tx,
  row: AppointmentRow,
  clientKey: string,
  correlationId: string | null,
): Promise<void> {
  await publishEvent(tx, {
    clinicId: row.clinicId,
    eventType: SCHEDULING_EVENTS.CREATED,
    payload: {
      appointmentId: row.id,
      clinicId: row.clinicId,
      doctorId: row.doctorId,
      patientId: row.patientId ?? null,
      procedureId: row.procedureId,
      scheduledAt: (row.scheduledAt as Date).toISOString(),
      durationMin: row.durationMin,
      valor: Number(row.valor),
      snapshotProcedureName: row.snapshotProcedureName,
      snapshotProcedureCodigo: row.snapshotProcedureCodigo ?? null,
      snapshotProcedureCategoria: row.snapshotProcedureCategoria ?? null,
      snapshotProcedureValor: Number(row.snapshotProcedureValor),
      snapshotProcedureDuracaoMin: row.snapshotProcedureDuracaoMin,
      snapshotDoctorNome: row.snapshotDoctorNome,
      createdVia: row.createdVia,
      urgencia: row.urgencia,
    },
    idempotencyKey: `${clientKey}:created`,
    correlationId,
  });
}
