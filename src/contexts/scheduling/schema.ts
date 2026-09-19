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
  'import',
]);

export const appointmentImportStatus = pgEnum('appointment_import_status', [
  'processing',
  'completed',
  'failed',
]);

/**
 * ADR-049 — estado do SINAL no agendamento. Dimensão ORTOGONAL ao `status`: um
 * agendamento pode estar `agendado` com sinal pendente, pago ou vencido, e quem
 * move `status` continua sendo `assertTransition`. Projeção de
 * `patient_charges.status`; `cancelled`/`failed` da cobrança viram `none` aqui,
 * porque do ponto de vista da AGENDA não há hold segurando a vaga.
 */
export const appointmentDepositStatus = pgEnum('appointment_deposit_status', [
  'none',
  'pending',
  'paid',
  'expired',
  'refunded',
]);

export const appointmentActorType = pgEnum('appointment_actor_type', [
  'user',
  'ai_agent',
  'worker',
  'system',
]);

export const appointmentRecoveryKind = pgEnum('appointment_recovery_kind', [
  'interrupt',
  'exceptional_cancel',
  'reopen',
  'transfer',
]);

export const doctorAbsenceStrategy = pgEnum('doctor_absence_strategy', ['cancel', 'transfer']);

export const schedulableResourceType = pgEnum('schedulable_resource_type', [
  'room',
  'equipment',
  'other',
]);

export const waitingQueuePriority = pgEnum('waiting_queue_priority', ['urgent', 'normal']);

export const waitingQueueStatus = pgEnum('waiting_queue_status', [
  'waiting',
  'in_service',
  'completed',
  'cancelled',
]);

export const recurrenceSeriesStatus = pgEnum('recurrence_series_status', [
  'active',
  'cancelled',
  'completed',
]);

export const waitlistStatus = pgEnum('waitlist_status', [
  'waiting',
  'offered',
  'booked',
  'cancelled',
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
    changedAt: timestamp('changed_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    // D9 (A6/N1): sem este índice, o predicado do RLS (`clinic_id = ...`) varre a
    // tabela inteira em TODA query tenant, e o CASCADE do offboarding de clínica
    // faz seq scan. O composto abaixo não serve: não lidera por clinic_id.
    clinicIdx: index('procedure_history_clinic_id_idx').on(t.clinicId),
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
    weekdayChk: check(
      'doctor_availability_weekday_chk',
      sql`${t.weekday} >= 0 AND ${t.weekday} <= 6`,
    ),
    timeChk: check('doctor_availability_time_chk', sql`${t.endTime} > ${t.startTime}`),
    // EXCLUDE anti-overlap (omitindo unit_id) é adicionado na migration (btree_gist).
  }),
);

export type DoctorAvailabilityRow = typeof doctorAvailability.$inferSelect;
export type DoctorAvailabilityInsert = typeof doctorAvailability.$inferInsert;

// --- doctor_absences (periodos e estrategia de reorganizacao) -------------

export const doctorAbsences = pgTable(
  'doctor_absences',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    doctorId: uuid('doctor_id').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reason: text('reason').notNull(),
    strategy: doctorAbsenceStrategy('strategy').notNull(),
    replacementDoctorId: uuid('replacement_doctor_id'),
    affectedAppointments: integer('affected_appointments').notNull().default(0),
    createdBy: uuid('created_by'),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicDoctorPeriodIdx: index('doctor_absences_clinic_doctor_period_idx').on(
      t.clinicId,
      t.doctorId,
      t.startsAt,
    ),
    periodChk: check('doctor_absences_period_chk', sql`${t.endsAt} > ${t.startsAt}`),
    strategyChk: check(
      'doctor_absences_strategy_chk',
      sql`(${t.strategy} = 'cancel' AND ${t.replacementDoctorId} IS NULL)
          OR (${t.strategy} = 'transfer' AND ${t.replacementDoctorId} IS NOT NULL AND ${t.replacementDoctorId} <> ${t.doctorId})`,
    ),
  }),
);

export type DoctorAbsenceRow = typeof doctorAbsences.$inferSelect;

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
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
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

// --- schedulable_resources (salas/equipamentos/outros) --------------------

export const schedulableResources = pgTable(
  'schedulable_resources',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    unitId: uuid('unit_id'),
    name: text('name').notNull(),
    type: schedulableResourceType('type').notNull(),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by'),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicActiveIdx: index('schedulable_resources_clinic_active_idx').on(t.clinicId, t.active),
    clinicNameUniq: uniqueIndex('schedulable_resources_clinic_name_uniq').on(t.clinicId, t.name),
  }),
);

export type SchedulableResourceRow = typeof schedulableResources.$inferSelect;

// --- recurrence_series (regra semanal e cancelamento em serie) -----------

