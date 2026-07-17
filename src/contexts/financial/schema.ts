/**
 * Financial schema (C9) — Caixa + faturamento automático. 6 objetos:
 *   payment_methods (catálogo GLOBAL), suppliers, lancamentos, payment_proofs,
 *   faturamento_pendencias, cash_flow_daily.
 *
 * Categoria (ADR-007 §10): todas tenant-scoped (clinic_id FK CASCADE) → RLS
 * `defaultTenantPolicy(v1)` na migration 0020, EXCETO `payment_methods`, que é
 * catálogo global (sem clinic_id), modelado como a tabela `permissions` (0003):
 * GRANT SELECT a authenticated, escrita só por migration/service_role.
 *
 * Decisões frozen (plano C9 + review):
 *   - Dinheiro = numeric(12,2); JS/eventos usam Number()/z.number().
 *   - Append-only: o trigger de banco bloqueia APENAS colunas imutáveis
 *     (clinic_id, tipo, valor, created_via, appointment_id, reverses_lancamento_id);
 *     a transição de status é state machine no domínio (logic.ts). [R1]
 *   - Estorno = lançamento NOVO (created_via='estorno', status='estornado',
 *     reverses_lancamento_id → original); original vira status='estornado'. [R2]
 *   - 1 atendimento = 1 lançamento: UNIQUE parcial em appointment_id.
 *
 * FK cross-context (patients/appointments/clinic_units/auth.users): coluna
 * `uuid()` pura aqui + constraint na migration (boundaries proíbe context→context
 * FK no Drizzle). FK intra-context (suppliers/self/payment_methods): `.references()`.
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
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// eslint-disable-next-line boundaries/element-types -- D35: tenantIdRef (FK + ON DELETE CASCADE para clinics) vive no schema de tenancy por design (mesma exceção de identity/scheduling/clinical).
import { tenantIdRef } from '@/contexts/tenancy';
import { timestampsPattern, uuidPk } from '@/lib/db/types';

import './events'; // side-effect: registra financial.* no catálogo do outbox.

// --- enums -----------------------------------------------------------------

export const lancamentoTipo = pgEnum('lancamento_tipo', ['receber', 'pagar']);

export const lancamentoStatus = pgEnum('lancamento_status', [
  'pendente',
  'parcial',
  'pago',
  'cancelado',
  'estornado',
]);

export const lancamentoCreatedVia = pgEnum('lancamento_created_via', [
  'auto',
  'manual',
  'estorno',
]);

export const paymentProofType = pgEnum('payment_proof_type', [
  'comprovante',
  'nota_fiscal',
  'outro',
]);

export const pendenciaStatus = pgEnum('pendencia_status', ['aberta', 'resolvida']);

// --- payment_methods (catálogo GLOBAL — sem clinic_id) ---------------------

export const paymentMethods = pgTable('payment_methods', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  ativo: boolean('ativo').notNull().default(true),
  ordem: integer('ordem').notNull().default(0),
});

export type PaymentMethodRow = typeof paymentMethods.$inferSelect;

// --- suppliers (fornecedores) ----------------------------------------------

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    razaoSocial: text('razao_social').notNull(),
    cnpj: text('cnpj'),
    contato: text('contato'),
    condicaoPagamento: text('condicao_pagamento'),
    ativo: boolean('ativo').notNull().default(true),
    createdBy: uuid('created_by'), // FK auth.users via migration
    ...timestampsPattern(),
  },
  (t) => ({
    clinicIdx: index('suppliers_clinic_id_idx').on(t.clinicId),
    clinicAtivoIdx: index('suppliers_clinic_ativo_idx').on(t.clinicId, t.ativo),
  }),
);

export type SupplierRow = typeof suppliers.$inferSelect;
export type SupplierInsert = typeof suppliers.$inferInsert;

// --- lancamentos -----------------------------------------------------------

export const lancamentos = pgTable(
  'lancamentos',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    unitId: uuid('unit_id'), // FK clinic_units via migration
    tipo: lancamentoTipo('tipo').notNull(),
    descricao: text('descricao').notNull(),
    valor: numeric('valor', { precision: 12, scale: 2 }).notNull(),
    valorPago: numeric('valor_pago', { precision: 12, scale: 2 }).notNull().default('0'),
    status: lancamentoStatus('status').notNull().default('pendente'),
    dueDate: date('due_date'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    patientId: uuid('patient_id'), // FK patients SET NULL via migration
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
    appointmentId: uuid('appointment_id'), // FK appointments SET NULL via migration
    paymentMethod: text('payment_method').references(() => paymentMethods.code),
    createdVia: lancamentoCreatedVia('created_via').notNull(),
    // Lineage do estorno (append-only): aponta para o lançamento original.
    reversesLancamentoId: uuid('reverses_lancamento_id').references(
      (): AnyPgColumn => lancamentos.id,
      { onDelete: 'restrict' },
    ),
    // Denormalização p/ Caixa patient-first (nome de profissional NÃO é PII).
    snapshotProcedureName: text('snapshot_procedure_name'),
    snapshotDoctorNome: text('snapshot_doctor_nome'),
    createdBy: uuid('created_by'), // FK auth.users via migration
    ...timestampsPattern(),
  },
  (t) => ({
    clinicStatusIdx: index('lancamentos_clinic_status_idx').on(t.clinicId, t.status),
    clinicTipoStatusIdx: index('lancamentos_clinic_tipo_status_idx').on(
      t.clinicId,
      t.tipo,
      t.status,
    ),
    clinicDueIdx: index('lancamentos_clinic_due_idx').on(t.clinicId, t.dueDate),
    clinicPatientIdx: index('lancamentos_clinic_patient_idx').on(t.clinicId, t.patientId),
    reversesIdx: index('lancamentos_reverses_idx').on(t.reversesLancamentoId),
    // A6 — FKs LIDERADAS (a checagem de RI é `WHERE <fkcol> = $1`, sem clinic_id):
    //   - supplier_id → SET NULL ao excluir fornecedor (+ caixa "por fornecedor")
    //   - patient_id  → SET NULL no hard-delete LGPD (ADR-021)
    //   - unit_id     → SET NULL ao excluir unidade
    supplierFkIdx: index('lancamentos_supplier_id_idx').on(t.supplierId),
    patientFkIdx: index('lancamentos_patient_id_idx').on(t.patientId),
    unitFkIdx: index('lancamentos_unit_id_idx').on(t.unitId),
    // 1 atendimento = 1 lançamento automático.
    appointmentUniq: uniqueIndex('lancamentos_appointment_uniq')
      .on(t.appointmentId)
      .where(sql`appointment_id IS NOT NULL`),
    valorChk: check('lancamentos_valor_chk', sql`${t.valor} >= 0`),
    valorPagoChk: check(
      'lancamentos_valor_pago_chk',
      sql`${t.valorPago} >= 0 AND ${t.valorPago} <= ${t.valor}`,
    ),
    // Origem obrigatória — proíbe lançamento órfão (REGRA do spec).
    autoOriginChk: check(
      'lancamentos_auto_origin_chk',
      sql`${t.createdVia} <> 'auto' OR ${t.appointmentId} IS NOT NULL`,
    ),
    estornoOriginChk: check(
      'lancamentos_estorno_origin_chk',
      sql`${t.createdVia} <> 'estorno' OR ${t.reversesLancamentoId} IS NOT NULL`,
    ),
    paidCoerenciaChk: check(
      'lancamentos_paid_coerencia_chk',
      sql`${t.status} <> 'pago' OR ${t.paidAt} IS NOT NULL`,
    ),
  }),
);

export type LancamentoRow = typeof lancamentos.$inferSelect;
export type LancamentoInsert = typeof lancamentos.$inferInsert;

// --- payment_proofs (comprovantes; append-only; preparado p/ OCR) ----------

export const paymentProofs = pgTable(
  'payment_proofs',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(), // REGRA 1: clinic_id mesmo sendo filho do lançamento
    lancamentoId: uuid('lancamento_id')
      .notNull()
      .references(() => lancamentos.id, { onDelete: 'cascade' }),
    type: paymentProofType('type').notNull(),
    fileStoragePath: text('file_storage_path').notNull(),
    ocrData: jsonb('ocr_data'), // nullable — preparado p/ OCR futuro; NÃO implementar agora
    uploadedBy: uuid('uploaded_by'), // FK auth.users via migration
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    clinicLancamentoIdx: index('payment_proofs_clinic_lancamento_idx').on(
      t.clinicId,
      t.lancamentoId,
    ),
  }),
);

export type PaymentProofRow = typeof paymentProofs.$inferSelect;
export type PaymentProofInsert = typeof paymentProofs.$inferInsert;

// --- faturamento_pendencias (ledger de pendências; alimenta o banner) ------

export const faturamentoPendencias = pgTable(
  'faturamento_pendencias',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    appointmentId: uuid('appointment_id').notNull(), // FK appointments via migration
    motivo: text('motivo').notNull(),
    valor: numeric('valor', { precision: 12, scale: 2 }),
    status: pendenciaStatus('status').notNull().default('aberta'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by'),
  },
  (t) => ({
    // 1 pendência por atendimento (UPSERT idempotente do handler/reconcile).
    appointmentUniq: uniqueIndex('faturamento_pendencias_appointment_uniq').on(t.appointmentId),
    clinicStatusIdx: index('faturamento_pendencias_clinic_status_idx').on(t.clinicId, t.status),
  }),
);

export type FaturamentoPendenciaRow = typeof faturamentoPendencias.$inferSelect;
export type FaturamentoPendenciaInsert = typeof faturamentoPendencias.$inferInsert;

// --- cash_flow_daily (rollup diário; tabela RLS, NÃO materialized view) -----

export const cashFlowDaily = pgTable(
  'cash_flow_daily',
  {
    clinicId: tenantIdRef(),
    date: date('date').notNull(),
    totalRecebido: numeric('total_recebido', { precision: 14, scale: 2 }).notNull().default('0'),
    totalPago: numeric('total_pago', { precision: 14, scale: 2 }).notNull().default('0'),
    saldo: numeric('saldo', { precision: 14, scale: 2 }).notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.clinicId, t.date] }),
  }),
);

export type CashFlowDailyRow = typeof cashFlowDaily.$inferSelect;
export type CashFlowDailyInsert = typeof cashFlowDaily.$inferInsert;
