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
  DEPOSIT_REQUESTED: 'scheduling.appointment.deposit_requested',
  CONFIRMED: 'scheduling.appointment.confirmed',
  CHECKED_IN: 'scheduling.appointment.checked_in',
  STARTED: 'scheduling.appointment.started',
  COMPLETED: 'scheduling.appointment.completed', // FINANCIAL OUVE (C9)
  /**
   * Convênios (P7.4): publicado JUNTO com `completed` quando o atendimento é
   * `convenio`. O `health-insurance` ouve este (o `completed` é do Financeiro e o
   * registro do outbox aceita um consumidor por tipo).
   */
  INSURANCE_COMPLETED: 'scheduling.appointment.insurance_completed',
  CANCELLED: 'scheduling.appointment.cancelled',
  NO_SHOW: 'scheduling.appointment.no_show',
  RESCHEDULED: 'scheduling.appointment.rescheduled',
  /**
   * P4.3: a forma de atendimento (particular ↔ convênio) mudou antes da chegada. O
   * Payments ouve (anula a cobrança particular ainda aberta quando vira convênio).
   */
  BILLING_MODE_CHANGED: 'scheduling.appointment.billing_mode_changed',
  CORRECTED: 'scheduling.appointment.corrected',
  DOCTOR_ABSENCE_CREATED: 'scheduling.doctor_absence.created',
  WAITLIST_OFFERED: 'scheduling.waitlist.offered',
  RECURRENCE_CREATED: 'scheduling.recurrence.created',
  RECURRENCE_CANCELLED: 'scheduling.recurrence.cancelled',
  IMPORT_COMPLETED: 'scheduling.import.completed',
} as const;

const uuid = z.string().uuid();
const statusEnum = z.enum(APPOINTMENT_STATES);
export const createdViaEnum = z.enum(['attendant', 'ai_agent', 'walkin', 'super_admin', 'import']);
export const cancelReasonEnum = z.enum([
  'user',
  'patient_deleted',
  'patient_deceased',
  'reschedule',
  'doctor_absence',
  // ADR-049: o hold do sinal venceu sem pagamento. Motivo PRÓPRIO de propósito —
  // marcar como 'user' diria que alguém cancelou, e ninguém cancelou: o prazo
  // passou. A diferença aparece no histórico do paciente e no que a clínica lê.
  'deposit_expired',
]);
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

/** Agendamento pela IA confirmado; Payments relê a agenda antes de cobrar. */
export const AppointmentDepositRequestedSchema = z.object({
  clinicId: uuid,
  appointmentId: uuid,
});
export type AppointmentDepositRequestedPayload = z.infer<typeof AppointmentDepositRequestedSchema>;

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
// C9: payload carrega snapshotProcedureName/snapshotDoctorNome/unitId para o
// handler Financial gerar a descrição + Caixa patient-first SEM ler appointments
// (boundaries). Extensão ADITIVA do contrato v1. Nome de profissional NÃO é PII;
// nome de paciente JAMAIS entra em payload (ADR-011 #27) — só patientId.
export const AppointmentCompletedSchema = z.object({
  appointmentId: uuid,
  clinicId: uuid,
  doctorId: uuid,
  patientId: uuid.nullable(),
  procedureId: uuid,
  unitId: uuid.nullable(),
  valor: z.number().nonnegative(),
  snapshotProcedureName: z.string(),
  snapshotDoctorNome: z.string(),
  scheduledAt: z.string().datetime(),
  /**
   * Modalidade (0148). `optional` só pela janela de deploy: evento enfileirado
   * antes desta versão não tem a chave e é sempre de atendimento particular (a
   * coluna nasceu `particular` para todos). Todo publicador novo preenche.
   */
  billingMode: z.enum(['particular', 'convenio']).optional(),
});
export type AppointmentCompletedPayload = z.infer<typeof AppointmentCompletedSchema>;

