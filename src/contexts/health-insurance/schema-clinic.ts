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

/**
 * Autorizações (0146, P1.7). O SQL guarda as regras: estado autorizado só com
 * evidência da operadora; senha só cifrada; consumo por lançamento append-only
 * com trava e idempotência; comprovante só como referência + SHA-256.
 */
export type HiAuthorizationStatus =
  | 'draft'
  | 'requested'
  | 'pending_operator'
  | 'authorized'
  | 'partially_authorized'
  | 'denied'
  | 'expired'
  | 'cancelled';

export const hiAuthorizations = pgTable('hi_authorizations', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  insurerId: uuid('insurer_id').notNull(),
  planId: uuid('plan_id'),
  membershipId: uuid('membership_id').notNull(),
  guideType: text('guide_type').$type<'consulta' | 'sp_sadt'>().notNull(),
  status: text('status').$type<HiAuthorizationStatus>().notNull(),
  origin: text('origin').$type<'manual' | 'connector'>().notNull(),
  requestedOn: date('requested_on'),
  operatorGuideNumber: text('operator_guide_number'),
  operatorProtocol: text('operator_protocol'),
  /** Ciphertext de encryptForTenant; nunca em claro. */
  passwordEncrypted: text('password_encrypted'),
  authorizedOn: date('authorized_on'),
  passwordValidUntil: date('password_valid_until'),
  connectorReceipt: jsonb('connector_receipt').$type<Record<string, unknown>>(),
  denialReason: text('denial_reason'),
  recordedBy: uuid('recorded_by'),
  version: integer('version').notNull().default(1),
  createdBy: uuid('created_by').notNull(),
  ...timestampsPattern(),
});

export const hiAuthorizationItems = pgTable('hi_authorization_items', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  authorizationId: uuid('authorization_id').notNull(),
  tableCode: text('table_code').notNull(),
  procedureCode: text('procedure_code').notNull(),
  quantityRequested: integer('quantity_requested').notNull(),
  quantityAuthorized: integer('quantity_authorized').notNull().default(0),
  /** Só o gatilho de consumo altera; o runtime não tem UPDATE nesta coluna. */
  quantityConsumed: integer('quantity_consumed').notNull().default(0),
  ...timestampsPattern(),
});

export const hiAuthorizationConsumptions = pgTable('hi_authorization_consumptions', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  itemId: uuid('item_id').notNull(),
  /** Positivo = consumo; negativo = estorno de `reversesId`. */
  quantity: integer('quantity').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  reversesId: uuid('reverses_id'),
  overrunReason: text('overrun_reason'),
  overrunApprovedBy: uuid('overrun_approved_by'),
  createdBy: uuid('created_by').notNull(),
  createdAt: createdAt(),
});

export const hiAuthorizationAttachments = pgTable('hi_authorization_attachments', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  authorizationId: uuid('authorization_id').notNull(),
  /** `<clinic_id>/<uuid>` no armazenamento privado; bytes cifrados fora do banco. */
  storageRef: text('storage_ref').notNull(),
  contentSha256: text('content_sha256').notNull(),
  ciphertextSha256: text('ciphertext_sha256').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  mediaType: text('media_type').notNull(),
  uploadedBy: uuid('uploaded_by').notNull(),
  createdAt: createdAt(),
});

export const hiAuthorizationEvents = pgTable('hi_authorization_events', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  authorizationId: uuid('authorization_id').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  actorId: uuid('actor_id'),
  note: text('note'),
  createdAt: createdAt(),
});

/**
 * Guias TISS (0147, P1.8). O SQL guarda as regras: estado com transições
 * editoriais do runtime e as de lote/envio/retorno/substituição só por código do
 * banco com dono; conteúdo congelado depois da conferência; item só do contrato
 * vigente; sem cobrança dupla (SP/SADT agrupada permitida); snapshot cifrado,
 * histórico gravado pelo banco e arquivos append-only.
 */
export type HiGuideStatus =
  | 'pending_data'
  | 'ready_for_review'
  | 'reviewed'
  | 'approved'
  | 'in_batch'
  | 'exported'
  | 'sent'
  | 'under_review'
  | 'paid'
  | 'partially_paid'
  | 'partially_glossed'
  | 'fully_glossed'
  | 'closed'
  | 'cancelled'
  | 'replaced';

export type HiGuideType = 'consulta' | 'sp_sadt';
export type HiCreatedVia = 'user' | 'automation';

