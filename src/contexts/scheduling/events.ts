/**
 * Scheduling context events (C6). Producer-side Zod schemas registered in the
 * outbox catalog at module load (imported via the schema barrel through
 * `./schema`). VisãoGeral §4.4 freezes the 8 event names.
 *
 * Frozen rules (ADR-011):
 *   - Names are 3-segment `<context>.<entity>.<action>` (CHECK regex on outbox).
 *   - Payloads are JSON-safe: timestamps as `z.string().datetime()` (NEVER
 *     z.date()); money as `z.number()`; only ids + non-sensitive scalars.
 *   - `scheduling.appointment.completed` is the official contract with Financial
 *     (C9). `cancelled` carries an explicit `cancelReason` so downstream never
 *     guesses why (M10 — e.g. a high-value confirmed appointment cancelled by a
 *     patient LGPD delete must reconcile, not vanish silently).
 *   - Versionados v1: payload shape is frozen for future webhooks.
 */
import { z } from 'zod';

import { registerEventSchema } from '@/lib/outbox/catalog';

import { APPOINTMENT_STATES } from './state-machine';

export const SCHEDULING_EVENTS = {
  CREATED: 'scheduling.appointment.created',
  CONFIRMED: 'scheduling.appointment.confirmed',
  CHECKED_IN: 'scheduling.appointment.checked_in',
  STARTED: 'scheduling.appointment.started',
  COMPLETED: 'scheduling.appointment.completed', // FINANCIAL OUVE (C9)
  CANCELLED: 'scheduling.appointment.cancelled',
  NO_SHOW: 'scheduling.appointment.no_show',
  RESCHEDULED: 'scheduling.appointment.rescheduled',
} as const;

const uuid = z.string().uuid();
const statusEnum = z.enum(APPOINTMENT_STATES);
export const createdViaEnum = z.enum(['attendant', 'ai_agent', 'walkin', 'super_admin']);
export const cancelReasonEnum = z.enum(['user', 'patient_deleted', 'reschedule']);
export type CreatedVia = z.infer<typeof createdViaEnum>;
export type CancelReason = z.infer<typeof cancelReasonEnum>;

// --- created ---------------------------------------------------------------
export const AppointmentCreatedSchema = z.object({
  appointmentId: uuid,
  clinicId: uuid,
  doctorId: uuid,
  patientId: uuid.nullable(),
  procedureId: uuid,
  scheduledAt: z.string().datetime(),
  durationMin: z.number().int().positive(),
  valor: z.number().nonnegative(),
  snapshotProcedureName: z.string(),
  snapshotProcedureCodigo: z.string().nullable(),
  snapshotProcedureCategoria: z.string().nullable(),
  snapshotProcedureValor: z.number().nonnegative(),
  snapshotProcedureDuracaoMin: z.number().int().positive(),
  snapshotDoctorNome: z.string(),
  createdVia: createdViaEnum,
  urgencia: z.boolean(),
});
export type AppointmentCreatedPayload = z.infer<typeof AppointmentCreatedSchema>;

// --- transition events (confirmed / checked_in) ----------------------------
const TransitionBase = z.object({
  appointmentId: uuid,
  clinicId: uuid,
  fromStatus: statusEnum,
  toStatus: statusEnum,
  reason: z.string().nullable(),
});

export const AppointmentConfirmedSchema = TransitionBase;
export type AppointmentConfirmedPayload = z.infer<typeof AppointmentConfirmedSchema>;

export const AppointmentCheckedInSchema = TransitionBase;
export type AppointmentCheckedInPayload = z.infer<typeof AppointmentCheckedInSchema>;

// --- started (Clinical reage → cria prontuário rascunho) -------------------
export const AppointmentStartedSchema = z.object({
  appointmentId: uuid,
  clinicId: uuid,
  doctorId: uuid,
  patientId: uuid.nullable(),
  procedureId: uuid,
});
export type AppointmentStartedPayload = z.infer<typeof AppointmentStartedSchema>;

// --- completed (Financial reage → cria lançamento a receber) ---------------
export const AppointmentCompletedSchema = z.object({
  appointmentId: uuid,
  clinicId: uuid,
  doctorId: uuid,
  patientId: uuid.nullable(),
  procedureId: uuid,
  valor: z.number().nonnegative(),
  scheduledAt: z.string().datetime(),
});
export type AppointmentCompletedPayload = z.infer<typeof AppointmentCompletedSchema>;

// --- cancelled (motivo explícito — Financial reconcilia) -------------------
export const AppointmentCancelledSchema = z.object({
  appointmentId: uuid,
  clinicId: uuid,
  fromStatus: statusEnum,
  toStatus: statusEnum,
  cancelReason: cancelReasonEnum,
  reason: z.string().nullable(),
});
export type AppointmentCancelledPayload = z.infer<typeof AppointmentCancelledSchema>;

// --- no_show (Financial pode disparar dunning) -----------------------------
export const AppointmentNoShowSchema = z.object({
  appointmentId: uuid,
  clinicId: uuid,
  patientId: uuid.nullable(),
  fromStatus: statusEnum,
  toStatus: statusEnum,
});
export type AppointmentNoShowPayload = z.infer<typeof AppointmentNoShowSchema>;

// --- rescheduled (= cancel + create; lineage explícito) --------------------
export const AppointmentRescheduledSchema = z.object({
  oldAppointmentId: uuid,
  newAppointmentId: uuid,
  clinicId: uuid,
  scheduledAt: z.string().datetime(),
});
export type AppointmentRescheduledPayload = z.infer<typeof AppointmentRescheduledSchema>;

registerEventSchema(SCHEDULING_EVENTS.CREATED, AppointmentCreatedSchema);
registerEventSchema(SCHEDULING_EVENTS.CONFIRMED, AppointmentConfirmedSchema);
registerEventSchema(SCHEDULING_EVENTS.CHECKED_IN, AppointmentCheckedInSchema);
registerEventSchema(SCHEDULING_EVENTS.STARTED, AppointmentStartedSchema);
registerEventSchema(SCHEDULING_EVENTS.COMPLETED, AppointmentCompletedSchema);
registerEventSchema(SCHEDULING_EVENTS.CANCELLED, AppointmentCancelledSchema);
registerEventSchema(SCHEDULING_EVENTS.NO_SHOW, AppointmentNoShowSchema);
registerEventSchema(SCHEDULING_EVENTS.RESCHEDULED, AppointmentRescheduledSchema);
