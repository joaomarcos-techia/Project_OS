/**
 * Scheduling context schema (C6) — agenda operacional da clínica.
 *
 * Categoria (ADR-007 §10): TODAS as 6 tabelas são tenant-scoped (clinic_id FK
 * CASCADE) — inclusive os dois logs (procedure_history, appointment_state_log),
 * que o spec (PlanoAção §6.2) listava sem clinic_id mas a REGRA 1 exige sem
 * exceção. RLS (ENABLE+FORCE+defaultTenantPolicy), triggers (set_updated_at,
 * snapshot-immutable), EXCLUDE de overlap (appointments + doctor_availability),
 * generated columns e os FKs cross-context vivem na migration
 * (drizzle/migrations/0015_*.sql) — Drizzle não modela EXCLUDE/RLS/triggers.
 *
 * FKs cross-context (doctor_id→profiles, patient_id→patients, unit_id→
 * clinic_units, *_by→auth.users) são declarados como `uuid()` puro AQUI (sem
 * .references()) para não violar o eslint-plugin-boundaries; a constraint FK
 * real é adicionada na SQL da migration. FKs intra-context (procedure_id,
 * appointment_id, rescheduled_from) usam .references() normal.
 *
 * Snapshot (REGRA 4): snapshot_* gravados na criação e IMUTÁVEIS (trigger).
 * crm/especialidade são forward-compat (NULL hoje; profiles ainda não os tem) —
 * a trigger permite o backfill único NULL→valor e congela depois.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// eslint-disable-next-line boundaries/element-types -- D35: tenantIdRef + clinics FK ref live in tenancy schema by design (C2 contract); same exception patient/schema.ts uses.
import { tenantIdRef } from '@/contexts/tenancy';
import { timestampsPattern, uuidPk } from '@/lib/db/types';

// Side-effect: registra os schemas scheduling.* no catálogo do outbox ao load.
import './events';

// --- enums -----------------------------------------------------------------

export const appointmentStatus = pgEnum('appointment_status', [
  'agendado',
  'confirmado',
  'chegou',
  'em_atendimento',
  'atendido',
  'cancelado',
  'faltou',
]);

export const appointmentCreatedVia = pgEnum('appointment_created_via', [
  'attendant',
  'ai_agent',
  'walkin',
  'super_admin',
]);

export const appointmentActorType = pgEnum('appointment_actor_type', [
  'user',
  'ai_agent',
  'worker',
  'system',
]);

export const procedureChangedField = pgEnum('procedure_changed_field', [
  'valor_padrao',
  'duracao_padrao_min',
  'descricao',
  'ativo',
  'categoria',
  'codigo',
]);

// --- procedures ------------------------------------------------------------

export const procedures = pgTable(
  'procedures',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    codigo: text('codigo').notNull(),
    descricao: text('descricao').notNull(),
    categoria: text('categoria'),
    valorPadrao: numeric('valor_padrao', { precision: 12, scale: 2 }).notNull().default('0'),
    duracaoPadraoMin: integer('duracao_padrao_min').notNull(),
    ativo: boolean('ativo').notNull().default(true),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicCodigoUniq: uniqueIndex('procedures_clinic_codigo_uniq').on(t.clinicId, t.codigo),
    clinicAtivoIdx: index('procedures_clinic_ativo_idx').on(t.clinicId, t.ativo),
    duracaoChk: check(
      'procedures_duracao_chk',
      sql`${t.duracaoPadraoMin} > 0 AND ${t.duracaoPadraoMin} <= 480`,
    ),
    valorChk: check('procedures_valor_chk', sql`${t.valorPadrao} >= 0`),
  }),
);

export type ProcedureRow = typeof procedures.$inferSelect;
export type ProcedureInsert = typeof procedures.$inferInsert;

// --- procedure_history (auditável separado de audit_events) ----------------

export const procedureHistory = pgTable(
  'procedure_history',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(), // REGRA 1: clinic_id mesmo sendo log
    procedureId: uuid('procedure_id')
      .notNull()
      .references(() => procedures.id, { onDelete: 'cascade' }),
    changedField: procedureChangedField('changed_field').notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    changedBy: uuid('changed_by'), // FK auth.users via migration
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    procedureChangedIdx: index('procedure_history_procedure_changed_idx').on(
      t.procedureId,
      t.changedAt,
    ),
  }),
);

export type ProcedureHistoryRow = typeof procedureHistory.$inferSelect;
export type ProcedureHistoryInsert = typeof procedureHistory.$inferInsert;

// --- doctor_availability (janelas recorrentes por weekday) -----------------

export const doctorAvailability = pgTable(
  'doctor_availability',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    doctorId: uuid('doctor_id').notNull(), // FK profiles via migration
    unitId: uuid('unit_id'), // nullable = unidade default; FK clinic_units via migration
    weekday: integer('weekday').notNull(), // 0=domingo .. 6=sábado
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    ...timestampsPattern(),
  },
  (t) => ({
    // NULLS NOT DISTINCT: trata unit_id NULL como valor único (PG15+).
    slotUniq: unique('doctor_availability_slot_uniq')
      .on(t.clinicId, t.doctorId, t.unitId, t.weekday, t.startTime)
      .nullsNotDistinct(),
    clinicDoctorWeekdayIdx: index('doctor_availability_clinic_doctor_weekday_idx').on(
      t.clinicId,
      t.doctorId,
      t.weekday,
    ),
    weekdayChk: check('doctor_availability_weekday_chk', sql`${t.weekday} >= 0 AND ${t.weekday} <= 6`),
    timeChk: check('doctor_availability_time_chk', sql`${t.endTime} > ${t.startTime}`),
    // EXCLUDE anti-overlap (omitindo unit_id) é adicionado na migration (btree_gist).
  }),
);

export type DoctorAvailabilityRow = typeof doctorAvailability.$inferSelect;
export type DoctorAvailabilityInsert = typeof doctorAvailability.$inferInsert;

// --- clinic_holidays (dia inteiro ou janela parcial) -----------------------

export const clinicHolidays = pgTable(
  'clinic_holidays',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    date: date('date').notNull(),
    reason: text('reason'),
    unitId: uuid('unit_id'), // nullable = toda a clínica; FK clinic_units via migration
    startTime: time('start_time'), // NULL/NULL = dia inteiro; ambos = janela bloqueada
    endTime: time('end_time'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    clinicDateUnitUniq: unique('clinic_holidays_clinic_date_unit_uniq')
      .on(t.clinicId, t.date, t.unitId)
      .nullsNotDistinct(),
    clinicDateIdx: index('clinic_holidays_clinic_date_idx').on(t.clinicId, t.date),
    windowChk: check(
      'clinic_holidays_window_chk',
      sql`(${t.startTime} IS NULL) = (${t.endTime} IS NULL) AND (${t.endTime} IS NULL OR ${t.endTime} > ${t.startTime})`,
    ),
  }),
);

export type ClinicHolidayRow = typeof clinicHolidays.$inferSelect;
export type ClinicHolidayInsert = typeof clinicHolidays.$inferInsert;

// --- appointments ----------------------------------------------------------

export const appointments = pgTable(
  'appointments',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    unitId: uuid('unit_id'), // FK clinic_units via migration
    doctorId: uuid('doctor_id').notNull(), // FK profiles via migration
    patientId: uuid('patient_id'), // FK patients ON DELETE SET NULL via migration
    procedureId: uuid('procedure_id')
      .notNull()
      .references(() => procedures.id, { onDelete: 'restrict' }), // intra-context
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    durationMin: integer('duration_min').notNull(),
    status: appointmentStatus('status').notNull().default('agendado'),
    valor: numeric('valor', { precision: 12, scale: 2 }).notNull(),
    valorAjustado: boolean('valor_ajustado').notNull().default(false),
    valorAjusteMotivo: text('valor_ajuste_motivo'),
    // --- snapshot imutável (REGRA 4) ---
    snapshotProcedureName: text('snapshot_procedure_name').notNull(),
    snapshotProcedureCodigo: text('snapshot_procedure_codigo'),
    snapshotProcedureCategoria: text('snapshot_procedure_categoria'),
    snapshotProcedureValor: numeric('snapshot_procedure_valor', {
      precision: 12,
      scale: 2,
    }).notNull(),
    snapshotProcedureDuracaoMin: integer('snapshot_procedure_duracao_min').notNull(),
    snapshotDoctorNome: text('snapshot_doctor_nome').notNull(),
    snapshotDoctorCrm: text('snapshot_doctor_crm'), // forward-compat (NULL hoje)
    snapshotDoctorEspecialidade: text('snapshot_doctor_especialidade'), // forward-compat
    // --- metadata ---
    createdVia: appointmentCreatedVia('created_via').notNull().default('attendant'),
    urgencia: boolean('urgencia').notNull().default(false),
    faturamentoPendente: boolean('faturamento_pendente').notNull().default(false), // owner = Financial (C9)
    observacoes: text('observacoes'),
    createdBy: uuid('created_by'), // FK auth.users via migration
    rescheduledFromAppointmentId: uuid('rescheduled_from_appointment_id').references(
      (): AnyPgColumn => appointments.id,
      { onDelete: 'set null' },
    ),
    // --- colunas derivadas (M13): tornam UNIQUE/EXCLUDE declarativos ---
    slotOccupiesInstant: boolean('slot_occupies_instant').generatedAlwaysAs(
      sql`status <> 'cancelado' AND status <> 'faltou'`,
    ),
    slotBlocksOverlap: boolean('slot_blocks_overlap').generatedAlwaysAs(
      sql`status <> 'cancelado' AND status <> 'faltou' AND created_via <> 'walkin'`,
    ),
    ...timestampsPattern(),
  },
  (t) => ({
    // R1: anti duplo-agendamento no instante exato (predicado via coluna gerada).
    doctorSlotUniq: uniqueIndex('appointments_doctor_slot_uniq')
      .on(t.doctorId, t.scheduledAt)
      .where(sql`slot_occupies_instant`),
    clinicScheduledIdx: index('appointments_clinic_scheduled_idx').on(t.clinicId, t.scheduledAt),
    // cobre a subtração de conflitos do slot resolver (só não-terminais).
    clinicDoctorSchedIdx: index('appointments_clinic_doctor_sched_idx')
      .on(t.clinicId, t.doctorId, t.scheduledAt)
      .where(sql`slot_occupies_instant`),
    clinicPatientIdx: index('appointments_clinic_patient_idx').on(t.clinicId, t.patientId),
    clinicStatusIdx: index('appointments_clinic_status_idx').on(t.clinicId, t.status),
    durationChk: check(
      'appointments_duration_chk',
      sql`${t.durationMin} > 0 AND ${t.durationMin} <= 480`,
    ),
    valorChk: check('appointments_valor_chk', sql`${t.valor} >= 0`),
    valorAjusteChk: check(
      'appointments_valor_ajuste_chk',
      sql`${t.valorAjustado} = false OR ${t.valorAjusteMotivo} IS NOT NULL`,
    ),
    rescheduleSelfChk: check(
      'appointments_reschedule_self_chk',
      sql`${t.rescheduledFromAppointmentId} IS NULL OR ${t.rescheduledFromAppointmentId} <> ${t.id}`,
    ),
    // EXCLUDE anti-overlap + trigger de imutabilidade de snapshot na migration.
  }),
);

export type AppointmentRow = typeof appointments.$inferSelect;
export type AppointmentInsert = typeof appointments.$inferInsert;

// --- appointment_state_log -------------------------------------------------

export const appointmentStateLog = pgTable(
  'appointment_state_log',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(), // REGRA 1
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id, { onDelete: 'cascade' }),
    fromStatus: appointmentStatus('from_status'),
    toStatus: appointmentStatus('to_status').notNull(),
    transitionedAt: timestamp('transitioned_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    transitionedBy: uuid('transitioned_by'), // FK auth.users via migration
    reason: text('reason'),
    actorType: appointmentActorType('actor_type').notNull().default('user'), // M19
    sourceEventId: uuid('source_event_id'), // M11 — outbox event que causou
    sourceIdempotencyKey: text('source_idempotency_key'), // M11
    correlationId: uuid('correlation_id'), // M20 — tracing cross-context
  },
  (t) => ({
    appointmentTransitionedIdx: index('appointment_state_log_appt_transitioned_idx').on(
      t.appointmentId,
      t.transitionedAt,
    ),
  }),
);

export type AppointmentStateLogRow = typeof appointmentStateLog.$inferSelect;
export type AppointmentStateLogInsert = typeof appointmentStateLog.$inferInsert;