export const recurrenceSeries = pgTable(
  'recurrence_series',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    unitId: uuid('unit_id'),
    doctorId: uuid('doctor_id').notNull(),
    patientId: uuid('patient_id'),
    procedureId: uuid('procedure_id')
      .notNull()
      .references(() => procedures.id, { onDelete: 'restrict' }),
    intervalWeeks: integer('interval_weeks').notNull(),
    occurrences: integer('occurrences').notNull(),
    status: recurrenceSeriesStatus('status').notNull().default('active'),
    createdBy: uuid('created_by'),
    cancelledBy: uuid('cancelled_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicStatusIdx: index('recurrence_series_clinic_status_idx').on(t.clinicId, t.status),
    patientIdx: index('recurrence_series_patient_id_idx').on(t.patientId),
    doctorIdx: index('recurrence_series_doctor_id_idx').on(t.doctorId),
    intervalChk: check('recurrence_series_interval_chk', sql`${t.intervalWeeks} > 0`),
    occurrencesChk: check('recurrence_series_occurrences_chk', sql`${t.occurrences} > 1`),
  }),
);

export type RecurrenceSeriesRow = typeof recurrenceSeries.$inferSelect;

// --- appointment_import_batches -----------------------------------------

export const appointmentImportBatches = pgTable(
  'appointment_import_batches',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    source: text('source').notNull(),
    justification: text('justification').notNull(),
    status: appointmentImportStatus('status').notNull().default('processing'),
    totalItems: integer('total_items').notNull(),
    importedItems: integer('imported_items').notNull().default(0),
    createdBy: uuid('created_by'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicCreatedIdx: index('appointment_import_batches_clinic_created_idx').on(
      t.clinicId,
      t.createdAt,
    ),
    totalChk: check(
      'appointment_import_batches_total_chk',
      sql`${t.totalItems} > 0 AND ${t.importedItems} >= 0 AND ${t.importedItems} <= ${t.totalItems}`,
    ),
  }),
);

export type AppointmentImportBatchRow = typeof appointmentImportBatches.$inferSelect;

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
    // ADR-049 — hold do sinal. Owner = Scheduling (o Payments NÃO escreve aqui;
    // ele publica `payments.patient_charge.*` e o handler daqui projeta). CHECK na
    // migration 0085 garante `hold_expires_at IS NOT NULL` ⇔ `pending`.
    depositStatus: appointmentDepositStatus('deposit_status').notNull().default('none'),
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
    observacoes: text('observacoes'),
    createdBy: uuid('created_by'), // FK auth.users via migration
    rescheduledFromAppointmentId: uuid('rescheduled_from_appointment_id').references(
      (): AnyPgColumn => appointments.id,
      { onDelete: 'set null' },
    ),
    recurrenceSeriesId: uuid('recurrence_series_id').references(() => recurrenceSeries.id, {
      onDelete: 'restrict',
    }),
    recurrenceOccurrence: integer('recurrence_occurrence'),
    importBatchId: uuid('import_batch_id').references(() => appointmentImportBatches.id, {
      onDelete: 'restrict',
    }),
    importSourceReference: text('import_source_reference'),
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
    // A6 — FKs LIDERADAS pela coluna da FK (a checagem de RI é `WHERE <fkcol> = $1`,
    // sem clinic_id, então os compostos acima não a servem):
    //   - patient_id   → SET NULL no hard-delete LGPD (ADR-021)
    //   - procedure_id → RESTRICT ao excluir procedimento do catálogo da clínica
    //   - unit_id      → SET NULL ao excluir uma unidade
    //   - rescheduled_from_appointment_id → SET NULL (auto-referência)
    patientFkIdx: index('appointments_patient_id_idx').on(t.patientId),
    procedureFkIdx: index('appointments_procedure_id_idx').on(t.procedureId),
    unitFkIdx: index('appointments_unit_id_idx').on(t.unitId),
    rescheduledFromFkIdx: index('appointments_rescheduled_from_idx').on(
      t.rescheduledFromAppointmentId,
    ),
    recurrenceOccurrenceUniq: uniqueIndex('appointments_recurrence_occurrence_uniq')
      .on(t.recurrenceSeriesId, t.recurrenceOccurrence)
      .where(sql`${t.recurrenceSeriesId} IS NOT NULL`),
    importReferenceUniq: uniqueIndex('appointments_import_reference_uniq')
      .on(t.importBatchId, t.importSourceReference)
      .where(sql`${t.importSourceReference} IS NOT NULL`),
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

// --- appointment_resource_reservations ------------------------------------

export const appointmentResourceReservations = pgTable(
  'appointment_resource_reservations',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => schedulableResources.id, { onDelete: 'restrict' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    appointmentResourceUniq: uniqueIndex('appointment_resource_reservations_uniq').on(
      t.appointmentId,
      t.resourceId,
    ),
    clinicPeriodIdx: index('appointment_resource_reservations_clinic_period_idx').on(
      t.clinicId,
      t.startsAt,
    ),
    resourceIdx: index('appointment_resource_reservations_resource_idx').on(t.resourceId),
    periodChk: check(
      'appointment_resource_reservations_period_chk',
      sql`${t.endsAt} > ${t.startsAt}`,
    ),
  }),
);

