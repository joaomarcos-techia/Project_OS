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
  doctorAbsences,
  schedulableResources,
  appointmentResourceReservations,
  waitingQueueEntries,
  recurrenceSeries,
  appointmentImportBatches,
  waitlistEntries,
  clinicHolidays,
  appointments,
  appointmentStateLog,
  appointmentCorrections,
  appointmentStatus,
  appointmentCreatedVia,
  appointmentImportStatus,
  appointmentActorType,
  appointmentRecoveryKind,
  doctorAbsenceStrategy,
  schedulableResourceType,
  waitingQueuePriority,
  waitingQueueStatus,
  recurrenceSeriesStatus,
  waitlistStatus,
  procedureChangedField,
} from './schema';

export { SCHEDULING_EVENTS } from './events';
export type {
  CreatedVia,
  CancelReason,
  AppointmentCreatedPayload,
  AppointmentDepositRequestedPayload,
  AppointmentConfirmedPayload,
  AppointmentCheckedInPayload,
  AppointmentStartedPayload,
  AppointmentCompletedPayload,
  AppointmentInsuranceCompletedPayload,
  AppointmentCancelledPayload,
  AppointmentNoShowPayload,
  AppointmentRescheduledPayload,
  AppointmentBillingModeChangedPayload,
  AppointmentCorrectedPayload,
  DoctorAbsenceCreatedPayload,
  WaitlistOfferedPayload,
} from './events';

export { APPOINTMENT_STATES, TERMINAL_STATES } from './state-machine';
export type { AppointmentState } from './state-machine';

export { schedulingApiV1 } from './api';
export type { SchedulingApiV1 } from './api';
export type { ReminderCandidate } from './reminder-candidates';
export type { DepositCandidate, RemainderCandidate } from './deposit-candidates';
export type { DoctorCommitments, WaitlistOfferState } from './queries';

// WAIT-001 — expiração/repasse das ofertas (consumido pelo cron do app).
export { expireStaleWaitlistOffers } from './waitlist-expiry';
export type { WaitlistExpirySummary } from './waitlist-expiry';

export type {
  AppointmentSummary,
  ProcedureSummary,
  Slot,
  AppointmentStatusDTO,
  RecoverAppointmentInput,
  CreateDoctorAbsenceInput,
  DoctorAbsenceResult,
  HistoricalAppointmentImportInput,
  HistoricalAppointmentImportResult,
  CreateSchedulableResourceInput,
  SchedulableResourceDTO,
  CreateRecurringAppointmentsInput,
  RecurrenceSeriesResult,
  CreateWaitlistEntryInput,
  WaitlistEntryDTO,
} from './types';
