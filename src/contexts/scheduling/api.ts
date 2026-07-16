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
import {
  createAppointmentCore,
  rescheduleCore,
  transitionCore,
} from './internal/appointment-core';
import { listReminderCandidates, type ReminderCandidate } from './reminder-candidates';
import {
  getAppointment,
  getAvailableSlots,
  getDoctorActiveCommitments,
  listProcedures as listProceduresQuery,
  type DoctorCommitments,
  type GetAvailableSlotsOpts,
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
   * C14 — consultas ativas cuja data local é amanhã (candidatas a lembrete D-1).
   * Read cross-tenant (regra de "quem precisa de lembrete" mora no Scheduling).
   */
  listReminderCandidates(limit?: number): Promise<ReminderCandidate[]>;
  /**
   * ADR-032 §4 — compromissos que bloqueiam desligar um médico (agenda futura /
   * consulta aberta). O Identity/app-layer pergunta; a REGRA do que conta mora aqui.
   */
  doctorActiveCommitments(clinicId: string, doctorId: string): Promise<DoctorCommitments>;
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
  listReminderCandidates: (limit) => listReminderCandidates(limit),
  doctorActiveCommitments: (clinicId, doctorId) =>
    getDoctorActiveCommitments(clinicId, doctorId),
  createAppointment: (input, idempotencyKey) =>
    createAction({ ...input, createdVia: input.createdVia ?? 'ai_agent' }, idempotencyKey),
  confirmAppointment: (id, idempotencyKey, reason) => confirmAction(id, idempotencyKey, reason),
  cancelAppointment: (id, idempotencyKey, reason) => cancelAction(id, idempotencyKey, reason),
  rescheduleAppointment: (id, input, idempotencyKey) =>
    rescheduleAction(id, input, idempotencyKey),

  scheduleAsAgent: (ctx, input, idempotencyKey) =>
    createAppointmentCore(
      agentMutationActor(ctx),
      'ai_agent',
      agentRequestContext(ctx),
      { ...input, createdVia: input.createdVia ?? 'ai_agent' },
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
    rescheduleCore(agentMutationActor(ctx), 'ai_agent', agentRequestContext(ctx), appointmentId, input, idempotencyKey),
};
