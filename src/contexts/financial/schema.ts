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
  unique,
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

export const lancamentoCreatedVia = pgEnum('lancamento_created_via', ['auto', 'manual', 'estorno']);

export const paymentProofType = pgEnum('payment_proof_type', [
  'comprovante',
  'nota_fiscal',
  'outro',
]);

export const paymentTransactionKind = pgEnum('payment_transaction_kind', ['payment', 'refund']);

export const patientCreditDisputeStatus = pgEnum('patient_credit_dispute_status', [
  'requested',
  'in_dispute',
  'awaiting_reversal',
  'reversed',
  'lost',
  'cash_undone',
]);

export const patientCreditAdjustmentKind = pgEnum('patient_credit_adjustment_kind', [
  'excess_refund',
  'chargeback_loss',
  'cash_undone',
]);

export const pendenciaStatus = pgEnum('pendencia_status', ['aberta', 'resolvida']);

export const collectionCaseStage = pgEnum('collection_case_stage', ['d15_review', 'd30_manual']);

export const collectionCaseStatus = pgEnum('collection_case_status', ['open', 'resolved']);

export type ProfessionalPayoutBasis = 'gross' | 'net';
export type ProfessionalPayoutRuleKind = 'percentage' | 'fixed';
/**
 * `cancelled` é a suspensão após reversão (estorno/perda): nada é devido até a
 * revisão humana. `reviewed` guarda o valor decidido na versão de revisão vigente.
 */
