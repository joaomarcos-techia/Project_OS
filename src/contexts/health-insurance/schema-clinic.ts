/**
 * Tabelas por clínica do convênio — migration 0144 (P1.4; ADR-072).
 *
 * O SQL é a fonte de verdade das regras (CHECKs, FKs compostas, gatilhos e
 * RLS); este arquivo dá ao Drizzle os tipos e as colunas, com os mesmos nomes.
 * Integridade entre tabelas da mesma clínica por FK composta `(clinic_id, id)`:
 * uma FK simples deixaria uma linha apontar para a operadora de outra clínica.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// eslint-disable-next-line boundaries/element-types -- D35: tenantIdRef (FK + ON DELETE CASCADE para clinics) vive no schema de tenancy por design (mesma exceção de financial/identity/scheduling/clinical).
import { tenantIdRef } from '@/contexts/tenancy';
import { timestampsPattern, uuidPk } from '@/lib/db/types';

const createdAt = () =>
  timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`);

export const hiClinicSettings = pgTable('hi_clinic_settings', {
  clinicId: tenantIdRef().primaryKey(),
  /** Feature flag por clínica. Nasce desligada; nada é ligado por padrão (D8). */
  enabled: boolean('enabled').notNull().default(false),
  enabledAt: timestamp('enabled_at', { withTimezone: true }),
  enabledBy: uuid('enabled_by'),
  providerKind: text('provider_kind').$type<'PF' | 'PJ'>(),
  contractorName: text('contractor_name'),
  cnes: text('cnes'),
  cnesStatus: text('cnes_status').$type<'unknown' | 'has' | 'none_declared'>().notNull(),
  ...timestampsPattern(),
});

export type HiCounterKind = 'guide' | 'batch' | 'transaction' | 'appeal';

export const hiCounters = pgTable(
  'hi_counters',
  {
    clinicId: tenantIdRef(),
    kind: text('kind').$type<HiCounterKind>().notNull(),
    scopeKey: text('scope_key').notNull().default(''),
    lastValue: bigint('last_value', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ name: 'hi_counters_pk', columns: [t.clinicId, t.kind, t.scopeKey] }),
  }),
);

export type HiProviderIdKind = 'codigoPrestadorNaOperadora' | 'cnpjContratado' | 'cpfContratado';

export const hiInsurers = pgTable(
  'hi_insurers',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    name: text('name').notNull(),
    /** Registro ANS da operadora (6 dígitos). */
    registroAns: text('registro_ans').notNull(),
    status: text('status').$type<'draft' | 'active' | 'suspended' | 'archived'>().notNull(),
    providerIdKind: text('provider_id_kind').$type<HiProviderIdKind>().notNull(),
    providerIdValue: text('provider_id_value').notNull(),
    tissVersion: text('tiss_version').$type<'4.03.00'>().notNull(),
    connectorKind: text('connector_kind').$type<'manual' | 'soap'>().notNull(),
    /** Validado por Zod na aplicação; o banco só garante que é objeto. */
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull(),
    createdBy: uuid('created_by').notNull(),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicIdUniq: unique('hi_insurers_clinic_id_uniq').on(t.clinicId, t.id),
    ansUniq: unique('hi_insurers_ans_uniq').on(t.clinicId, t.registroAns),
    clinicStatusIdx: index('hi_insurers_clinic_status_idx').on(t.clinicId, t.status),
  }),
);

export const hiInsurerCredentials = pgTable(
  'hi_insurer_credentials',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    insurerId: uuid('insurer_id').notNull(),
    kind: text('kind').$type<'webservice_login' | 'certificate'>().notNull(),
    /** Só ciphertext de `encryptForTenant`; o claro é do adapter (P12.5). */
    usernameEncrypted: text('username_encrypted'),
    secretEncrypted: text('secret_encrypted').notNull(),
    status: text('status').$type<'active' | 'revoked'>().notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull(),
    ...timestampsPattern(),
  },
  (t) => ({
    insurerFk: foreignKey({
      name: 'hi_insurer_credentials_insurer_fk',
      columns: [t.clinicId, t.insurerId],
      foreignColumns: [hiInsurers.clinicId, hiInsurers.id],
    }).onDelete('cascade'),
  }),
);

