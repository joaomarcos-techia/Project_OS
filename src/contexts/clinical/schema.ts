/**
 * Clinical schema (C7) — 4 tabelas. Prontuário eletrônico com imutabilidade
 * pós-assinatura, versionamento jurídico, prescrições e documentos médicos.
 *
 * Categoria (ADR-007 §10): TODAS tenant-scoped (clinic_id FK CASCADE) → RLS
 * `defaultTenantPolicy(v1)` (ENABLE + FORCE) na migration 0017.
 *
 * Decisões frozen (PlanoAção §7 + review do arquiteto):
 *   - CONTEÚDO CLÍNICO É CIFRADO (A1 / ADR-044): content/medicamentos/observacoes
 *     ficam em colunas `*_encrypted text` cifradas per-tenant (ADR-012). A Regra 2
 *     ("SOAP são campos nomeados, não blob") NÃO se dilui: ela é garantida pelo
 *     `ProntuarioContentSchema.strict()` que roda ANTES de cifrar (actions.ts) +
 *     o tipo `Encrypted<ProntuarioContent>` na coluna. O texto era jsonb em claro
 *     — a categoria de maior sensibilidade da LGPD (Art. 11) estava desprotegida
 *     enquanto o CPF já era cifrado. Nenhum índice/query olha DENTRO do conteúdo
 *     (busca é por `snapshot_patient_nome` em claro), então cifrar não quebra nada.
 *   - R1: `rowVersion` = concorrência (autosave, bump a cada UPDATE);
 *     `version` = revisão JURÍDICA (só editSignedProntuario incrementa).
 *     prontuario_versions.version = revisão jurídica arquivada.
 *   - R2: imutabilidade pós-assinatura via trigger SQL `block_signed_prontuario_update`
 *     (migration) + bloqueio na Server Action. Bypass só por editSignedProntuario.
 *   - R8: snapshot das credenciais do médico (nome/CRM/UF/esp) congelado na linha
 *     (prontuário ao assinar; prescription/medical_document na criação) — documento
 *     histórico não muda se o profile do médico mudar depois.
 *   - R9: 1 consulta = 1 prontuário (unique parcial appointment_id); adendo = nova
 *     revisão via editSignedProntuario, não novo prontuário.
 *   - clinical_templates NÃO existe (R5): §7.18 é a autoridade e a omite; templates
 *     SOAP vivem em código (templates/).
 *
 * FK cross-context (patients/appointments/profiles): coluna `uuid()` pura aqui +
 * constraint na migration (boundaries proíbe context→context FK no Drizzle).
 * FK intra-context (prontuarios): `.references()`.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// eslint-disable-next-line boundaries/element-types -- D35: tenantIdRef (FK + ON DELETE CASCADE para clinics) vive no schema de tenancy por design (mesma exceção de identity/scheduling).
import { tenantIdRef } from '@/contexts/tenancy';
import { timestampsPattern, uuidPk } from '@/lib/db/types';

import type { Encrypted } from '@/lib/crypto/brand';

import type {
  Medicamento,
  MedicalDocumentContent,
  ProntuarioContent,
} from './types';

import './events'; // side-effect: registra clinical.* no catálogo do outbox.

// --- enums -----------------------------------------------------------------

export const prontuarioStatus = pgEnum('prontuario_status', ['rascunho', 'assinado']);

export const medicalDocumentType = pgEnum('medical_document_type', [
  'atestado',
  'exame',
  'declaracao',
  'encaminhamento',
]);

// Tipo de receita. 'simples' (default, comportamento C7) ou 'controle_especial'
// (receituário branco de 2 vias — lista C1 / RDC 20/2011). Aditivo: linhas antigas
// ficam 'simples'. NÃO é talão numerado (tarja preta) nem assinatura digital.
export const prescriptionKind = pgEnum('prescription_kind', ['simples', 'controle_especial']);

// --- prontuarios -----------------------------------------------------------

export const prontuarios = pgTable(
  'prontuarios',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    patientId: uuid('patient_id').notNull(), // FK patients RESTRICT (migration)
    doctorId: uuid('doctor_id').notNull(), // FK profiles RESTRICT (migration)
    appointmentId: uuid('appointment_id'), // FK appointments SET NULL (migration)

    status: prontuarioStatus('status').notNull().default('rascunho'),
    // A1/ADR-044: SOAP cifrado per-tenant. `Encrypted<ProntuarioContent>` obriga
    // decifrar (via clinical/internal/content-crypto) antes de usar — o compilador
    // pega quem esquecer. Era `jsonb content` em claro.
    contentEncrypted: text('content_encrypted').notNull().$type<Encrypted<ProntuarioContent>>(),

    // R1: dois contadores com papéis distintos.
    rowVersion: integer('row_version').notNull().default(1), // optimistic lock (autosave)
    version: integer('version').notNull().default(1), // revisão jurídica (só editSigned ++)

    signedAt: timestamp('signed_at', { withTimezone: true }),
    signedBy: uuid('signed_by'), // FK profiles RESTRICT (migration)
    // R8/P2: snapshot do médico no ato da assinatura. null enquanto rascunho; ao
    // assinar, signed_doctor_nome é sempre preenchido (profiles.nome é notNull), mas
    // crm/crm_uf/especialidade PODEM ficar null — assinatura não exige CRM (R6).
    signedDoctorNome: text('signed_doctor_nome'),
    signedDoctorCrm: text('signed_doctor_crm'),
    signedDoctorCrmUf: text('signed_doctor_crm_uf'),
    signedDoctorEspecialidade: text('signed_doctor_especialidade'),

    needsReturn: boolean('needs_return').notNull().default(false),
    returnDays: integer('return_days'),

    createdBy: uuid('created_by'),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicIdx: index('prontuarios_clinic_id_idx').on(t.clinicId),
    clinicPatientIdx: index('prontuarios_clinic_patient_idx').on(t.clinicId, t.patientId),
    // A6: índices de FK LIDERADOS pela coluna da FK. O composto acima NÃO serve à
    // checagem de integridade: o Postgres a faz como `WHERE <fkcol> = $1` (sem
    // clinic_id), então um índice liderado por clinic_id é inútil ali.
    //   - patient_id  → RESTRICT no hard-delete LGPD (ADR-017/021)
    //   - doctor_id   → RESTRICT no offboarding de membro (ADR-039) + "meus prontuários"
    //   - signed_by   → RESTRICT no offboarding de membro
    patientFkIdx: index('prontuarios_patient_id_idx').on(t.patientId),
    doctorFkIdx: index('prontuarios_doctor_id_idx').on(t.doctorId),
    signedByFkIdx: index('prontuarios_signed_by_idx').on(t.signedBy),
    // R9: 1 prontuário por consulta (idempotência do handler appointment.started).
    appointmentUniq: uniqueIndex('prontuarios_appointment_uniq')
      .on(t.appointmentId)
      .where(sql`appointment_id IS NOT NULL`),
    returnDaysChk: check(
      'prontuarios_return_days_chk',
      sql`${t.needsReturn} = false OR ${t.returnDays} > 0`,
    ),
  }),
);

export type ProntuarioRow = typeof prontuarios.$inferSelect;
export type ProntuarioInsert = typeof prontuarios.$inferInsert;

// --- prontuario_versions (append-only; histórico jurídico) -----------------

export const prontuarioVersions = pgTable(
  'prontuario_versions',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    prontuarioId: uuid('prontuario_id')
      .notNull()
      .references(() => prontuarios.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(), // revisão jurídica arquivada
    // A1/ADR-044: cópia CIFRADA do content arquivado. editSignedProntuario copia
    // o ciphertext verbatim (mesmo clinicId) — sem round-trip, preserva os bytes
    // exatos da trilha jurídica.
    contentEncrypted: text('content_encrypted').notNull().$type<Encrypted<ProntuarioContent>>(),
    editedBy: uuid('edited_by').notNull(),
    reason: text('reason').notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    clinicIdx: index('prontuario_versions_clinic_id_idx').on(t.clinicId),
    prontuarioIdx: index('prontuario_versions_prontuario_id_idx').on(t.prontuarioId),
    versionUniq: uniqueIndex('prontuario_versions_prontuario_version_uniq').on(
      t.prontuarioId,
      t.version,
    ),
  }),
);

export type ProntuarioVersionRow = typeof prontuarioVersions.$inferSelect;
export type ProntuarioVersionInsert = typeof prontuarioVersions.$inferInsert;

// --- prescriptions ---------------------------------------------------------

export const prescriptions = pgTable(
  'prescriptions',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    prontuarioId: uuid('prontuario_id').references(() => prontuarios.id, {
      onDelete: 'set null',
    }),
    patientId: uuid('patient_id').notNull(), // FK patients RESTRICT (migration)
    doctorId: uuid('doctor_id').notNull(), // FK profiles RESTRICT (migration)

    // Tipo de receita (default 'simples' = comportamento C7). 'controle_especial'
    // dispara o template de 2 vias + snapshots de endereço/emitente abaixo.
    kind: prescriptionKind('kind').notNull().default('simples'),

    // A1/ADR-044: lista de medicamentos + observações cifradas per-tenant.
    // observacoes_encrypted é NULLABLE (o original também era) — só é cifrada
    // quando existe (ver decryptJson tolerante a null no queries.ts).
    medicamentosEncrypted: text('medicamentos_encrypted').notNull().$type<Encrypted<Medicamento[]>>(),
    observacoesEncrypted: text('observacoes_encrypted').$type<Encrypted<string>>(),
    pdfStoragePath: text('pdf_storage_path'),

    // R8: snapshot do paciente + médico congelado na emissão (documento legal
    // nomeia o paciente; não muda se o cadastro mudar depois). CRM obrigatório aqui.
    snapshotPatientNome: text('snapshot_patient_nome').notNull(),
    snapshotDoctorNome: text('snapshot_doctor_nome').notNull(),
    snapshotDoctorCrm: text('snapshot_doctor_crm').notNull(),
    snapshotDoctorCrmUf: text('snapshot_doctor_crm_uf'),
    snapshotDoctorEspecialidade: text('snapshot_doctor_especialidade'),

    // R8/G1 — controle especial: a identificação LEGAL do emitente e o endereço
    // do paciente são congelados na emissão (validade documental imutável). Só
    // preenchidos quando kind='controle_especial'. Logo/cor (branding) seguem
    // atuais no render — são cosméticos e NÃO fazem parte da validade documental.
    snapshotPatientEndereco: text('snapshot_patient_endereco'),
    snapshotEmitenteNome: text('snapshot_emitente_nome'),
    snapshotEmitenteEndereco: text('snapshot_emitente_endereco'),
    snapshotEmitenteTelefone: text('snapshot_emitente_telefone'),

    createdBy: uuid('created_by'),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicIdx: index('prescriptions_clinic_id_idx').on(t.clinicId),
    clinicPatientIdx: index('prescriptions_clinic_patient_idx').on(t.clinicId, t.patientId),
    prontuarioIdx: index('prescriptions_prontuario_id_idx').on(t.prontuarioId),
    // A6 — FK liderada (RESTRICT no hard-delete LGPD / offboarding de membro).
    patientFkIdx: index('prescriptions_patient_id_idx').on(t.patientId),
    doctorFkIdx: index('prescriptions_doctor_id_idx').on(t.doctorId),
  }),
);

export type PrescriptionRow = typeof prescriptions.$inferSelect;
export type PrescriptionInsert = typeof prescriptions.$inferInsert;

// --- medical_documents -----------------------------------------------------

export const medicalDocuments = pgTable(
  'medical_documents',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    patientId: uuid('patient_id').notNull(), // FK patients RESTRICT (migration)
    doctorId: uuid('doctor_id').notNull(), // FK profiles RESTRICT (migration)
    type: medicalDocumentType('type').notNull(), // fica em CLARO — discrimina o render do PDF
    // A1/ADR-044: conteúdo do documento (atestado/exame/etc.) cifrado per-tenant.
    contentEncrypted: text('content_encrypted').notNull().$type<Encrypted<MedicalDocumentContent>>(),
    pdfStoragePath: text('pdf_storage_path'),

    snapshotPatientNome: text('snapshot_patient_nome').notNull(),
    snapshotDoctorNome: text('snapshot_doctor_nome').notNull(),
    snapshotDoctorCrm: text('snapshot_doctor_crm').notNull(),
    snapshotDoctorCrmUf: text('snapshot_doctor_crm_uf'),
    snapshotDoctorEspecialidade: text('snapshot_doctor_especialidade'),

    createdBy: uuid('created_by'),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicIdx: index('medical_documents_clinic_id_idx').on(t.clinicId),
    clinicPatientIdx: index('medical_documents_clinic_patient_idx').on(t.clinicId, t.patientId),
    // A6 — FK liderada (RESTRICT no hard-delete LGPD / offboarding de membro).
    patientFkIdx: index('medical_documents_patient_id_idx').on(t.patientId),
    doctorFkIdx: index('medical_documents_doctor_id_idx').on(t.doctorId),
  }),
);

export type MedicalDocumentRow = typeof medicalDocuments.$inferSelect;
export type MedicalDocumentInsert = typeof medicalDocuments.$inferInsert;

// --- prescription_templates (Fase 2 — modelos de receita) ------------------
//
// Gabaritos reutilizáveis de prescrição POR MÉDICO (não é documento legal: sem
// snapshot, sem PDF, sem cifra — é conteúdo do usuário). A cifra clínica (A1/
// ADR-044) deixou `medicamentos` aqui EM CLARO de propósito: é paciente-agnóstico
// (sem titular de dado — LGPD Art. 11 não se aplica) e é LISTAGEM (até 200/médico),
// então cifrar violaria "listagens não decifram". RLS defaultTenantPolicy
// + FORCE (migration). Isolamento por médico via `doctor_id` no WHERE das queries.
// Aplicar um modelo é client-side (preenche o form) — NUNCA emite sozinho.
//
// Hand-append na migration: FK doctor_id→profiles CASCADE, RLS+grants+trigger
// updated_at, e UNIQUE (clinic_id, doctor_id, lower(nome)) — anti-duplicata
// case-insensitive (Drizzle não expressa lower() no índice).
export const prescriptionTemplates = pgTable(
  'prescription_templates',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    doctorId: uuid('doctor_id').notNull(), // FK profiles CASCADE (migration)
    nome: text('nome').notNull(),
    categoria: text('categoria'),
    medicamentos: jsonb('medicamentos')
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<Medicamento[]>(),
    observacoes: text('observacoes'),
    kind: prescriptionKind('kind').notNull().default('simples'),
    createdBy: uuid('created_by'),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicDoctorIdx: index('prescription_templates_clinic_doctor_idx').on(t.clinicId, t.doctorId),
  }),
);

export type PrescriptionTemplateRow = typeof prescriptionTemplates.$inferSelect;
export type PrescriptionTemplateInsert = typeof prescriptionTemplates.$inferInsert;