export type ProfessionalPayoutStatus =
  | 'pending_economics'
  | 'calculated'
  | 'cancelled'
  | 'reviewed';

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
    /**
     * Linhagem opaca de uma despesa automática originada no Payments. Sem FK
     * cross-context; a UNIQUE abaixo é a trava de idempotência.
     */
    sourcePatientChargeId: uuid('source_patient_charge_id'),
    financialExpenseKind: text('financial_expense_kind'),
    /** Só ajustes posteriores: revisão da cobrança e evento que originou o fato. */
    providerEconomicsRevision: integer('provider_economics_revision'),
    sourceEventId: uuid('source_event_id'),
    providerPaymentId: text('provider_payment_id'),
    /**
     * 0153 (Convênios): recebível da OPERADORA de uma guia enviada. Linhagem opaca, sem FK
     * cross-context; a UNIQUE parcial é a trava "uma guia = um recebível". Só a ponte do
     * Convênios mantém essas linhas (gatilhos recusam pagamento/edição pelo Caixa).
     */
    sourceHiGuideId: uuid('source_hi_guide_id'),
    /** 0153: baixa SEM caixa por glosa definitiva da operadora (sempre 0 fora do convênio). */
    valorGlosado: numeric('valor_glosado', { precision: 12, scale: 2 }).notNull().default('0'),
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
    // 0153: uma guia de convênio = um recebível da operadora.
    hiGuideUniq: uniqueIndex('lancamentos_hi_guide_uniq')
      .on(t.clinicId, t.sourceHiGuideId)
      .where(sql`source_hi_guide_id IS NOT NULL`),
    appointmentUniq: uniqueIndex('lancamentos_appointment_uniq')
      .on(t.appointmentId)
      .where(sql`appointment_id IS NOT NULL`),
    providerExpenseUniq: uniqueIndex('lancamentos_provider_expense_uniq')
      .on(t.clinicId, t.sourcePatientChargeId, t.financialExpenseKind)
      .where(
        sql`${t.sourcePatientChargeId} is not null and ${t.providerEconomicsRevision} is null`,
      ),
    providerExpenseAdjustmentUniq: uniqueIndex('lancamentos_provider_expense_adjustment_uniq')
      .on(t.clinicId, t.sourcePatientChargeId, t.providerEconomicsRevision)
      .where(sql`${t.providerEconomicsRevision} is not null`),
    valorChk: check('lancamentos_valor_chk', sql`${t.valor} >= 0`),
    valorPagoChk: check(
      'lancamentos_valor_pago_chk',
      sql`${t.valorPago} >= 0 AND ${t.valorPago} <= ${t.valor}`,
    ),
    // Origem obrigatória — proíbe lançamento órfão (REGRA do spec).
    autoOriginChk: check(
      'lancamentos_auto_origin_chk',
      sql`${t.createdVia} <> 'auto'
          OR ${t.appointmentId} IS NOT NULL
          OR (${t.sourcePatientChargeId} IS NOT NULL AND ${t.financialExpenseKind} IS NOT NULL)
          OR ${t.sourceHiGuideId} IS NOT NULL`,
    ),
    providerExpenseCoherenceChk: check(
      'lancamentos_provider_expense_coherence_chk',
      sql`(${t.sourcePatientChargeId} IS NULL AND ${t.financialExpenseKind} IS NULL
              AND ${t.providerEconomicsRevision} IS NULL AND ${t.sourceEventId} IS NULL
              AND ${t.providerPaymentId} IS NULL)
          OR (${t.sourcePatientChargeId} IS NOT NULL
            AND ${t.financialExpenseKind} IN ('payment_processing_fee', 'early_settlement_fee')
            AND ${t.tipo} = 'pagar' AND ${t.providerEconomicsRevision} IS NULL
            AND ${t.sourceEventId} IS NULL AND ${t.providerPaymentId} IS NULL)
          OR (${t.sourcePatientChargeId} IS NOT NULL
            AND ${t.financialExpenseKind} = 'payment_processing_fee_adjustment'
            AND ${t.providerEconomicsRevision} >= 2
            AND ${t.sourceEventId} IS NOT NULL AND ${t.providerPaymentId} IS NOT NULL)`,
    ),
    valorGlosadoChk: check(
      'lancamentos_valor_glosado_chk',
      sql`${t.valorGlosado} >= 0 AND ${t.valorPago} + ${t.valorGlosado} <= ${t.valor}
          AND (${t.valorGlosado} = 0 OR ${t.sourceHiGuideId} IS NOT NULL)`,
    ),
    insurerReceivableChk: check(
      'lancamentos_insurer_receivable_chk',
      sql`${t.sourceHiGuideId} IS NULL OR (${t.tipo} = 'receber' AND ${t.createdVia} = 'auto'
          AND ${t.appointmentId} IS NULL AND ${t.patientId} IS NULL AND ${t.sourcePatientChargeId} IS NULL
          AND ${t.reversesLancamentoId} IS NULL AND ${t.paymentMethod} = 'convenio')`,
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

// --- professional payouts -------------------------------------------------

/** Default por tenant. Ausência de linha equivale a `gross`. */
export const clinicFinancialPolicies = pgTable(
  'clinic_financial_policies',
  {
    clinicId: tenantIdRef().primaryKey(),
    professionalPayoutBasis: text('professional_payout_basis')
      .$type<ProfessionalPayoutBasis>()
      .notNull()
      .default('gross'),
    updatedBy: uuid('updated_by'),
    ...timestampsPattern(),
  },
  (t) => ({
    basisCheck: check(
      'clinic_financial_policies_basis_chk',
      sql`${t.professionalPayoutBasis} IN ('gross', 'net')`,
    ),
  }),
);

/** Histórico append-only usado para resolver a base vigente na data do atendimento. */
export const clinicFinancialPolicyVersions = pgTable(
  'clinic_financial_policy_versions',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    professionalPayoutBasis: text('professional_payout_basis')
      .$type<ProfessionalPayoutBasis>()
      .notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clinicEffectiveIdx: index('clinic_financial_policy_versions_effective_idx').on(
      t.clinicId,
      t.effectiveFrom,
    ),
    basisCheck: check(
      'clinic_financial_policy_versions_basis_chk',
      sql`${t.professionalPayoutBasis} IN ('gross', 'net')`,
    ),
  }),
);

/**
 * Regra comercial vigente para um profissional, opcionalmente especializada
 * por procedimento. O histórico não depende desta linha: cada atendimento
 * copia a regra aplicável para `professional_payouts`.
 */