export const hiPlans = pgTable(
  'hi_plans',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    insurerId: uuid('insurer_id').notNull(),
    name: text('name').notNull(),
    operatorCode: text('operator_code'),
    category: text('category').$type<'ambulatorial' | 'hospitalar' | 'referencia' | 'outro'>(),
    status: text('status').$type<'active' | 'archived'>().notNull(),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicIdUniq: unique('hi_plans_clinic_id_uniq').on(t.clinicId, t.id),
    nameUniq: unique('hi_plans_name_uniq').on(t.clinicId, t.insurerId, t.name),
    insurerFk: foreignKey({
      name: 'hi_plans_insurer_fk',
      columns: [t.clinicId, t.insurerId],
      foreignColumns: [hiInsurers.clinicId, hiInsurers.id],
    }).onDelete('cascade'),
  }),
);

export const hiProfessionalProfiles = pgTable(
  'hi_professional_profiles',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    /** `profiles.id`; sem FK, como no financeiro. Gatilho confere a mesma clínica. */
    professionalId: uuid('professional_id').notNull(),
    /** Tabela 26. */
    council: text('council').notNull(),
    councilNumber: text('council_number').notNull(),
    /** Tabela 59 (código numérico da UF). */
    councilUf: text('council_uf').notNull(),
    /** Tabela 24. `999999` não serve para o executante. */
    cbo: text('cbo').notNull(),
    ...timestampsPattern(),
  },
  (t) => ({ uniq: unique('hi_professional_profiles_uniq').on(t.clinicId, t.professionalId) }),
);

export const hiCredentials = pgTable(
  'hi_credentials',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    insurerId: uuid('insurer_id').notNull(),
    planId: uuid('plan_id'),
    /** `null` = credenciamento da clínica. */
    professionalId: uuid('professional_id'),
    providerCode: text('provider_code'),
    validFrom: date('valid_from').notNull(),
    validUntil: date('valid_until'),
    status: text('status').$type<'active' | 'suspended' | 'ended'>().notNull(),
    createdBy: uuid('created_by').notNull(),
    ...timestampsPattern(),
  },
  (t) => ({
    insurerFk: foreignKey({
      name: 'hi_credentials_insurer_fk',
      columns: [t.clinicId, t.insurerId],
      foreignColumns: [hiInsurers.clinicId, hiInsurers.id],
    }).onDelete('cascade'),
    planFk: foreignKey({
      name: 'hi_credentials_plan_fk',
      columns: [t.clinicId, t.planId],
      foreignColumns: [hiPlans.clinicId, hiPlans.id],
    }).onDelete('cascade'),
    clinicInsurerIdx: index('hi_credentials_clinic_insurer_idx').on(
      t.clinicId,
      t.insurerId,
      t.status,
    ),
  }),
);

export const hiContractImports = pgTable(
  'hi_contract_imports',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    insurerId: uuid('insurer_id').notNull(),
    fileName: text('file_name').notNull(),
    fileSha256: text('file_sha256').notNull(),
    rowCount: integer('row_count').notNull(),
    acceptedCount: integer('accepted_count').notNull(),
    rejectedCount: integer('rejected_count').notNull(),
    status: text('status').$type<'validated' | 'applied' | 'rejected'>().notNull(),
    /** Contagens e códigos de erro; nunca dado pessoal. */
    summary: jsonb('summary').$type<Record<string, unknown>>().notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
  },
  (t) => ({
    clinicIdUniq: unique('hi_contract_imports_clinic_id_uniq').on(t.clinicId, t.id),
    insurerFk: foreignKey({
      name: 'hi_contract_imports_insurer_fk',
      columns: [t.clinicId, t.insurerId],
      foreignColumns: [hiInsurers.clinicId, hiInsurers.id],
    }).onDelete('cascade'),
  }),
);

export type HiCopayKind = 'none' | 'fixed' | 'percentage';

