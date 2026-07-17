// Public surface of the `scheduling` context (C6).
// Other contexts may only import from this file (eslint-plugin-boundaries).
//
// Exposes: schema entities + enums, event names/payload types, the versioned
// internal API and the public DTOs. Server Actions, queries and internal
// handlers are NOT part of the cross-context surface — siblings react via
// outbox events, never direct calls.
export {
  procedures,
  procedureHistory,
  doctorAvailability,
  clinicHolidays,
  appointments,
  appointmentStateLog,
  appointmentStatus,
  appointmentCreatedVia,
  appointmentActorType,
  procedureChangedField,
} from './schema';

export { SCHEDULING_EVENTS } from './events';
export type {
  CreatedVia,
  CancelReason,
  AppointmentCreatedPayload,
  AppointmentConfirmedPayload,
  AppointmentCheckedInPayload,
  AppointmentStartedPayload,
  AppointmentCompletedPayload,
  AppointmentCancelledPayload,
  AppointmentNoShowPayload,
  AppointmentRescheduledPayload,
} from './events';

export { APPOINTMENT_STATES, TERMINAL_STATES } from './state-machine';
export type { AppointmentState } from './state-machine';

export { schedulingApiV1 } from './api';
export type { SchedulingApiV1 } from './api';
export type { ReminderCandidate } from './reminder-candidates';
export type { DoctorCommitments } from './queries';

export type {
  AppointmentSummary,
  ProcedureSummary,
  Slot,
  AppointmentStatusDTO,
} from './types';
