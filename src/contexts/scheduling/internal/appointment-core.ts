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
import { and, eq, inArray, sql } from 'drizzle-orm';

/* eslint-disable boundaries/element-types -- profiles é declarado no schema de identity (Drizzle FK vive onde a tabela é declarada); leitura tenant-scoped via tx (RLS aplica). Mesma exceção de clinical/internal/doctor.ts e tenant-context.ts. */
import { profiles } from '@/contexts/identity/schema';
/* eslint-enable boundaries/element-types */

import type { RequestContext } from '@/lib/audit/types';
import { practitionerSql } from '@/lib/auth/practitioner';
import type { Tx } from '@/lib/db';
import { idempotentMutation, type MutationActor } from '@/lib/idempotency/mutation';
import { MUTATION_IDEM_TTL_SECONDS } from '@/lib/idempotency/ttl';
import { publishEvent } from '@/lib/outbox/publish';

import { ProcedureNotFoundError, SchedulingValidationError } from '../errors';
import { SCHEDULING_EVENTS, type CancelReason, type CreatedVia } from '../events';
import { getAppointmentOrThrow, toAppointmentSummary } from '../queries';
import {
  appointmentResourceReservations,
  appointments,
  procedures,
  schedulableResources,
  type AppointmentRow,
} from '../schema';
import { assertTransition, TRANSITION_EVENT, type AppointmentState } from '../state-machine';
import {
  CreateAppointmentSchema,
  RescheduleSchema,
  type AppointmentSummary,
  type CreateAppointmentInput,
  type CreateWalkInInput,
  type RescheduleInput,
} from '../types';
import { asConflict, idemKey, jsonSafe } from './action-helpers';
import { assertClinicalRecordReady } from './clinical-completion';
import { assertUnitInClinic } from './tenant-references';
import { logAppointmentStateChange, type AppointmentActor } from './state-log';
import { syncWaitingQueueStatus } from './waiting-queue-store';
import { offerWaitlistForCancelledAppointment } from './waitlist-store';

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
          // Lida da linha travada nesta transação: o Financeiro decide por ela.
          billingMode: appt.billingMode,
        },
      };
    case SCHEDULING_EVENTS.CANCELLED:
      return {
        eventType,
        payload: {
          ...base,
          fromStatus: appt.status,
          toStatus: target,
          cancelReason,
          reason,
          // ADR-049 1.5: quem julga a janela de estorno é o Payments, no worker.
          // O instante do cancelamento tem de viajar com o evento.
          cancelledAt: new Date().toISOString(),
        },
      };
    case SCHEDULING_EVENTS.NO_SHOW:
      return {
        eventType,
        payload: {
          ...base,
          patientId: appt.patientId ?? null,
          fromStatus: appt.status,
          toStatus: target,
          noShowAt: new Date().toISOString(),
        },
      };
    default: // CONFIRMED / CHECKED_IN
      return { eventType, payload: { ...base, fromStatus: appt.status, toStatus: target, reason } };
  }
}

export async function reserveAppointmentResources(
  tx: Tx,
  appointment: AppointmentRow,
  resourceIds: readonly string[],
): Promise<void> {
  const uniqueIds = [...new Set(resourceIds)];
  if (uniqueIds.length === 0) return;
  const rows = await tx
    .select({ id: schedulableResources.id, unitId: schedulableResources.unitId })
    .from(schedulableResources)
    .where(
      and(
        eq(schedulableResources.clinicId, appointment.clinicId),
        eq(schedulableResources.active, true),
        inArray(schedulableResources.id, uniqueIds),
      ),
    );
  if (rows.length !== uniqueIds.length) {
    throw new SchedulingValidationError('recurso invalido ou inativo para esta clinica');
  }
  if (rows.some((row) => row.unitId && row.unitId !== appointment.unitId)) {
    throw new SchedulingValidationError('recurso pertence a outra unidade');
  }
  const startsAt = appointment.scheduledAt as Date;
  const endsAt = new Date(startsAt.getTime() + appointment.durationMin * 60_000);
  await tx.insert(appointmentResourceReservations).values(
    uniqueIds.map((resourceId) => ({
      clinicId: appointment.clinicId,
      appointmentId: appointment.id,
      resourceId,
      startsAt,
      endsAt,
    })),
  );
}

