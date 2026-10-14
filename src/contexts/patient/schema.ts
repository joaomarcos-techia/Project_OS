/**
 * Patient context schema (C5) — the first production business context.
 *
 * Categoria (ADR-007 §10): all tables tenant-scoped (clinic_id FK CASCADE).
 * RLS policies, triggers and indexes live in the migration that creates these
 * tables (drizzle/migrations/0011_patient_core.sql) — see defaultTenantPolicy().
 *
 * Encryption (ADR-012 / PlanoAção §5):
 *   - `*_encrypted` columns hold base64( version || nonce || ciphertext || tag )
 *     produced by src/lib/crypto. They are OPAQUE to SQL — never indexed,
 *     never searched with LIKE.
 *   - `*_hash` columns hold HMAC-SHA-256(plaintext, globalSalt) hex — the ONLY
 *     searchable representation of CPF / telefone.
 *
 * Architect-mandated deviations from PlanoAção §5.2 (recorded in ADR-012/013):
 *   - suppression_list is DECOUPLED from patients (no patient_id / FK) so it
 *     survives the hard-delete cascade (test 5.6.5). Keyed by contact_hash.
 *   - email is stored normalized (lowercase+trim); UNIQUE per clinic.
 *   - patient_addresses.principal is NOT NULL DEFAULT false.
 *   - patient_clinical_data stays here per spec but C7 becomes its owner (ADR-013).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// eslint-disable-next-line boundaries/element-types -- D35: tenantIdRef + clinics FK ref live in tenancy schema by design (C2 contract); same exception identity/schema.ts uses.
import { tenantIdRef } from '@/contexts/tenancy';
import { deletedAt, timestampsPattern, uuidPk } from '@/lib/db/types';

// Side-effect: registers patient.* event schemas in the outbox catalog at
// module load. Co-located here (intra-context import) so the schema barrel
// only re-exports tables (lib→context re-export is the sanctioned exception),
// while the catalog is still populated wherever this schema is imported.
import './events';

// --- enums -----------------------------------------------------------------

export const patientSexo = pgEnum('patient_sexo', ['M', 'F', 'O', 'N']);
export const patientAddressTipo = pgEnum('patient_address_tipo', [
  'residencial',
  'comercial',
  'alternativo',
]);
export const suppressionChannel = pgEnum('suppression_channel', ['whatsapp', 'email', 'sms']);
export const consentPurpose = pgEnum('consent_purpose', [
  'dados_saude',
  'compartilhamento',
  'agendamento_whatsapp',
  'cobranca_whatsapp',
  'marketing',
  'pesquisa',
  // ADR-049 (1.2): aceite da política de cancelamento/sinal. O paciente precisa
  // ter concordado ANTES de o sistema reter dinheiro por falta — sem esse aceite,
  // reter é surpresa, não regra combinada. Enum estendido na migration 0082.
  'politica_cancelamento',
]);

/**
 * Todo propósito que PODE existir na tabela — superconjunto do `ConsentType`
 * (types.ts), que lista só os que o usuário liga/desliga no cadastro do paciente.
 * `politica_cancelamento` é aceite de fluxo (acontece no agendamento, ADR-049) e
 * de propósito NÃO entra no `ConsentType`: ninguém deve poder alterá-lo por um
 * toggle na ficha, e a UI de consentimentos não deve exibi-lo como opção.
 */
export type StoredConsentPurpose = (typeof consentPurpose.enumValues)[number];
export const suppressionPurpose = pgEnum('suppression_purpose', [
  'all',
  'billing',
  'reminder',
  'followup',
  'marketing',
]);
export const lgpdRequestType = pgEnum('lgpd_request_type', ['export', 'delete']);
export const lgpdRequestStatus = pgEnum('lgpd_request_status', [
  'pending',
  'processing',
  'completed',
  'failed',
]);
export const lgpdHistoryAction = pgEnum('lgpd_history_action', [
  'created',
  'assigned',
  'status_changed',
  'notified',
]);
export const lgpdNotificationChannel = pgEnum('lgpd_notification_channel', [
  'email',
  'whatsapp',
  'phone',
  'in_person',
]);
export const patientRelationshipType = pgEnum('patient_relationship_type', [
  'mae',
  'pai',
  'tutor_legal',
  'responsavel',
  'outro',
]);

