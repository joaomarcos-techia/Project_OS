/**
 * Scheduling internal API (C6) — para outros contextos / AI Agent (C11/C12),
 * NÃO HTTP. Versionada desde já (M14): quando o contrato evoluir, nasce
 * `schedulingApiV2` sem refactor global dos call-sites v1.
 *
 * Mantém a MESMA pipeline (requireUser/permission/idempotência/audit/evento) —
 * a IA NÃO tem bypass. Estas funções só delegam às Server Actions / queries.
 */
import { type AgentActorCtx, agentMutationActor, agentRequestContext } from '@/lib/agent/actor';

import {
  cancelAppointment as cancelAction,
  confirmAppointment as confirmAction,
  createAppointment as createAction,
  rescheduleAppointment as rescheduleAction,
} from './actions';
import { SCHEDULING_EVENTS } from './events';
import { createAppointmentCore, rescheduleCore, transitionCore } from './internal/appointment-core';
import {
  listDepositCandidates,
  listRemainderCandidates,
  type DepositCandidate,
  type RemainderCandidate,
} from './deposit-candidates';
import { listReminderCandidates, type ReminderCandidate } from './reminder-candidates';
import {
  getAppointment,
  getAvailableSlots,
  getDoctorActiveCommitments,
  getWaitlistOfferState,
  hasFutureEquivalentAppointment,
  hasSubsequentCompletedAppointment,
  listUpcomingPatientAppointments,
  listProcedures as listProceduresQuery,
  type DoctorCommitments,
  type GetAvailableSlotsOpts,
  type WaitlistOfferState,
} from './queries';
import type {
  AppointmentSummary,
  CreateAppointmentInput,
  ProcedureSummary,
  RescheduleInput,
  Slot,
} from './types';

export interface SchedulingApiV1 {
  listSlots(opts: GetAvailableSlotsOpts): Promise<Slot[]>;
  /**
   * Catálogo de procedimentos ATIVOS (C11: tool provide_procedure_price —
   * lazy context, review G3). Aditivo ao contrato congelado de C6 (M14:
   * acrescentar método é não-quebrante; o PlanoAção §11.2 referencia
   * api.scheduling.listProcedures explicitamente).
   */
  listProcedures(clinicId: string, opts?: { limit?: number }): Promise<ProcedureSummary[]>;
  lookupAppointment(clinicId: string, id: string): Promise<AppointmentSummary | null>;
  /**
   * WAIT-001 — estado da oferta da lista de espera, para o guard de send-time do
   * C14 não mandar convite de uma vaga já resolvida.
   */
  lookupWaitlistOffer(clinicId: string, entryId: string): Promise<WaitlistOfferState | null>;
  listPatientAppointments(
    clinicId: string,
    patientId: string,
    limit?: number,
  ): Promise<AppointmentSummary[]>;
  /**
   * C14 — consultas ativas cuja data local é amanhã (candidatas a lembrete D-1).
   * Read cross-tenant (regra de "quem precisa de lembrete" mora no Scheduling).
   */
  listReminderCandidates(limit?: number): Promise<ReminderCandidate[]>;
  /**
   * ADR-049 1.3b — agendamentos que ainda podem receber cobrança de sinal.
   * Read cross-tenant: a regra de "elegível pela AGENDA" mora aqui; se já existe
   * cobrança quem sabe é o Payments.
   */
  listDepositCandidates(
    clinicIds: readonly string[],
    opts?: { createdWithinHours?: number; limit?: number },
  ): Promise<DepositCandidate[]>;
  /**
   * ADR-051 1.5b.3 — atendimentos concluídos que podem gerar cobrança do
   * RESTANTE. Mesma divisão: a regra de agenda mora aqui; **quanto ainda falta**
   * é conta do Payments, que conhece créditos e cobranças.
   */
  listRemainderCandidates(
    clinicIds: readonly string[],
    opts?: { completedWithinHours?: number; limit?: number },
  ): Promise<RemainderCandidate[]>;
  /**
   * ADR-032 §4 — compromissos que bloqueiam desligar um médico (agenda futura /
   * consulta aberta). O Identity/app-layer pergunta; a REGRA do que conta mora aqui.
   */
  doctorActiveCommitments(clinicId: string, doctorId: string): Promise<DoctorCommitments>;
  hasSubsequentCompletedAppointment(
    clinicId: string,
    input: {
      patientId: string;
      after: Date;
      excludeAppointmentId?: string | null;
      procedureId?: string | null;
      doctorId?: string | null;
    },
  ): Promise<boolean>;
  /** ADR-057 / 2.4B — remarcação futura ativa do mesmo procedimento. */
  hasFutureEquivalentAppointment(
    clinicId: string,
    input: {
      patientId: string;
      procedureId: string;
      after: Date;
      excludeAppointmentId: string;
    },
  ): Promise<boolean>;
  createAppointment(
    input: CreateAppointmentInput,
    idempotencyKey: string,
  ): Promise<AppointmentSummary>;
  confirmAppointment(
    id: string,
    idempotencyKey: string,
    reason?: string,
  ): Promise<AppointmentSummary>;
  cancelAppointment(
    id: string,
    idempotencyKey: string,
    reason?: string,
  ): Promise<AppointmentSummary>;
  rescheduleAppointment(
    id: string,
    input: RescheduleInput,
    idempotencyKey: string,
  ): Promise<AppointmentSummary>;