export async function setAppointmentResourceReservationsActive(
  tx: Tx,
  appointmentId: string,
  clinicId: string,
  active: boolean,
): Promise<void> {
  await tx
    .update(appointmentResourceReservations)
    .set({ active })
    .where(
      and(
        eq(appointmentResourceReservations.appointmentId, appointmentId),
        eq(appointmentResourceReservations.clinicId, clinicId),
      ),
    );
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
    .where(and(eq(appointments.id, o.appointmentId), eq(appointments.clinicId, o.clinicId)))
    .for('update')
    .limit(1);
  if (!appt) throw new SchedulingValidationError(`appointment não encontrado: ${o.appointmentId}`);

  const from = appt.status as AppointmentState;
  assertTransition(from, o.target);

  // AUTHZ-008 — a invariante clínica roda AQUI, depois do `FOR UPDATE` e antes
  // de qualquer escrita: sob o mesmo lock ela fecha a corrida com o worker
  // atrasado, impede o state log de nascer e — porque o evento é publicado
  // nesta mesma transação — impede o lançamento financeiro automático.
  // Walk-in (sem `patientId`) segue fora: não há prontuário a exigir.
  if (o.target === 'atendido' && appt.patientId) {
    await assertClinicalRecordReady(tx, o.clinicId, o.appointmentId);
  }

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
    .where(and(eq(appointments.id, o.appointmentId), eq(appointments.clinicId, o.clinicId)))
    .returning();

  if (o.target === 'cancelado' || o.target === 'faltou') {
    await setAppointmentResourceReservationsActive(tx, o.appointmentId, o.clinicId, false);
  }
  await syncWaitingQueueStatus(tx, appt, o.target, o.transitionedBy);
  if (o.target === 'cancelado') {
    await offerWaitlistForCancelledAppointment(tx, appt, {
      idempotencyKey: o.clientKey,
      correlationId: o.correlationId,
    });
  }

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
  // Convênio concluído: evento próprio para a guia automática (mesma transação,
  // mesma chave de origem). O `completed` acima segue para o Financeiro, que não
  // cria recebível cheio para convênio.
  if (
    eventType === SCHEDULING_EVENTS.COMPLETED &&
    appt.billingMode === 'convenio' &&
    appt.patientId
  ) {
    await publishEvent(tx, {
      clinicId: o.clinicId,
      eventType: SCHEDULING_EVENTS.INSURANCE_COMPLETED,
      payload: {
        appointmentId: appt.id,
        clinicId: appt.clinicId,
        patientId: appt.patientId,
        doctorId: appt.doctorId,
        procedureId: appt.procedureId,
        scheduledAt: (appt.scheduledAt as Date).toISOString(),
      },
      idempotencyKey: `${o.clientKey}:${o.target}:convenio`,
      correlationId: o.correlationId,
    });
  }

  return toAppointmentSummary(updated!);
}

/**
 * R1 (gap S1) — garante que o paciente pertence à clínica ANTES de vinculá-lo a
 * um atendimento. `patient_id` é só FK para `patients(id)` e a checagem de FK do
 * Postgres IGNORA RLS; sem isto, um `patientId` forjado de OUTRA clínica poderia
 * ser vinculado passando direto pela criação. A query roda sob `withTenant`
 * (idempotentMutation), então a RLS de `patients` já isola por tenant — o filtro
 * `clinic_id` explícito é defesa em profundidade (espelha buildSnapshot). Vive no
 * CORE para cobrir TODOS os chamadores (Server Action, walk-in e AI Agent), não
 * só a UI da Agenda.
 */
export async function assertPatientInClinic(
  tx: Tx,
  clinicId: string,
  patientId: string,
): Promise<void> {
  const rows = await tx.execute<{ ok: number }>(
    sql`SELECT 1 AS ok FROM patients
         WHERE id = ${patientId}
           AND clinic_id = ${clinicId}
           AND deleted_at IS NULL
           AND obito_em IS NULL
         LIMIT 1`,
  );
  if (!rows[0]) throw new SchedulingValidationError('paciente inválido para esta clínica');
}

interface Snapshot {
  nome: string;
  codigo: string;
  categoria: string | null;
  valorPadrao: string; // numeric string
  duracaoMin: number;
  doctorNome: string;
}