export const professionalPayoutRules = pgTable(
  'professional_payout_rules',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    professionalId: uuid('professional_id').notNull(),
    procedureId: uuid('procedure_id'),
    kind: text('kind').$type<ProfessionalPayoutRuleKind>().notNull(),
    percentage: numeric('percentage', { precision: 7, scale: 4 }),
    fixedAmount: numeric('fixed_amount', { precision: 12, scale: 2 }),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdBy: uuid('created_by'),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicProfessionalIdx: index('professional_payout_rules_clinic_professional_idx').on(
      t.clinicId,
      t.professionalId,
    ),
    activeUniq: uniqueIndex('professional_payout_rules_active_uniq')
      .on(
        t.clinicId,
        t.professionalId,
        sql`coalesce(${t.procedureId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${t.effectiveTo} IS NULL`),
    ruleShapeChk: check(
      'professional_payout_rules_shape_chk',
      sql`(${t.kind} = 'percentage' AND ${t.percentage} IS NOT NULL AND ${t.percentage} > 0
            AND ${t.percentage} <= 100 AND ${t.fixedAmount} IS NULL)
          OR (${t.kind} = 'fixed' AND ${t.fixedAmount} IS NOT NULL
            AND ${t.fixedAmount} >= 0 AND ${t.percentage} IS NULL)`,
    ),
    effectiveWindowChk: check(
      'professional_payout_rules_effective_window_chk',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  }),
);

/**
 * Snapshot imutável do cálculo de um atendimento. `pending_economics` preserva
 * o caso em que a base escolhida é líquida, mas o provedor ainda não informou
 * os fatos econômicos reais.
 */
export const professionalPayouts = pgTable(
  'professional_payouts',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    appointmentId: uuid('appointment_id').notNull(),
    professionalId: uuid('professional_id').notNull(),
    procedureId: uuid('procedure_id').notNull(),
    policyVersionId: uuid('policy_version_id').references(() => clinicFinancialPolicyVersions.id, {
      onDelete: 'restrict',
    }),
    ruleId: uuid('rule_id').references(() => professionalPayoutRules.id, { onDelete: 'restrict' }),
    calculationBasis: text('calculation_basis').$type<ProfessionalPayoutBasis>().notNull(),
    ruleKind: text('rule_kind').$type<ProfessionalPayoutRuleKind>().notNull(),
    rulePercentage: numeric('rule_percentage', { precision: 7, scale: 4 }),
    ruleFixedAmount: numeric('rule_fixed_amount', { precision: 12, scale: 2 }),
    grossAmount: numeric('gross_amount', { precision: 12, scale: 2 }).notNull(),
    providerFeeAmount: numeric('provider_fee_amount', { precision: 12, scale: 2 }),
    earlySettlementFeeAmount: numeric('early_settlement_fee_amount', {
      precision: 12,
      scale: 2,
    }),
    netAmount: numeric('net_amount', { precision: 12, scale: 2 }),
    basisAmount: numeric('basis_amount', { precision: 12, scale: 2 }),
    payoutAmount: numeric('payout_amount', { precision: 12, scale: 2 }),
    status: text('status').$type<ProfessionalPayoutStatus>().notNull().default('pending_economics'),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }),
    ...timestampsPattern(),
  },
  (t) => ({
    appointmentUniq: unique('professional_payouts_appointment_uniq').on(t.appointmentId),
    clinicProfessionalIdx: index('professional_payouts_clinic_professional_idx').on(
      t.clinicId,
      t.professionalId,
    ),
    basisCheck: check(
      'professional_payouts_basis_chk',
      sql`${t.calculationBasis} IN ('gross', 'net')`,
    ),
    amountChk: check(
      'professional_payouts_amount_chk',
      sql`${t.grossAmount} >= 0
          AND (${t.providerFeeAmount} IS NULL OR (${t.providerFeeAmount} >= 0 AND ${t.providerFeeAmount} <= ${t.grossAmount}))
          AND (${t.earlySettlementFeeAmount} IS NULL OR ${t.earlySettlementFeeAmount} >= 0)
          AND (${t.netAmount} IS NULL OR (${t.netAmount} >= 0 AND ${t.netAmount} <= ${t.grossAmount}))
          AND (${t.basisAmount} IS NULL OR ${t.basisAmount} >= 0)
          AND (${t.payoutAmount} IS NULL OR ${t.payoutAmount} >= 0)`,
    ),
    basisAmountChk: check(
      'professional_payouts_basis_amount_chk',
      sql`${t.status} <> 'calculated'
          OR (${t.calculationBasis} = 'gross' AND ${t.basisAmount} = ${t.grossAmount})
          OR (${t.calculationBasis} = 'net' AND ${t.netAmount} IS NOT NULL AND ${t.basisAmount} = ${t.netAmount})`,
    ),
    snapshotShapeChk: check(
      'professional_payouts_rule_shape_chk',
      sql`(${t.ruleKind} = 'percentage' AND ${t.rulePercentage} IS NOT NULL
            AND ${t.rulePercentage} > 0 AND ${t.rulePercentage} <= 100
            AND ${t.ruleFixedAmount} IS NULL)
          OR (${t.ruleKind} = 'fixed' AND ${t.ruleFixedAmount} IS NOT NULL
            AND ${t.ruleFixedAmount} >= 0 AND ${t.rulePercentage} IS NULL)`,
    ),
    statusChk: check(
      'professional_payouts_status_chk',
      sql`(${t.status} = 'pending_economics' AND ${t.calculationBasis} = 'net' AND ${t.basisAmount} IS NULL AND ${t.payoutAmount} IS NULL AND ${t.calculatedAt} IS NULL)
          OR (${t.status} = 'calculated' AND ${t.basisAmount} IS NOT NULL AND ${t.payoutAmount} IS NOT NULL AND ${t.calculatedAt} IS NOT NULL)
          OR ${t.status} = 'cancelled'
          OR (${t.status} = 'reviewed' AND ${t.basisAmount} IS NOT NULL AND ${t.payoutAmount} IS NOT NULL AND ${t.calculatedAt} IS NOT NULL)`,
    ),
  }),
);