  // --- C12: AI Agent (ator de sistema 'ai_agent', sem request) -------------
  // Mesmos cores das Server Actions; a IA NÃO tem bypass. `idempotencyKey` é
  // derivado por conteúdo (sha256 conversationId+intent+args) na saga (R1).
  scheduleAsAgent(
    ctx: AgentActorCtx,
    input: CreateAppointmentInput,
    idempotencyKey: string,
  ): Promise<AppointmentSummary>;
  confirmAsAgent(
    ctx: AgentActorCtx,
    appointmentId: string,
    idempotencyKey: string,
    reason?: string,
  ): Promise<AppointmentSummary>;
  cancelAsAgent(
    ctx: AgentActorCtx,
    appointmentId: string,
    idempotencyKey: string,
    reason?: string,
  ): Promise<AppointmentSummary>;
  rescheduleAsAgent(
    ctx: AgentActorCtx,
    appointmentId: string,
    input: RescheduleInput,
    idempotencyKey: string,
  ): Promise<AppointmentSummary>;
}

export const schedulingApiV1: SchedulingApiV1 = {
  listSlots: (opts) => getAvailableSlots(opts),
  listProcedures: async (clinicId, opts) => {
    const rows = await listProceduresQuery(clinicId, { onlyActive: true });
    return rows.slice(0, opts?.limit ?? 20);
  },
  lookupAppointment: (clinicId, id) => getAppointment(clinicId, id),
  lookupWaitlistOffer: (clinicId, entryId) => getWaitlistOfferState(clinicId, entryId),
  listPatientAppointments: (clinicId, patientId, limit) =>
    listUpcomingPatientAppointments(clinicId, patientId, limit),
  listReminderCandidates: (limit) => listReminderCandidates(limit),
  listDepositCandidates: (clinicIds, opts) => listDepositCandidates(clinicIds, opts),
  listRemainderCandidates: (clinicIds, opts) => listRemainderCandidates(clinicIds, opts),
  doctorActiveCommitments: (clinicId, doctorId) => getDoctorActiveCommitments(clinicId, doctorId),
  hasSubsequentCompletedAppointment: (clinicId, input) =>
    hasSubsequentCompletedAppointment(clinicId, input),
  hasFutureEquivalentAppointment: (clinicId, input) =>
    hasFutureEquivalentAppointment(clinicId, input),
  createAppointment: (input, idempotencyKey) => createAction(input, idempotencyKey),
  confirmAppointment: (id, idempotencyKey, reason) => confirmAction(id, idempotencyKey, reason),
  cancelAppointment: (id, idempotencyKey, reason) => cancelAction(id, idempotencyKey, reason),
  rescheduleAppointment: (id, input, idempotencyKey) => rescheduleAction(id, input, idempotencyKey),

  scheduleAsAgent: (ctx, input, idempotencyKey) =>
    createAppointmentCore(
      agentMutationActor(ctx),
      'ai_agent',
      agentRequestContext(ctx),
      input,
      idempotencyKey,
    ),
  confirmAsAgent: (ctx, appointmentId, idempotencyKey, reason) =>
    transitionCore(
      agentMutationActor(ctx),
      'ai_agent',
      agentRequestContext(ctx),
      {
        action: 'confirm',
        target: 'confirmado',
        eventName: SCHEDULING_EVENTS.CONFIRMED,
        id: appointmentId,
        reason,
      },
      idempotencyKey,
    ),
  cancelAsAgent: (ctx, appointmentId, idempotencyKey, reason) =>
    transitionCore(
      agentMutationActor(ctx),
      'ai_agent',
      agentRequestContext(ctx),
      {
        action: 'cancel',
        target: 'cancelado',
        eventName: SCHEDULING_EVENTS.CANCELLED,
        cancelReason: 'user',
        id: appointmentId,
        reason,
      },
      idempotencyKey,
    ),
  rescheduleAsAgent: (ctx, appointmentId, input, idempotencyKey) =>
    rescheduleCore(
      agentMutationActor(ctx),
      'ai_agent',
      agentRequestContext(ctx),
      appointmentId,
      input,
      idempotencyKey,
    ),
};