// --- patients --------------------------------------------------------------

export const patients = pgTable(
  'patients',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    nome: text('nome').notNull(),
    // Sensitive — encrypted at rest. cpf_hash is the searchable surrogate.
    cpfEncrypted: text('cpf_encrypted').notNull(),
    cpfHash: text('cpf_hash').notNull(),
    telefoneEncrypted: text('telefone_encrypted'),
    telefoneHash: text('telefone_hash'),
    // Normalized (lowercase+trim) before persist; plaintext is acceptable.
    // C12 (ADR-023): opcional — paciente cadastrado pelo AI Agent (WhatsApp) não
    // tem e-mail (coleta = nome/cpf/telefone/motivo). Unicidade vira PARCIAL.
    email: text('email'),
    dataNascimento: date('data_nascimento'),
    sexo: patientSexo('sexo'),
    obitoEm: date('obito_em'),
    // Cross-context caches, populated by event handlers (never via JOIN).
    lastAppointmentAt: timestamp('last_appointment_at', { withTimezone: true }),
    lastVisitAt: timestamp('last_visit_at', { withTimezone: true }),
    // F-02 / ADR-021: setado quando o hard-delete LGPD é bloqueado pelo FK
    // RESTRICT clínico (ADR-017) e o cadastro é ANONIMIZADO in-place no lugar
    // de deletado. O scan do cron exclui anonimizados (senão re-tenta para
    // sempre). NULL = paciente normal. Aditivo/nullable — backward compatible.
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),
    mergedIntoPatientId: uuid('merged_into_patient_id'),
    mergedAt: timestamp('merged_at', { withTimezone: true }),
    mergedBy: uuid('merged_by'),
    ...timestampsPattern(),
    deletedAt: deletedAt(),
  },
  (t) => ({
    clinicIdx: index('patients_clinic_id_idx').on(t.clinicId),
    // Same CPF may exist in N clinics, but is unique within one (test 5.6.9).
    clinicCpfUniq: uniqueIndex('patients_clinic_cpf_uniq').on(t.clinicId, t.cpfHash),
    clinicPhoneIdx: index('patients_clinic_phone_idx').on(t.clinicId, t.telefoneHash),
    // Parcial: unicidade só quando há e-mail (NULLs do agente não colidem).
    clinicEmailUniq: uniqueIndex('patients_clinic_email_uniq')
      .on(t.clinicId, t.email)
      .where(sql`email IS NOT NULL`),
    // Name search + active-only listing (GIN trigram added in the migration).
    clinicNomeIdx: index('patients_clinic_nome_idx').on(t.clinicId, t.nome),
    activeIdx: index('patients_active_idx')
      .on(t.clinicId)
      .where(sql`deleted_at IS NULL`),
    // F-15: serves the default listing (clinic scope + ORDER BY updated_at) on
    // active rows — a btree (clinic_id, updated_at) is scanned backward for DESC.
    clinicUpdatedIdx: index('patients_clinic_updated_idx')
      .on(t.clinicId, t.updatedAt)
      .where(sql`deleted_at IS NULL`),
  }),
);

// --- patient_consents ------------------------------------------------------