/**
 * Decisões humanas sobre um repasse suspenso após estorno ou perda (decisão de
 * produto de 07/10/2026). Append-only: cada decisão é uma versão nova; corrigir
 * é registrar outra versão. O teto é o valor que a regra produzia sobre o
 * pagamento original; a referência proporcional é só informativa. O estado da
 * reversão considerado na decisão fica gravado para detectar reversão posterior.
 * `decided_by` é snapshot opaco do ator, sem FK, como nas versões de política.
 */
export const professionalPayoutReviews = pgTable(
  'professional_payout_reviews',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    payoutId: uuid('payout_id')
      .notNull()
      .references(() => professionalPayouts.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    ceilingAmount: numeric('ceiling_amount', { precision: 12, scale: 2 }).notNull(),
    referenceAmount: numeric('reference_amount', { precision: 12, scale: 2 }),
    decidedAmount: numeric('decided_amount', { precision: 12, scale: 2 }).notNull(),
    reason: text('reason').notNull(),
    reversalRefundedAmount: numeric('reversal_refunded_amount', {
      precision: 12,
      scale: 2,
    }).notNull(),
    reversalLoss: boolean('reversal_loss').notNull(),
    decidedBy: uuid('decided_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    versionUniq: unique('professional_payout_reviews_version_uniq').on(t.payoutId, t.version),
    clinicPayoutIdx: index('professional_payout_reviews_clinic_payout_idx').on(
      t.clinicId,
      t.payoutId,
      t.version,
    ),
    versionChk: check('professional_payout_reviews_version_chk', sql`${t.version} >= 1`),
    amountChk: check(
      'professional_payout_reviews_amount_chk',
      sql`${t.ceilingAmount} >= 0
          AND ${t.decidedAmount} >= 0 AND ${t.decidedAmount} <= ${t.ceilingAmount}
          AND (${t.referenceAmount} IS NULL OR (${t.referenceAmount} >= 0 AND ${t.referenceAmount} <= ${t.ceilingAmount}))
          AND ${t.reversalRefundedAmount} >= 0`,
    ),
    reasonChk: check(
      'professional_payout_reviews_reason_chk',
      sql`char_length(btrim(${t.reason})) BETWEEN 3 AND 500`,
    ),
  }),
);