// --- insurance_completed (convênios P7.4: guia automática) -----------------
export const AppointmentInsuranceCompletedSchema = z.object({
  appointmentId: uuid,
  clinicId: uuid,
  patientId: uuid,
  doctorId: uuid,
  procedureId: uuid,
  scheduledAt: z.string().datetime(),
});
export type AppointmentInsuranceCompletedPayload = z.infer<
  typeof AppointmentInsuranceCompletedSchema
>;

// --- cancelled (motivo explícito — Financial reconcilia) -------------------
export const AppointmentCancelledSchema = z.object({
  appointmentId: uuid,
  clinicId: uuid,
  fromStatus: statusEnum,
  toStatus: statusEnum,
  cancelReason: cancelReasonEnum,
  reason: z.string().nullable(),
  /**
   * ADR-049 1.5 — QUANDO o cancelamento aconteceu. O estorno do sinal é uma regra
   * de ANTECEDÊNCIA (`isRefundableCancellation`), e o consumidor roda no worker,
   * minutos depois: julgar com o relógio dele faria um cancelamento feito a tempo
   * virar "tarde demais" toda vez que o outbox atrasasse — o paciente perderia
   * dinheiro por causa de uma fila nossa.
   *
   * **`optional` só por causa da janela de deploy**: eventos já enfileirados
   * quando esta versão subir não têm a chave, e um campo obrigatório os faria
   * falhar no `schema.parse` do worker — cancelamentos travados numa fila de
   * retry. Todo publicador novo preenche; o consumidor mede quantos chegam sem.
   */
  cancelledAt: z.string().datetime().optional(),
});
export type AppointmentCancelledPayload = z.infer<typeof AppointmentCancelledSchema>;

// --- no_show (Financial pode disparar dunning) -----------------------------
export const AppointmentNoShowSchema = z.object({
  appointmentId: uuid,
  clinicId: uuid,
  patientId: uuid.nullable(),
  fromStatus: statusEnum,
  toStatus: statusEnum,
  /**
   * ADR-057 / 2.4B. Opcional para manter eventos históricos válidos; somente
   * eventos novos, que carregam o instante autoritativo, geram recuperação.
   */
  noShowAt: z.string().datetime().optional(),
});
export type AppointmentNoShowPayload = z.infer<typeof AppointmentNoShowSchema>;

// --- billing_mode_changed (P4.3) -------------------------------------------
export const AppointmentBillingModeChangedSchema = z.object({
  appointmentId: uuid,
  clinicId: uuid,
  patientId: uuid.nullable(),
  from: z.enum(['particular', 'convenio']),
  to: z.enum(['particular', 'convenio']),
  changedAt: z.string().datetime(),
});
export type AppointmentBillingModeChangedPayload = z.infer<
  typeof AppointmentBillingModeChangedSchema
>;

// --- rescheduled (= cancel + create; lineage explícito) --------------------
export const AppointmentRescheduledSchema = z.object({
  oldAppointmentId: uuid,
  newAppointmentId: uuid,
  clinicId: uuid,
  scheduledAt: z.string().datetime(),
});
export type AppointmentRescheduledPayload = z.infer<typeof AppointmentRescheduledSchema>;

export const AppointmentCorrectedSchema = z.object({
  appointmentId: uuid,
  clinicId: uuid,
  kind: z.enum(['interrupt', 'exceptional_cancel', 'reopen', 'transfer']),
  fromStatus: statusEnum,
  toStatus: statusEnum,
  oldDoctorId: uuid,
  newDoctorId: uuid.nullable(),
  reason: z.string().min(1),
});
export type AppointmentCorrectedPayload = z.infer<typeof AppointmentCorrectedSchema>;

export const DoctorAbsenceCreatedSchema = z.object({
  absenceId: uuid,
  clinicId: uuid,
  doctorId: uuid,
  replacementDoctorId: uuid.nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  strategy: z.enum(['cancel', 'transfer']),
  affectedAppointments: z.number().int().nonnegative(),
});
export type DoctorAbsenceCreatedPayload = z.infer<typeof DoctorAbsenceCreatedSchema>;