export async function assertActiveDoctorInClinic(
  tx: Tx,
  clinicId: string,
  doctorId: string,
): Promise<string> {
  const docRows = await tx.execute<{ nome: string }>(
    sql`SELECT nome FROM profiles
         WHERE id = ${doctorId}
           AND clinic_id = ${clinicId}
           AND ${practitionerSql(profiles.role, profiles.crm)}
           AND ativo = true
           AND deleted_at IS NULL
           AND invite_accepted_at IS NOT NULL
         LIMIT 1`,
  );
  const doctorNome = docRows[0]?.nome;
  if (!doctorNome) throw new SchedulingValidationError('médico inválido para esta clínica');
  return doctorNome;
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
    .where(
      and(
        eq(procedures.clinicId, clinicId),
        eq(procedures.id, procedureId),
        eq(procedures.ativo, true),
      ),
    )
    .limit(1);
  if (!proc) throw new ProcedureNotFoundError(procedureId);

  // F-05 (auditoria 2026-06-10): exige practitioner (role='doctor' OU CRM — ADR-032 §2), ativo e não soft-deletado.
  // + invite_accepted_at IS NOT NULL: um convite PENDENTE (nunca aceito) não é um
  // médico agendável — senão dá pra marcar com quem ainda não entrou no sistema
  // (bug reportado: convite antigo virava "médico" e o agente de IA agendaria nele).
  const doctorNome = await assertActiveDoctorInClinic(tx, clinicId, doctorId);

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
  row: Pick<
    AppointmentRow,
    | 'id'
    | 'clinicId'
    | 'doctorId'
    | 'patientId'
    | 'procedureId'
    | 'scheduledAt'
    | 'durationMin'
    | 'valor'
    | 'snapshotProcedureName'
    | 'snapshotProcedureCodigo'
    | 'snapshotProcedureCategoria'
    | 'snapshotProcedureValor'
    | 'snapshotProcedureDuracaoMin'
    | 'snapshotDoctorNome'
    | 'createdVia'
    | 'urgencia'
  >,
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
  if (row.createdVia === 'ai_agent') {
    // O worker detached consulta novamente a agenda antes de chamar o Asaas.
    // O scan periódico continua como backstop se a entrega deste evento atrasar.
    await publishEvent(tx, {
      clinicId: row.clinicId,
      eventType: SCHEDULING_EVENTS.DEPOSIT_REQUESTED,
      payload: { clinicId: row.clinicId, appointmentId: row.id },
      idempotencyKey: `${clientKey}:deposit_requested`,
      correlationId,
    });
  }
}

export async function assertCommercialPriceInput(
  _tx: Tx,
  _clinicId: string,
  data: CreateAppointmentInput | CreateWalkInInput,
): Promise<void> {
  if (
    (data.pricingPolicyMode != null && data.pricingPolicyMode !== 'absorb_fees') ||
    data.commercialPaymentMethod != null ||
    data.commercialInstallmentCount != null ||
    data.commercialPriceId != null
  ) {
    throw new SchedulingValidationError('Preço por meio de pagamento não está mais disponível.');
  }
}