export const hiGuides = pgTable('hi_guides', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  guideType: text('guide_type').$type<HiGuideType>().notNull(),
  /** `numeroGuiaPrestador`, alocado por P7.1 na mesma transação. Imutável. */
  number: text('number').notNull(),
  insurerId: uuid('insurer_id').notNull(),
  planId: uuid('plan_id'),
  patientId: uuid('patient_id').notNull(),
  membershipId: uuid('membership_id'),
  authorizationId: uuid('authorization_id'),
  executantProfessionalId: uuid('executant_professional_id'),
  requesterProfessionalId: uuid('requester_professional_id'),
  mainGuideId: uuid('main_guide_id'),
  replacesGuideId: uuid('replaces_guide_id'),
  status: text('status').$type<HiGuideStatus>().notNull(),
  /** Mantido pelo gatilho: a guia "segura" os atendimentos dela contra outra cobrança. */
  live: boolean('live').notNull(),
  revision: integer('revision').notNull(),
  version: integer('version').notNull(),
  tissVersion: text('tiss_version').$type<'4.03.00'>().notNull(),
  terminologyVersion: text('terminology_version'),
  /** Pendências (código, campo, responsável, mensagem); nunca dado pessoal. */
  issues: jsonb('issues')
    .$type<Array<{ code: string; field: string; owner: string; message: string }>>()
    .notNull(),
  expectedValueCents: bigint('expected_value_cents', { mode: 'number' }),
  totalValueCents: bigint('total_value_cents', { mode: 'number' }).notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewedBy: uuid('reviewed_by'),
  approvedSnapshotId: uuid('approved_snapshot_id'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: uuid('approved_by'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledBy: uuid('cancelled_by'),
  cancelReason: text('cancel_reason'),
  /** Nota da transição corrente (motivo da reabertura etc.); vai para o histórico. */
  transitionNote: text('transition_note'),
  createdVia: text('created_via').$type<HiCreatedVia>().notNull(),
  createdBy: uuid('created_by'),
  ...timestampsPattern(),
});

export const hiGuideSnapshots = pgTable('hi_guide_snapshots', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  guideId: uuid('guide_id').notNull(),
  revision: integer('revision').notNull(),
  /** encryptForTenant do JSON canônico da guia emitida (tem a carteirinha). */
  contentEncrypted: text('content_encrypted').notNull(),
  /** SHA-256 do JSON canônico em claro. */
  contentSha256: text('content_sha256').notNull(),
  tissVersion: text('tiss_version').notNull(),
  terminologyVersion: text('terminology_version').notNull(),
  createdVia: text('created_via').$type<HiCreatedVia>().notNull(),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
});

export const hiGuideItems = pgTable('hi_guide_items', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  guideId: uuid('guide_id').notNull(),
  /** Espelhos da guia, mantidos pelo banco. */
  guideType: text('guide_type').$type<HiGuideType>().notNull(),
  live: boolean('live').notNull(),
  sequence: integer('sequence').notNull(),
  appointmentId: uuid('appointment_id'),
  contractLineId: uuid('contract_line_id').notNull(),
  authorizationItemId: uuid('authorization_item_id'),
  executedOn: date('executed_on').notNull(),
  startTime: text('start_time'),
  endTime: text('end_time'),
  tableCode: text('table_code').notNull(),
  procedureCode: text('procedure_code').notNull(),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull(),
  accessRoute: text('access_route'),
  technique: text('technique'),
  factorHundredths: integer('factor_hundredths').notNull().default(100),
  unitValueCents: bigint('unit_value_cents', { mode: 'number' }).notNull(),
  totalValueCents: bigint('total_value_cents', { mode: 'number' }).notNull(),
  ...timestampsPattern(),
});

export const hiGuideEvents = pgTable('hi_guide_events', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  guideId: uuid('guide_id').notNull(),
  fromStatus: text('from_status').$type<HiGuideStatus>(),
  toStatus: text('to_status').$type<HiGuideStatus>().notNull(),
  revision: integer('revision').notNull(),
  /** Só NOMES de colunas; valores nunca entram no histórico. */
  changedFields: text('changed_fields').array().notNull(),
  actorId: uuid('actor_id'),
  actorKind: text('actor_kind').$type<'user' | 'system'>().notNull(),
  note: text('note'),
  createdAt: createdAt(),
});

export type HiFileKind = 'guide_pdf' | 'authorization_request_xml' | 'authorization_request_pdf';