export const patientConsents = pgTable(
  'patient_consents',
  {
    id: uuidPk(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    clinicId: tenantIdRef(),
    dadosSaude: boolean('dados_saude').notNull().default(false),
    compartilhamento: boolean('compartilhamento').notNull().default(false),
    cobrancaWhatsapp: boolean('cobranca_whatsapp').notNull().default(false),
    marketing: boolean('marketing').notNull().default(false),
    pesquisa: boolean('pesquisa').notNull().default(false),
    versao: integer('versao').notNull(),
    dataAceite: timestamp('data_aceite', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    clinicIdx: index('patient_consents_clinic_id_idx').on(t.clinicId),
    patientIdx: index('patient_consents_patient_id_idx').on(t.patientId),
    versaoChk: check('patient_consents_versao_chk', sql`${t.versao} > 0`),
  }),
);

// --- patient_relationships ------------------------------------------------

export const patientRelationships = pgTable(
  'patient_relationships',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    responsiblePatientId: uuid('responsible_patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    dependentPatientId: uuid('dependent_patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    relationshipType: patientRelationshipType('relationship_type').notNull(),
    legalGuardian: boolean('legal_guardian').notNull().default(false),
    financialResponsible: boolean('financial_responsible').notNull().default(false),
    canManageAppointments: boolean('can_manage_appointments').notNull().default(false),
    createdBy: uuid('created_by'),
    ...timestampsPattern(),
  },
  (t) => ({
    relationshipUniq: unique('patient_relationships_pair_uniq').on(
      t.responsiblePatientId,
      t.dependentPatientId,
    ),
    responsibleIdx: index('patient_relationships_responsible_idx').on(t.responsiblePatientId),
    dependentIdx: index('patient_relationships_dependent_idx').on(t.dependentPatientId),
    noSelfRelationship: check(
      'patient_relationships_no_self_chk',
      sql`${t.responsiblePatientId} <> ${t.dependentPatientId}`,
    ),
  }),
);

// --- patient_merges -------------------------------------------------------

export const patientMerges = pgTable(
  'patient_merges',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    sourcePatientId: uuid('source_patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    targetPatientId: uuid('target_patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    mergedBy: uuid('merged_by').notNull(),
    transferCounts: jsonb('transfer_counts')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    sourceUniq: unique('patient_merges_source_uniq').on(t.sourcePatientId),
    clinicIdx: index('patient_merges_clinic_id_idx').on(t.clinicId),
    targetIdx: index('patient_merges_target_idx').on(t.targetPatientId),
    noSelfMerge: check(
      'patient_merges_no_self_chk',
      sql`${t.sourcePatientId} <> ${t.targetPatientId}`,
    ),
  }),
);

export const patientConsentDecisions = pgTable(
  'patient_consent_decisions',
  {
    id: uuidPk(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    clinicId: tenantIdRef(),
    purpose: consentPurpose('purpose').notNull(),
    channel: suppressionChannel('channel'),
    granted: boolean('granted').notNull(),
    version: integer('version').notNull(),
    recordedBy: uuid('recorded_by'),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    clinicIdx: index('patient_consent_decisions_clinic_id_idx').on(t.clinicId),
    patientPurposeIdx: index('patient_consent_decisions_patient_purpose_idx').on(
      t.patientId,
      t.purpose,
      t.channel,
      t.version,
    ),
    versionUniq: unique('patient_consent_decisions_version_uniq')
      .on(t.patientId, t.purpose, t.channel, t.version)
      .nullsNotDistinct(),
    versionChk: check('patient_consent_decisions_version_chk', sql`${t.version} > 0`),
  }),
);

// --- patient_clinical_data (ADR-013: future owner = C7) --------------------

export const patientClinicalData = pgTable(
  'patient_clinical_data',
  {
    id: uuidPk(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    clinicId: tenantIdRef(),
    alergias: jsonb('alergias')
      .notNull()
      .default(sql`'[]'::jsonb`),
    medicamentosEmUso: jsonb('medicamentos_em_uso')
      .notNull()
      .default(sql`'[]'::jsonb`),
    doencasCronicas: jsonb('doencas_cronicas')
      .notNull()
      .default(sql`'[]'::jsonb`),
    tipoSanguineo: text('tipo_sanguineo'),
    observacoes: text('observacoes'),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicIdx: index('patient_clinical_data_clinic_id_idx').on(t.clinicId),
    patientUniq: uniqueIndex('patient_clinical_data_patient_uniq').on(t.patientId),
  }),
);

// --- patient_addresses -----------------------------------------------------

export const patientAddresses = pgTable(
  'patient_addresses',
  {
    id: uuidPk(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    clinicId: tenantIdRef(),
    tipo: patientAddressTipo('tipo').notNull().default('residencial'),
    logradouroEncrypted: text('logradouro_encrypted').notNull(),
    cidade: text('cidade').notNull(),
    estado: text('estado').notNull(),
    cepEncrypted: text('cep_encrypted').notNull(),
    complemento: text('complemento'),
    principal: boolean('principal').notNull().default(false),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicIdx: index('patient_addresses_clinic_id_idx').on(t.clinicId),
    patientIdx: index('patient_addresses_patient_id_idx').on(t.patientId),
    // At most one principal address per patient.
    onePrincipalUniq: uniqueIndex('patient_addresses_one_principal_uniq')
      .on(t.patientId)
      .where(sql`principal = true`),
  }),
);

// --- patient_emergency_contacts --------------------------------------------