export async function insertScheduledAppointment(
  tx: Tx,
  input: {
    clinicId: string;
    userId: string | null;
    actorType: AppointmentActor;
    correlationId: string | null;
    idempotencyKey: string;
    data: CreateAppointmentInput;
    scheduledAt: Date;
    recurrence?: { seriesId: string; occurrence: number };
    provenance?: {
      createdVia: CreatedVia;
      initialStatus?: 'agendado' | 'atendido' | 'cancelado' | 'faltou';
      importBatchId?: string;
      importSourceReference?: string;
    };
  },
): Promise<AppointmentSummary> {
  const { clinicId, userId, actorType, correlationId, idempotencyKey, data, scheduledAt } = input;
  await assertCommercialPriceInput(tx, clinicId, data);
  if (data.patientId) await assertPatientInClinic(tx, clinicId, data.patientId);
  await assertUnitInClinic(tx, clinicId, data.unitId);
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
      status: input.provenance?.initialStatus ?? 'agendado',
      valor,
      valorAjustado: data.valorAjustado ?? false,
      valorAjusteMotivo: data.valorAjustado ? (data.valorAjusteMotivo ?? null) : null,
      pricingPolicyMode: data.pricingPolicyMode ?? 'absorb_fees',
      commercialPaymentMethod: data.commercialPaymentMethod ?? null,
      commercialInstallmentCount: data.commercialInstallmentCount ?? null,
      commercialPriceId: data.commercialPriceId ?? null,
      snapshotProcedureName: snap.nome,
      snapshotProcedureCodigo: snap.codigo,
      snapshotProcedureCategoria: snap.categoria,
      snapshotProcedureValor: snap.valorPadrao,
      snapshotProcedureDuracaoMin: snap.duracaoMin,
      snapshotDoctorNome: snap.doctorNome,
      createdVia:
        input.provenance?.createdVia ?? (actorType === 'ai_agent' ? 'ai_agent' : 'attendant'),
      urgencia: data.urgencia ?? false,
      observacoes: data.observacoes ?? null,
      recurrenceSeriesId: input.recurrence?.seriesId ?? null,
      recurrenceOccurrence: input.recurrence?.occurrence ?? null,
      importBatchId: input.provenance?.importBatchId ?? null,
      importSourceReference: input.provenance?.importSourceReference ?? null,
      createdBy: userId,
    })
    .returning();

  await logAppointmentStateChange(tx, {
    clinicId,
    appointmentId: row!.id,
    fromStatus: null,
    toStatus: row!.status,
    transitionedBy: userId,
    actorType,
    sourceIdempotencyKey: idempotencyKey,
    correlationId,
  });
  await reserveAppointmentResources(tx, row!, data.resourceIds ?? []);
  await publishCreated(tx, row!, idempotencyKey, correlationId);
  return toAppointmentSummary(row!);
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
  if (scheduledAt.getTime() < Date.now()) {
    throw new SchedulingValidationError('não é permitido agendar no passado');
  }

  try {
    return await idempotentMutation(
      {
        idempotency: {
          key: idemKey('create', idempotencyKey),
          payload: jsonSafe(data),
          ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
        },
        audit: {
          action: SCHEDULING_EVENTS.CREATED,
          resourceType: 'appointment',
          resourceId: null,
          before: null,
          requestContext,
        },
        actor,
      },
      (tx) =>
        insertScheduledAppointment(tx, {
          clinicId,
          userId,
          actorType,
          correlationId: requestContext.correlationId ?? null,
          idempotencyKey,
          data,
          scheduledAt,
        }),
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
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
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
        idempotency: {
          key: idemKey('reschedule', idempotencyKey),
          payload: jsonSafe({ id, data }),
          ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
        },
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
          .where(and(eq(appointments.id, id), eq(appointments.clinicId, clinicId)))
          .for('update')
          .limit(1);
        if (!old) throw new SchedulingValidationError(`appointment não encontrado: ${id}`);
        assertTransition(old.status as AppointmentState, 'cancelado');

        const oldReservations = await tx
          .select({ resourceId: appointmentResourceReservations.resourceId })
          .from(appointmentResourceReservations)
          .where(
            and(
              eq(appointmentResourceReservations.appointmentId, old.id),
              eq(appointmentResourceReservations.clinicId, clinicId),
              eq(appointmentResourceReservations.active, true),
            ),
          );

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
          .where(and(eq(appointments.id, id), eq(appointments.clinicId, clinicId)));
        await setAppointmentResourceReservationsActive(tx, old.id, clinicId, false);

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
            pricingPolicyMode: old.pricingPolicyMode,
            commercialPaymentMethod: old.commercialPaymentMethod,
            commercialInstallmentCount: old.commercialInstallmentCount,
            commercialPriceId: old.commercialPriceId,
            snapshotProcedureName: old.snapshotProcedureName,
            snapshotProcedureCodigo: old.snapshotProcedureCodigo,
            snapshotProcedureCategoria: old.snapshotProcedureCategoria,
            snapshotProcedureValor: old.snapshotProcedureValor,
            snapshotProcedureDuracaoMin: old.snapshotProcedureDuracaoMin,
            snapshotDoctorNome: old.snapshotDoctorNome,
            snapshotDoctorCrm: old.snapshotDoctorCrm,
            snapshotDoctorEspecialidade: old.snapshotDoctorEspecialidade,
            createdVia: actorType === 'ai_agent' ? 'ai_agent' : 'attendant',
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

        await reserveAppointmentResources(
          tx,
          created!,
          oldReservations.map((reservation) => reservation.resourceId),
        );

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
            cancelledAt: new Date().toISOString(),
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