export type ClinicFinancialPolicyRow = typeof clinicFinancialPolicies.$inferSelect;
export type ClinicFinancialPolicyVersionRow = typeof clinicFinancialPolicyVersions.$inferSelect;
export type ProfessionalPayoutRuleRow = typeof professionalPayoutRules.$inferSelect;
export type ProfessionalPayoutRow = typeof professionalPayouts.$inferSelect;
export type ProfessionalPayoutReviewRow = typeof professionalPayoutReviews.$inferSelect;

// --- patient_credits (ADR-051 1.5b.1) ------------------------------------

export const patientCreditKind = pgEnum('patient_credit_kind', ['deposit', 'remaining_payment']);
export const patientCreditStatus = pgEnum('patient_credit_status', [
  'available',
  'allocated',
  'refunded',
  'retained',
]);

/**
 * Dinheiro do paciente que chegou ANTES de existir a obrigacao (ADR-051 D3).
 *
 * O sinal e pago quando o agendamento e marcado; o `lancamento` do atendimento
 * so nasce quando ele e concluido. `payment_transactions` nao serve para isso —
 * `lancamento_id` e NOT NULL, ou seja, baixa nao existe sem lancamento. O credito
 * e a representacao do intervalo entre as duas coisas.
 *
 * Mora no FINANCIAL, e nao no Payments, porque e ele a fonte da verdade
 * financeira: `patient_charges` descreve tentativas de cobranca num gateway,
 * nao obrigacoes. E quem le os creditos no faturamento le a PROPRIA tabela —
 * e isso que mantem o Financial independente do modelo interno do Payments.
 *
 * `patientChargeId` NAO tem FK de proposito: e chave de idempotencia opaca vinda
 * de outro context (ver a migration 0088).
 */
