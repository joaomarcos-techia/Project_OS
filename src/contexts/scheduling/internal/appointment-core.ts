/**
 * Scheduling mutation CORES (C12) — single implementation shared by the Server
 * Actions (request actor, actorType='user') and the AI-agent (system actor
 * 'ai_agent'). NÃO é `'use server'`: nunca é chamável pelo cliente. O ator é
 * SEMPRE injetado por código de servidor confiável (a Server Action resolve o
 * usuário do request; schedulingApiV1 injeta o ator de sistema).
 *
 * REGRA (R5, sem bifurcação): a state machine, o snapshot imutável, o
 * anti-conflito (UNIQUE/EXCLUDE), a checagem de passado, a idempotência e os
 * eventos são IDÊNTICOS nos dois caminhos. A única diferença é o ator
 * (actorType no state-log + createdBy/transitionedBy null para a IA).
 *
 * Estas funções foram extraídas verbatim de actions.ts (pipeline congelado C6);
 * os helpers privados (transitionPayload/applyTransition/buildSnapshot/
 * publishCreated) migraram para cá para serem compartilhados.
 */
import { and, eq, sql } from 'drizzle-orm';

import type { RequestContext } from '@/lib/audit/types';
import type { Tx } from '@/lib/db';
import { idempotentMutation, type MutationActor } from '@/lib/idempotency/mutation';
import { publishEvent } from '@/lib/outbox/publish';

import { ProcedureNotFoundError, SchedulingValidationError } from '../errors';
import { SCHEDULING_EVENTS, type CancelReason } from '../events';
import { getAppointmentOrThrow, toAppointmentSummary } from '../queries';
import { appointments, procedures, type AppointmentRow } from '../schema';
import { assertTransition, TRANSITION_EVENT, type AppointmentState } from '../state-machine';
import {
  CreateAppointmentSchema,
  RescheduleSchema,
  type AppointmentSummary,
  type CreateAppointmentInput,
  type RescheduleInput,
} from '../types';
import { asConflict, idemKey, IDEM_TTL, jsonSafe } from './action-helpers';
import { logAppointmentStateChange, type AppointmentActor } from './state-log';

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

export interface TransitionOpts {
  clinicId: string;
  appointmentId: string;
  target: AppointmentState;
  transitionedBy: string | null;
  actorType: AppointmentActor;
  reason?: string | null | undefined;
  cancelReason?: CancelReason | undefined;
  clientKey: string;
  correlationId: string | null;
}

/** Shared transition core: FOR UPDATE → assert → log → update → publish. */
export async function applyTransition(tx: Tx, o: TransitionOpts): Promise<AppointmentSummary> {
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
    actorType: o.actorType,
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

interface Snapshot {
  nome: string;
  codigo: string;
  categoria: string | null;
  valorPadrao: string; // numeric string
  duracaoMin: number;
  doctorNome: string;
}

/** Reads procedure (ativo) + doctor name; builds the immutable snapshot. */
export async function buildSnapshot(
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

  // F-05 (auditoria 2026-06-10): exige role='doctor', ativo e não soft-deletado.
  const docRows = await tx.execute<{ nome: string }>(
    sql`SELECT nome FROM profiles
         WHERE id = ${doctorId}
           AND role = 'doctor'
           AND ativo = true
           AND deleted_at IS NULL
         LIMIT 1`,
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

export async function publishCreated(
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

// --- CORES (ator injetado) --------------------------------------------------

/** createAppointment core: validação + idempotência + snapshot + evento. */
export async function createAppointmentCore(
  actor: MutationActor,
  actorType: AppointmentActor,
  requestContext: RequestContext,
  input: CreateAppointmentInput,
  idempotencyKey: string,
): Promise<AppointmentSummary> {
  const { clinicId, userId } = actor;
  const data = CreateAppointmentSchema.parse(input);

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
          requestContext,
        },
        actor,
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
            createdBy: userId,
          })
          .returning();

        await logAppointmentStateChange(tx, {
          clinicId,
          appointmentId: row!.id,
          fromStatus: null,
          toStatus: 'agendado',
          transitionedBy: userId,
          actorType,
          sourceIdempotencyKey: idempotencyKey,
          correlationId: requestContext.correlationId ?? null,
        });

        await publishCreated(tx, row!, idempotencyKey, requestContext.correlationId ?? null);
        return toAppointmentSummary(row!);
      },
    );
  } catch (err) {
    return asConflict(err);
  }
}

/** Single-target transition core (confirm/cancel/...). */
export async function transitionCore(
  actor: MutationActor,
  actorType: AppointmentActor,
  requestContext: RequestContext,
  params: {
    action: string;
    target: AppointmentState;
    eventName: string;
    cancelReason?: CancelReason | undefined;
    id: string;
    reason?: string | undefined;
  },
  idempotencyKey: string,
): Promise<AppointmentSummary> {
  const { clinicId, userId } = actor;
  const before = await getAppointmentOrThrow(clinicId, params.id);

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey(params.action, idempotencyKey),
        payload: jsonSafe({ id: params.id, reason: params.reason ?? null }),
        ttlSeconds: IDEM_TTL,
      },
      audit: {
        action: params.eventName,
        resourceType: 'appointment',
        resourceId: params.id,
        before,
        requestContext,
      },
      actor,
    },
    (tx) =>
      applyTransition(tx, {
        clinicId,
        appointmentId: params.id,
        target: params.target,
        transitionedBy: userId,
        actorType,
        reason: params.reason ?? null,
        cancelReason: params.cancelReason,
        clientKey: idempotencyKey,
        correlationId: requestContext.correlationId ?? null,
      }),
  );
}

/** reschedule core (= cancel + create na mesma TX; preserva preço — M3). */
export async function rescheduleCore(
  actor: MutationActor,
  actorType: AppointmentActor,
  requestContext: RequestContext,
  id: string,
  input: RescheduleInput,
  idempotencyKey: string,
): Promise<AppointmentSummary> {
  const { clinicId, userId } = actor;
  const data = RescheduleSchema.parse(input);
  const before = await getAppointmentOrThrow(clinicId, id);

  const newScheduledAt = new Date(data.newScheduledAt);
  if (newScheduledAt.getTime() < Date.now()) {
    throw new SchedulingValidationError('não é permitido reagendar para o passado');
  }
  const correlationId = requestContext.correlationId ?? null;

  try {
    return await idempotentMutation(
      {
        idempotency: { key: idemKey('reschedule', idempotencyKey), payload: jsonSafe({ id, data }), ttlSeconds: IDEM_TTL },
        audit: {
          action: SCHEDULING_EVENTS.RESCHEDULED,
          resourceType: 'appointment',
          resourceId: id,
          before,
          requestContext,
        },
        actor,
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
          transitionedBy: userId,
          actorType,
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
            createdBy: userId,
            rescheduledFromAppointmentId: old.id,
          })
          .returning();

        await logAppointmentStateChange(tx, {
          clinicId,
          appointmentId: created!.id,
          fromStatus: null,
          toStatus: 'agendado',
          transitionedBy: userId,
          actorType,
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