/** Append-only: UPDATE bloqueado por gatilho; corrigir é nova versão (`supersedesId`). */
export const hiProcedureContracts = pgTable(
  'hi_procedure_contracts',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    insurerId: uuid('insurer_id').notNull(),
    planId: uuid('plan_id'),
    guideType: text('guide_type').$type<'consulta' | 'sp_sadt'>().notNull(),
    /** Tabela 87 (ex.: `22` = TUSS procedimentos). */
    tableCode: text('table_code').notNull(),
    procedureCode: text('procedure_code').notNull(),
    description: text('description').notNull(),
    /** Procedimento do catálogo do Qoro, quando houver (id opaco). */
    procedureId: uuid('procedure_id'),
    unitValueCents: bigint('unit_value_cents', { mode: 'number' }).notNull(),
    validFrom: date('valid_from').notNull(),
    validUntil: date('valid_until'),
    requiresAuthorization: boolean('requires_authorization').notNull().default(false),
    copayKind: text('copay_kind').$type<HiCopayKind>().notNull(),
    copayFixedCents: bigint('copay_fixed_cents', { mode: 'number' }),
    copayPercentage: numeric('copay_percentage', { precision: 5, scale: 2 }),
    returnDays: integer('return_days'),
    returnBillable: boolean('return_billable').notNull().default(false),
    supersedesId: uuid('supersedes_id'),
    importId: uuid('import_id'),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    clinicIdUniq: unique('hi_procedure_contracts_clinic_id_uniq').on(t.clinicId, t.id),
    supersedesOnce: unique('hi_procedure_contracts_supersedes_once').on(t.supersedesId),
    insurerFk: foreignKey({
      name: 'hi_procedure_contracts_insurer_fk',
      columns: [t.clinicId, t.insurerId],
      foreignColumns: [hiInsurers.clinicId, hiInsurers.id],
    }).onDelete('cascade'),
    planFk: foreignKey({
      name: 'hi_procedure_contracts_plan_fk',
      columns: [t.clinicId, t.planId],
      foreignColumns: [hiPlans.clinicId, hiPlans.id],
    }).onDelete('cascade'),
    importFk: foreignKey({
      name: 'hi_procedure_contracts_import_fk',
      columns: [t.clinicId, t.importId],
      foreignColumns: [hiContractImports.clinicId, hiContractImports.id],
    }).onDelete('cascade'),
    lookupIdx: index('hi_procedure_contracts_lookup_idx').on(
      t.clinicId,
      t.insurerId,
      t.tableCode,
      t.procedureCode,
      t.validFrom,
    ),
  }),
);

/**
 * Carteirinhas (0145, P1.5). O número nunca fica em claro: ciphertext por
 * clínica + HMAC de busca por clínica e operadora (D21) + últimos 4. Número,
 * operadora e paciente são imutáveis (gatilho); trocar é nova carteirinha.
 */
export const hiMemberships = pgTable(
  'hi_memberships',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    /** `patients.id`; FK com CASCADE + gatilho de mesma clínica no SQL. */
    patientId: uuid('patient_id').notNull(),
    insurerId: uuid('insurer_id').notNull(),
    planId: uuid('plan_id'),
    cardNumberEncrypted: text('card_number_encrypted').notNull(),
    cardNumberHash: text('card_number_hash').notNull(),
    cardLast4: text('card_last4').notNull(),
    holderKind: text('holder_kind').$type<'titular' | 'dependente'>().notNull(),
    validUntil: date('valid_until'),
    isPreferred: boolean('is_preferred').notNull().default(false),
    status: text('status').$type<'active' | 'inactive' | 'replaced'>().notNull(),
    replacedById: uuid('replaced_by_id'),
    createdBy: uuid('created_by').notNull(),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicIdUniq: unique('hi_memberships_clinic_id_uniq').on(t.clinicId, t.id),
    insurerFk: foreignKey({
      name: 'hi_memberships_insurer_fk',
      columns: [t.clinicId, t.insurerId],
      foreignColumns: [hiInsurers.clinicId, hiInsurers.id],
    }).onDelete('cascade'),
    planFk: foreignKey({
      name: 'hi_memberships_plan_fk',
      columns: [t.clinicId, t.planId],
      foreignColumns: [hiPlans.clinicId, hiPlans.id],
    }).onDelete('cascade'),
    patientIdx: index('hi_memberships_patient_idx').on(t.clinicId, t.patientId, t.status),
  }),
);

export type HiMembershipRow = typeof hiMemberships.$inferSelect;
export type HiInsurerRow = typeof hiInsurers.$inferSelect;
export type HiPlanRow = typeof hiPlans.$inferSelect;
export type HiProcedureContractRow = typeof hiProcedureContracts.$inferSelect;
export type HiCredentialRow = typeof hiCredentials.$inferSelect;
export type HiProfessionalProfileRow = typeof hiProfessionalProfiles.$inferSelect;
export type HiClinicSettingsRow = typeof hiClinicSettings.$inferSelect;