export const hiFiles = pgTable('hi_files', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  kind: text('kind').$type<HiFileKind>().notNull(),
  guideId: uuid('guide_id'),
  snapshotId: uuid('snapshot_id'),
  authorizationId: uuid('authorization_id'),
  supersedesFileId: uuid('supersedes_file_id'),
  /** `<clinic_id>/<uuid>` no armazenamento privado; bytes cifrados fora do banco (D20). */
  storageRef: text('storage_ref').notNull(),
  contentSha256: text('content_sha256').notNull(),
  ciphertextSha256: text('ciphertext_sha256').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  mediaType: text('media_type').notNull(),
  tissVersion: text('tiss_version').notNull(),
  createdVia: text('created_via').$type<HiCreatedVia>().notNull(),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
});

/**
 * Cobertura do atendimento (0148, P1.6): 1 por atendimento, congelada quando o
 * atendimento começa. Gatilho confere paciente, carteirinha, contrato e
 * autorização; "pronta" só sem pendência e com autorização quando exigida.
 */
export type HiCoverageStatus =
  | 'incomplete'
  | 'pending_authorization'
  | 'authorization_recorded'
  | 'authorization_denied'
  | 'ready'
  | 'cancelled';

export const hiAppointmentCoverages = pgTable('hi_appointment_coverages', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  appointmentId: uuid('appointment_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  guideType: text('guide_type').$type<HiGuideType>().notNull(),
  insurerId: uuid('insurer_id').notNull(),
  planId: uuid('plan_id'),
  membershipId: uuid('membership_id'),
  contractLineId: uuid('contract_line_id'),
  authorizationRequirement: text('authorization_requirement')
    .$type<'unknown' | 'not_required' | 'required'>()
    .notNull(),
  authorizationId: uuid('authorization_id'),
  status: text('status').$type<HiCoverageStatus>().notNull(),
  issues: jsonb('issues')
    .$type<Array<{ code: string; field: string; owner: string; message: string }>>()
    .notNull(),
  expectedValueCents: bigint('expected_value_cents', { mode: 'number' }),
  version: integer('version').notNull(),
  createdVia: text('created_via').$type<HiCreatedVia>().notNull(),
  createdBy: uuid('created_by'),
  ...timestampsPattern(),
});

/**
 * Coparticipação (0148): os seis valores ficam separados. Nada é cobrado sem
 * confirmação; o recebível do paciente só nasce do valor cobrável confirmado (e o
 * banco recusa qualquer recebível de convênio acima dele).
 */
export type HiCopayStatus =
  | 'estimated'
  | 'calculated'
  | 'checked'
  | 'confirmed'
  | 'charged'
  | 'paid'
  | 'refunded'
  | 'waived'
  | 'cancelled';

export const hiCopayments = pgTable('hi_copayments', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  coverageId: uuid('coverage_id').notNull(),
  appointmentId: uuid('appointment_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  kind: text('kind').$type<'fixed' | 'percentage'>().notNull(),
  /** `numeric(5,2)` vem como texto do driver. */
  percentage: numeric('percentage', { precision: 5, scale: 2 }),
  /** Previsto no agendamento (contrato). */
  expectedCents: bigint('expected_cents', { mode: 'number' }).notNull(),
  /** Calculado na conclusão (contrato × itens da guia). */
  calculatedCents: bigint('calculated_cents', { mode: 'number' }),
  /** Conferido pela recepção. */
  checkedCents: bigint('checked_cents', { mode: 'number' }),
  /** Confirmado por quem tem a permissão. */
  confirmedCents: bigint('confirmed_cents', { mode: 'number' }),
  /** Cobrável: o teto do recebível do paciente. */
  chargeableCents: bigint('chargeable_cents', { mode: 'number' }),
  /** Recebido (espelho do financeiro, P10.5). */
  receivedCents: bigint('received_cents', { mode: 'number' }).notNull(),
  status: text('status').$type<HiCopayStatus>().notNull(),
  checkedBy: uuid('checked_by'),
  checkedAt: timestamp('checked_at', { withTimezone: true }),
  confirmedBy: uuid('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  waiveReason: text('waive_reason'),
  chargeRef: uuid('charge_ref'),
  transitionNote: text('transition_note'),
  version: integer('version').notNull(),
  ...timestampsPattern(),
});

export type HiGuideRow = typeof hiGuides.$inferSelect;
export type HiGuideItemRow = typeof hiGuideItems.$inferSelect;
export type HiInsurerRow = typeof hiInsurers.$inferSelect;
export type HiPlanRow = typeof hiPlans.$inferSelect;
export type HiProcedureContractRow = typeof hiProcedureContracts.$inferSelect;
export type HiCredentialRow = typeof hiCredentials.$inferSelect;
export type HiProfessionalProfileRow = typeof hiProfessionalProfiles.$inferSelect;
export type HiClinicSettingsRow = typeof hiClinicSettings.$inferSelect;