export type AppointmentResourceReservationRow = typeof appointmentResourceReservations.$inferSelect;

// --- waiting_queue_entries (fila explícita do consultório) ----------------

export const waitingQueueEntries = pgTable(
  'waiting_queue_entries',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id, { onDelete: 'cascade' }),
    doctorId: uuid('doctor_id').notNull(),
    priority: waitingQueuePriority('priority').notNull().default('normal'),
    status: waitingQueueStatus('status').notNull().default('waiting'),
    estimatedWaitMinutesAtEntry: integer('estimated_wait_minutes_at_entry').notNull().default(0),
    queuedAt: timestamp('queued_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    ...timestampsPattern(),
  },
  (t) => ({
    appointmentUniq: uniqueIndex('waiting_queue_entries_appointment_uniq').on(t.appointmentId),
    clinicDoctorQueueIdx: index('waiting_queue_entries_clinic_doctor_queue_idx').on(
      t.clinicId,
      t.doctorId,
      t.status,
      t.priority,
      t.queuedAt,
    ),
    estimateChk: check(
      'waiting_queue_entries_estimate_chk',
      sql`${t.estimatedWaitMinutesAtEntry} >= 0`,
    ),
  }),
);

export type WaitingQueueEntryRow = typeof waitingQueueEntries.$inferSelect;

// --- waitlist_entries (oportunidades liberadas por cancelamento) ----------

export const waitlistEntries = pgTable(
  'waitlist_entries',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    patientId: uuid('patient_id').notNull(),
    doctorId: uuid('doctor_id'),
    procedureId: uuid('procedure_id')
      .notNull()
      .references(() => procedures.id, { onDelete: 'restrict' }),
    priority: waitingQueuePriority('priority').notNull().default('normal'),
    status: waitlistStatus('status').notNull().default('waiting'),
    preferredFrom: timestamp('preferred_from', { withTimezone: true }),
    preferredUntil: timestamp('preferred_until', { withTimezone: true }),
    offeredAppointmentId: uuid('offered_appointment_id').references(() => appointments.id, {
      onDelete: 'set null',
    }),
    offeredAt: timestamp('offered_at', { withTimezone: true }),
    bookedAppointmentId: uuid('booked_appointment_id').references(() => appointments.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    cancelledBy: uuid('cancelled_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicStatusPriorityIdx: index('waitlist_entries_clinic_status_priority_idx').on(
      t.clinicId,
      t.status,
      t.priority,
      t.createdAt,
    ),
    patientIdx: index('waitlist_entries_patient_id_idx').on(t.patientId),
    doctorIdx: index('waitlist_entries_doctor_id_idx').on(t.doctorId),
    offeredAppointmentIdx: index('waitlist_entries_offered_appointment_idx').on(
      t.offeredAppointmentId,
    ),
    preferredPeriodChk: check(
      'waitlist_entries_preferred_period_chk',
      sql`${t.preferredUntil} IS NULL OR ${t.preferredFrom} IS NULL OR ${t.preferredUntil} >= ${t.preferredFrom}`,
    ),
  }),
);

export type WaitlistEntryRow = typeof waitlistEntries.$inferSelect;

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
    // D9 (A6/N1): idem procedure_history — RLS filtra clinic_id e o composto
    // abaixo lidera por appointment_id, então não cobre.
    clinicIdx: index('appointment_state_log_clinic_id_idx').on(t.clinicId),
    appointmentTransitionedIdx: index('appointment_state_log_appt_transitioned_idx').on(
      t.appointmentId,
      t.transitionedAt,
    ),
  }),
);

export type AppointmentStateLogRow = typeof appointmentStateLog.$inferSelect;
export type AppointmentStateLogInsert = typeof appointmentStateLog.$inferInsert;

// --- appointment_corrections (trilha excepcional, sempre com motivo) ------

export const appointmentCorrections = pgTable(
  'appointment_corrections',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id, { onDelete: 'cascade' }),
    kind: appointmentRecoveryKind('kind').notNull(),
    fromStatus: appointmentStatus('from_status').notNull(),
    toStatus: appointmentStatus('to_status').notNull(),
    oldDoctorId: uuid('old_doctor_id').notNull(),
    newDoctorId: uuid('new_doctor_id'),
    reason: text('reason').notNull(),
    correctedBy: uuid('corrected_by'),
    doctorAbsenceId: uuid('doctor_absence_id').references(() => doctorAbsences.id, {
      onDelete: 'restrict',
    }),
    correctedAt: timestamp('corrected_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    clinicIdx: index('appointment_corrections_clinic_id_idx').on(t.clinicId),
    appointmentIdx: index('appointment_corrections_appointment_idx').on(
      t.appointmentId,
      t.correctedAt,
    ),
    doctorAbsenceIdx: index('appointment_corrections_doctor_absence_idx').on(t.doctorAbsenceId),
    reasonChk: check('appointment_corrections_reason_chk', sql`length(trim(${t.reason})) > 0`),
  }),
);

export type AppointmentCorrectionRow = typeof appointmentCorrections.$inferSelect;