export const patientCredits = pgTable(
  'patient_credits',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    patientId: uuid('patient_id'),
    appointmentId: uuid('appointment_id'),
    patientChargeId: uuid('patient_charge_id').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    /** Fatos do provedor; NULL em legado ou enquanto a conciliação estiver incompleta. */
    providerGrossAmount: numeric('provider_gross_amount', { precision: 12, scale: 2 }),
    providerFeeAmount: numeric('provider_fee_amount', { precision: 12, scale: 2 }),
    providerNetAmount: numeric('provider_net_amount', { precision: 12, scale: 2 }),
    earlySettlementFeeAmount: numeric('early_settlement_fee_amount', {
      precision: 12,
      scale: 2,
    }),
    providerEconomicsReconciledAt: timestamp('provider_economics_reconciled_at', {
      withTimezone: true,
    }),
    providerEconomicsRevision: integer('provider_economics_revision').notNull().default(0),
    allocatedAmount: numeric('allocated_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    allocatedLancamentoId: uuid('allocated_lancamento_id').references(() => lancamentos.id, {
      onDelete: 'set null',
    }),
    allocatedPaymentTransactionId: uuid('allocated_payment_transaction_id').references(
      () => paymentTransactions.id,
      { onDelete: 'restrict' },
    ),
    /** Parcela nunca aplicada e posteriormente devolvida/perdida no provider. */
    unallocatedReversedAmount: numeric('unallocated_reversed_amount', {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default('0'),
    /** Parcela aplicada ao recebível e depois compensada no ledger. */
    allocatedReversedAmount: numeric('allocated_reversed_amount', {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default('0'),
    disputeStatus: patientCreditDisputeStatus('dispute_status'),
    kind: patientCreditKind('kind').notNull().default('deposit'),
    status: patientCreditStatus('status').notNull().default('available'),
    paymentMethod: text('payment_method').references(() => paymentMethods.code),
    grantedAt: timestamp('granted_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    clinicIdx: index('patient_credits_clinic_idx').on(t.clinicId),
    availableAppointmentIdx: index('patient_credits_available_appointment_idx').on(t.appointmentId),
    chargeUniq: uniqueIndex('patient_credits_charge_uniq').on(t.clinicId, t.patientChargeId),
    amountChk: check('patient_credits_amount_chk', sql`${t.amount} > 0`),
    allocatedChk: check(
      'patient_credits_allocated_chk',
      sql`${t.allocatedAmount} >= 0 AND ${t.allocatedAmount} <= ${t.amount}`,
    ),
    reversedChk: check(
      'patient_credits_reversed_amounts_chk',
      sql`${t.unallocatedReversedAmount} >= 0
        AND ${t.allocatedReversedAmount} >= 0
        AND ${t.unallocatedReversedAmount} <= ${t.amount} - ${t.allocatedAmount}
        AND ${t.allocatedReversedAmount} <= ${t.allocatedAmount}`,
    ),
    allocatedPaymentIdx: uniqueIndex('patient_credits_allocated_payment_transaction_idx')
      .on(t.allocatedPaymentTransactionId)
      .where(sql`${t.allocatedPaymentTransactionId} is not null`),
    economicsChk: check(
      'patient_credits_economics_nonnegative_chk',
      sql`(${t.providerGrossAmount} IS NULL OR (${t.providerGrossAmount} >= 0 AND ${t.providerGrossAmount} = ${t.amount}))
          AND (${t.providerFeeAmount} IS NULL OR (${t.providerGrossAmount} IS NOT NULL AND ${t.providerFeeAmount} >= 0 AND ${t.providerFeeAmount} <= ${t.providerGrossAmount}))
          AND (${t.providerNetAmount} IS NULL OR (${t.providerGrossAmount} IS NOT NULL AND ${t.providerNetAmount} >= 0 AND ${t.providerNetAmount} <= ${t.providerGrossAmount}))
          AND (${t.earlySettlementFeeAmount} IS NULL OR ${t.earlySettlementFeeAmount} >= 0)
          AND (${t.providerEconomicsReconciledAt} IS NULL OR (
            ${t.providerGrossAmount} IS NOT NULL
            AND ${t.providerFeeAmount} IS NOT NULL
            AND ${t.providerNetAmount} IS NOT NULL
          ))`,
    ),
  }),
);

export type PatientCreditRow = typeof patientCredits.$inferSelect;
export type PatientCreditInsert = typeof patientCredits.$inferInsert;

// --- payment_transactions (ledger financeiro imutavel) -------------------

export const paymentTransactions = pgTable(
  'payment_transactions',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    lancamentoId: uuid('lancamento_id')
      .notNull()
      .references(() => lancamentos.id, { onDelete: 'restrict' }),
    kind: paymentTransactionKind('kind').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    paymentMethod: text('payment_method').references(() => paymentMethods.code),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    originalPaymentId: uuid('original_payment_id').references(
      (): AnyPgColumn => paymentTransactions.id,
      { onDelete: 'restrict' },
    ),
    reason: text('reason'),
    createdBy: uuid('created_by'), // FK auth.users via migration
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    clinicLancamentoIdx: index('payment_transactions_clinic_lancamento_idx').on(
      t.clinicId,
      t.lancamentoId,
    ),
    originalPaymentIdx: index('payment_transactions_original_payment_idx').on(t.originalPaymentId),
    clinicOccurredIdx: index('payment_transactions_clinic_occurred_idx').on(
      t.clinicId,
      t.occurredAt,
    ),
    amountChk: check('payment_transactions_amount_chk', sql`${t.amount} > 0`),
    kindCoerenciaChk: check(
      'payment_transactions_kind_coerencia_chk',
      sql`(${t.kind} = 'payment' AND ${t.originalPaymentId} IS NULL AND ${t.reason} IS NULL)
          OR (${t.kind} = 'refund' AND ${t.originalPaymentId} IS NOT NULL AND length(trim(${t.reason})) > 0)`,
    ),
  }),
);