export const WaitlistOfferedSchema = z.object({
  waitlistEntryId: uuid,
  clinicId: uuid,
  patientId: uuid,
  releasedAppointmentId: uuid,
  doctorId: uuid,
  procedureId: uuid,
  scheduledAt: z.string().datetime(),
  /**
   * WAIT-001 — nome do profissional para a mensagem da oferta. Vem no evento
   * porque o consumidor roda dentro da TX do worker e não pode abrir uma leitura
   * paralela só para resolver o nome. `nullish` de propósito: eventos
   * publicados antes deste campo continuam válidos na reentrega.
   */
  doctorNome: z.string().nullish(),
});
export type WaitlistOfferedPayload = z.infer<typeof WaitlistOfferedSchema>;

export const RecurrenceCreatedSchema = z.object({
  seriesId: uuid,
  clinicId: uuid,
  appointmentIds: z.array(uuid).min(2),
  intervalWeeks: z.number().int().positive(),
});
export type RecurrenceCreatedPayload = z.infer<typeof RecurrenceCreatedSchema>;

export const RecurrenceCancelledSchema = z.object({
  seriesId: uuid,
  clinicId: uuid,
  cancelledAppointments: z.number().int().nonnegative(),
  reason: z.string().min(1),
});
export type RecurrenceCancelledPayload = z.infer<typeof RecurrenceCancelledSchema>;

export const AppointmentImportCompletedSchema = z.object({
  batchId: uuid,
  clinicId: uuid,
  source: z.string().min(1),
  importedAppointments: z.number().int().positive(),
  /** P4.7-b: linhas registradas como convênio histórico (referência, nunca faturamento). */
  historicalCoverages: z.number().int().min(0).optional(),
});
export type AppointmentImportCompletedPayload = z.infer<typeof AppointmentImportCompletedSchema>;

registerEventSchema(SCHEDULING_EVENTS.CREATED, AppointmentCreatedSchema);
registerEventSchema(SCHEDULING_EVENTS.DEPOSIT_REQUESTED, AppointmentDepositRequestedSchema);
registerEventSchema(SCHEDULING_EVENTS.CONFIRMED, AppointmentConfirmedSchema);
registerEventSchema(SCHEDULING_EVENTS.CHECKED_IN, AppointmentCheckedInSchema);
registerEventSchema(SCHEDULING_EVENTS.STARTED, AppointmentStartedSchema);
registerEventSchema(SCHEDULING_EVENTS.COMPLETED, AppointmentCompletedSchema);
registerEventSchema(SCHEDULING_EVENTS.INSURANCE_COMPLETED, AppointmentInsuranceCompletedSchema);
registerEventSchema(SCHEDULING_EVENTS.CANCELLED, AppointmentCancelledSchema);
registerEventSchema(SCHEDULING_EVENTS.NO_SHOW, AppointmentNoShowSchema);
registerEventSchema(SCHEDULING_EVENTS.RESCHEDULED, AppointmentRescheduledSchema);
registerEventSchema(SCHEDULING_EVENTS.BILLING_MODE_CHANGED, AppointmentBillingModeChangedSchema);
registerEventSchema(SCHEDULING_EVENTS.CORRECTED, AppointmentCorrectedSchema);
registerEventSchema(SCHEDULING_EVENTS.DOCTOR_ABSENCE_CREATED, DoctorAbsenceCreatedSchema);
registerEventSchema(SCHEDULING_EVENTS.WAITLIST_OFFERED, WaitlistOfferedSchema);
registerEventSchema(SCHEDULING_EVENTS.RECURRENCE_CREATED, RecurrenceCreatedSchema);
registerEventSchema(SCHEDULING_EVENTS.RECURRENCE_CANCELLED, RecurrenceCancelledSchema);
registerEventSchema(SCHEDULING_EVENTS.IMPORT_COMPLETED, AppointmentImportCompletedSchema);