export const patientEmergencyContacts = pgTable(
  'patient_emergency_contacts',
  {
    id: uuidPk(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    clinicId: tenantIdRef(),
    nome: text('nome').notNull(),
    telefoneEncrypted: text('telefone_encrypted').notNull(),
    relacao: text('relacao').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    clinicIdx: index('patient_emergency_contacts_clinic_id_idx').on(t.clinicId),
    patientIdx: index('patient_emergency_contacts_patient_id_idx').on(t.patientId),
  }),
);

// --- suppression_list (DECOUPLED — no patient FK, survives hard delete) -----

export const suppressionList = pgTable(
  'suppression_list',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    // HMAC of the normalized phone (whatsapp/sms) or email (email channel).
    contactHash: text('contact_hash').notNull(),
    channel: suppressionChannel('channel').notNull(),
    purpose: suppressionPurpose('purpose').notNull().default('all'),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    clinicIdx: index('suppression_list_clinic_id_idx').on(t.clinicId),
    contactChannelUniq: unique('suppression_list_contact_channel_purpose_uniq').on(
      t.clinicId,
      t.contactHash,
      t.channel,
      t.purpose,
    ),
  }),
);

// --- lgpd_requests ---------------------------------------------------------

export const lgpdRequests = pgTable(
  'lgpd_requests',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    // No FK: a delete request must outlive the patient it erases.
    patientId: uuid('patient_id').notNull(),
    type: lgpdRequestType('type').notNull(),
    status: lgpdRequestStatus('status').notNull().default('pending'),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    dueAt: timestamp('due_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '15 days'`),
    assignedToUserId: uuid('assigned_to_user_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    statusReason: text('status_reason'),
    requesterNotifiedAt: timestamp('requester_notified_at', { withTimezone: true }),
    requesterNotificationChannel: lgpdNotificationChannel('requester_notification_channel'),
    lastUpdatedByUserId: uuid('last_updated_by_user_id'),
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
    fulfilledByUserId: uuid('fulfilled_by_user_id'),
    exportSignedUrl: text('export_signed_url'),
    exportSignedUrlExpiresAt: timestamp('export_signed_url_expires_at', { withTimezone: true }),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicIdx: index('lgpd_requests_clinic_id_idx').on(t.clinicId),
    patientIdx: index('lgpd_requests_patient_id_idx').on(t.patientId),
    statusIdx: index('lgpd_requests_status_idx').on(t.status),
    dueIdx: index('lgpd_requests_due_idx').on(t.clinicId, t.dueAt),
  }),
);

export const lgpdRequestHistory = pgTable(
  'lgpd_request_history',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => lgpdRequests.id, { onDelete: 'cascade' }),
    action: lgpdHistoryAction('action').notNull(),
    fromStatus: lgpdRequestStatus('from_status'),
    toStatus: lgpdRequestStatus('to_status'),
    assignedToUserId: uuid('assigned_to_user_id'),
    notificationChannel: lgpdNotificationChannel('notification_channel'),
    note: text('note'),
    changedByUserId: uuid('changed_by_user_id'),
    changedAt: timestamp('changed_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    clinicIdx: index('lgpd_request_history_clinic_id_idx').on(t.clinicId),
    requestIdx: index('lgpd_request_history_request_idx').on(t.requestId, t.changedAt),
  }),
);

// --- inferred row types ----------------------------------------------------

export type PatientRow = typeof patients.$inferSelect;
export type PatientInsert = typeof patients.$inferInsert;
export type PatientConsentRow = typeof patientConsents.$inferSelect;
export type PatientConsentDecisionRow = typeof patientConsentDecisions.$inferSelect;
export type PatientClinicalDataRow = typeof patientClinicalData.$inferSelect;
export type PatientAddressRow = typeof patientAddresses.$inferSelect;
export type PatientEmergencyContactRow = typeof patientEmergencyContacts.$inferSelect;
export type PatientRelationshipRow = typeof patientRelationships.$inferSelect;
export type PatientMergeRow = typeof patientMerges.$inferSelect;
export type SuppressionListRow = typeof suppressionList.$inferSelect;
export type LgpdRequestRow = typeof lgpdRequests.$inferSelect;
export type LgpdRequestHistoryRow = typeof lgpdRequestHistory.$inferSelect;
