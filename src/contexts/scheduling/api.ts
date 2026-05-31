/**
 * Scheduling internal API (C6) — para outros contextos / AI Agent (C11/C12),
 * NÃO HTTP. Versionada desde já (M14): quando o contrato evoluir, nasce
 * `schedulingApiV2` sem refactor global dos call-sites v1.
 *
 * Mantém a MESMA pipeline (requireUser/permission/idempotência/audit/evento) —
 * a IA NÃO tem bypass. Estas funções só delegam às Server Actions / queries.
 */
import {
  cancelAppointment as cancelAction,
  confirmAppointment as confirmAction,
  createAppointment as createAction,
  rescheduleAppointment as rescheduleAction,
} from './actions';
import { getAppointment, getAvailableSlots, type GetAvailableSlotsOpts } from './queries';
import type {
  AppointmentSummary,
  CreateAppointmentInput,
  RescheduleInput,
  Slot,
} from './types';

export interface SchedulingApiV1 {
  listSlots(opts: GetAvailableSlotsOpts): Promise<Slot[]>;
  lookupAppointment(clinicId: string, id: string): Promise<AppointmentSummary | null>;
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
}

export const schedulingApiV1: SchedulingApiV1 = {
  listSlots: (opts) => getAvailableSlots(opts),
  lookupAppointment: (clinicId, id) => getAppointment(clinicId, id),
  createAppointment: (input, idempotencyKey) =>
    createAction({ ...input, createdVia: input.createdVia ?? 'ai_agent' }, idempotencyKey),
  confirmAppointment: (id, idempotencyKey, reason) => confirmAction(id, idempotencyKey, reason),
  cancelAppointment: (id, idempotencyKey, reason) => cancelAction(id, idempotencyKey, reason),
  rescheduleAppointment: (id, input, idempotencyKey) =>
    rescheduleAction(id, input, idempotencyKey),
};