export type PaymentTransactionRow = typeof paymentTransactions.$inferSelect;
export type PaymentTransactionInsert = typeof paymentTransactions.$inferInsert;

// --- patient_credit_adjustments (D50/D27 append-only) ---------------------

export const patientCreditAdjustments = pgTable(
  'patient_credit_adjustments',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    patientCreditId: uuid('patient_credit_id')
      .notNull()
      .references(() => patientCredits.id, { onDelete: 'restrict' }),
    /** Id opaco do Payments: correlação/idempotência, nunca navegação por FK. */
    patientChargeId: uuid('patient_charge_id').notNull(),
    kind: patientCreditAdjustmentKind('kind').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    sourceEventId: uuid('source_event_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    creditIdx: index('patient_credit_adjustments_credit_idx').on(t.patientCreditId, t.occurredAt),
    chargeIdx: index('patient_credit_adjustments_charge_idx').on(t.clinicId, t.patientChargeId),
    sourceEventUniq: unique('patient_credit_adjustments_source_event_uniq').on(
      t.clinicId,
      t.sourceEventId,
    ),
  }),
);

export type PatientCreditAdjustmentRow = typeof patientCreditAdjustments.$inferSelect;

// --- payment_proofs (comprovantes; append-only; preparado p/ OCR) ----------

export const paymentProofs = pgTable(
  'payment_proofs',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(), // REGRA 1: clinic_id mesmo sendo filho do lançamento
    lancamentoId: uuid('lancamento_id')
      .notNull()
      .references(() => lancamentos.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id').references(() => paymentTransactions.id, {
      onDelete: 'restrict',
    }),
    type: paymentProofType('type').notNull(),
    fileStoragePath: text('file_storage_path').notNull(),
    ocrData: jsonb('ocr_data'), // nullable — preparado p/ OCR futuro; NÃO implementar agora
    uploadedBy: uuid('uploaded_by'), // FK auth.users via migration
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    clinicLancamentoIdx: index('payment_proofs_clinic_lancamento_idx').on(
      t.clinicId,
      t.lancamentoId,
    ),
    transactionIdx: index('payment_proofs_transaction_id_idx').on(t.transactionId),
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
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
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

// --- collection_cases (fila humana de cobranca antiga) --------------------

export const collectionCases = pgTable(
  'collection_cases',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    lancamentoId: uuid('lancamento_id')
      .notNull()
      .references(() => lancamentos.id, { onDelete: 'restrict' }),
    stage: collectionCaseStage('stage').notNull(),
    status: collectionCaseStatus('status').notNull().default('open'),
    daysOverdue: integer('days_overdue').notNull(),
    residualAmount: numeric('residual_amount', { precision: 12, scale: 2 }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestampsPattern(),
  },
  (t) => ({
    lancamentoUniq: uniqueIndex('collection_cases_lancamento_uniq').on(t.lancamentoId),
    clinicStatusIdx: index('collection_cases_clinic_status_idx').on(t.clinicId, t.status),
    overdueChk: check('collection_cases_days_overdue_chk', sql`${t.daysOverdue} >= 15`),
    residualChk: check('collection_cases_residual_amount_chk', sql`${t.residualAmount} > 0`),
  }),
);

export type CollectionCaseRow = typeof collectionCases.$inferSelect;

// --- cash_flow_daily (rollup diário; tabela RLS, NÃO materialized view) -----

export const cashFlowDaily = pgTable(
  'cash_flow_daily',
  {
    clinicId: tenantIdRef(),
    date: date('date').notNull(),
    totalRecebido: numeric('total_recebido', { precision: 14, scale: 2 }).notNull().default('0'),
    totalPago: numeric('total_pago', { precision: 14, scale: 2 }).notNull().default('0'),
    saldo: numeric('saldo', { precision: 14, scale: 2 }).notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.clinicId, t.date] }),
  }),
);

export type CashFlowDailyRow = typeof cashFlowDaily.$inferSelect;
export type CashFlowDailyInsert = typeof cashFlowDaily.$inferInsert;
