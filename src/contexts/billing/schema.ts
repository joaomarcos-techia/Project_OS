/**
 * Billing schema (C13) — cobrança das clínicas (SaaS). Asaas é infraestrutura
 * atrás de um adapter; este contexto é dono do modelo (ADR-025).
 *
 * Categorias (ADR-007):
 *   - GLOBAIS (catálogo, sem clinic_id): plans, prices, plan_limits — leitura
 *     authenticated, escrita via migration/service_role (padrão `payment_methods`).
 *   - PLATAFORMA (pré-tenant / cross-tenant, sem clinic_id ou nullable): checkout_sessions,
 *     tenant_provisioning, processed_webhooks, billing_reconciliation_runs — RLS
 *     ENABLE+FORCE sem policy authenticated; acesso só via dbAdmin (service_role).
 *   - TENANT-SCOPED (clinic_id via tenantIdRef): billing_customers, subscriptions,
 *     subscription_history, invoices, invoice_items, payment_attempts, setup_fees,
 *     annual_prepayments, usage_metrics, usage_counter_ledger, billing_events →
 *     RLS defaultTenantPolicy(v1).
 *
 * Decisões frozen (ADR-024/025):
 *   - Dinheiro = numeric(12,2); cálculo em centavos (Money); nunca float.
 *   - Plano ≠ preço (prices com histórico); limites NUMÉRICOS (plan_limits).
 *   - Sem overage (invoices não tem overage_amount).
 *   - Transições de status monotônicas no domínio (state-machine.ts).
 *
 * FK cross-context (clinics): tenantIdRef() (intra via helper sancionado). Colunas
 * uuid puras (created_by/cancelled_by → auth.users; clinic_id nullable) recebem FK
 * na migration (boundaries proíbe context→context FK no Drizzle).
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
} from 'drizzle-orm/pg-core';

// eslint-disable-next-line boundaries/element-types -- D35: tenantIdRef (FK clinics) vive no schema de tenancy por design (mesma exceção de identity/financial).
import { tenantIdRef } from '@/contexts/tenancy';
import { timestampsPattern, uuidPk } from '@/lib/db/types';

import './events'; // side-effect: registra billing.* no catálogo do outbox.

// --- enums -----------------------------------------------------------------

export const billingCycle = pgEnum('billing_cycle', ['monthly', 'annual']);

export const subscriptionBillingStatus = pgEnum('subscription_billing_status', [
  'trial',
  'active',
  'past_due',
  'cancelled',
]);

export const invoiceStatus = pgEnum('invoice_status', [
  'open',
  'partial', // F6: reservado (boleto parcial/crédito/ajuste) — não usado no MVP
  'paid',
  'overdue',
  'cancelled',
]);

export const invoiceItemType = pgEnum('invoice_item_type', [
  'plan',
  'setup',
  'discount',
  'credit',
]);

export const checkoutStatus = pgEnum('checkout_status', ['pending', 'completed', 'expired']);

export const provisioningStatus = pgEnum('provisioning_status', [
  'pending',
  'provisioning',
  'ready',
  'failed',
]);

export const setupFeeStatus = pgEnum('setup_fee_status', ['pending', 'paid', 'cancelled']);

export const paymentAttemptStatus = pgEnum('payment_attempt_status', [
  'pending',
  'confirmed',
  'declined',
  'refunded',
]);

// ADR-024: métricas de CAPACIDADE numérica — jamais flag booleana de feature.
export const planLimitMetric = pgEnum('plan_limit_metric', [
  'users',
  'agendamentos',
  'ai_messages',
]);

// =====================================================================
// GLOBAIS — catálogo (sem clinic_id)
// =====================================================================

export const plans = pgTable('plans', {
  id: uuidPk(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  ativo: boolean('ativo').notNull().default(true),
  ...timestampsPattern(),
}, (t) => ({
  codeUniq: unique('plans_code_uniq').on(t.code),
  codeFmt: check('plans_code_chk', sql`${t.code} ~ '^[a-z][a-z0-9_]{1,30}$'`),
}));
export type PlanRow = typeof plans.$inferSelect;

export const prices = pgTable('prices', {
  id: uuidPk(),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('BRL'),
  billingCycle: billingCycle('billing_cycle').notNull(),
  activeFrom: timestamp('active_from', { withTimezone: true }).notNull().default(sql`now()`),
  activeUntil: timestamp('active_until', { withTimezone: true }), // null = vigente
  ...timestampsPattern(),
}, (t) => ({
  planIdx: index('prices_plan_id_idx').on(t.planId),
  // Um preço vigente por (plano, ciclo): garante resolução determinística.
  activeUniq: uniqueIndex('prices_active_uniq')
    .on(t.planId, t.billingCycle)
    .where(sql`active_until IS NULL`),
  amountChk: check('prices_amount_chk', sql`${t.amount} >= 0`),
}));
export type PriceRow = typeof prices.$inferSelect;

export const planLimits = pgTable('plan_limits', {
  id: uuidPk(),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  metric: planLimitMetric('metric').notNull(),
  limitValue: integer('limit_value').notNull(),
}, (t) => ({
  planMetricUniq: unique('plan_limits_plan_metric_uniq').on(t.planId, t.metric),
  valueChk: check('plan_limits_value_chk', sql`${t.limitValue} >= 0`),
}));
export type PlanLimitRow = typeof planLimits.$inferSelect;

// =====================================================================
// PLATAFORMA — pré-tenant / cross-tenant
// =====================================================================

// Lead do checkout: existe ANTES da clínica (G2). clinic_id setado na conversão.
export const checkoutSessions = pgTable('checkout_sessions', {
  id: uuidPk(),
  email: text('email').notNull(),
  document: text('document'),
  clinicName: text('clinic_name').notNull(),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  billingCycle: billingCycle('billing_cycle').notNull().default('monthly'),
  status: checkoutStatus('status').notNull().default('pending'),
  idempotencyKey: text('idempotency_key').notNull(),
  clinicId: uuid('clinic_id'), // nullable; FK clinics via migration; setado na conversão
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => ({
  idemUniq: unique('checkout_sessions_idem_uniq').on(t.idempotencyKey),
  statusIdx: index('checkout_sessions_status_idx').on(t.status),
  // A6/N1: FK clinic_id é SET NULL no offboarding; a tabela cresce com o volume de
  // tentativas de signup (lead pré-clínica), não com o nº de clínicas.
  clinicIdx: index('checkout_sessions_clinic_id_idx').on(t.clinicId),
}));
export type CheckoutSessionRow = typeof checkoutSessions.$inferSelect;

// Saga de provisionamento de tenant (F3) — retomável.
export const tenantProvisioning = pgTable('tenant_provisioning', {
  id: uuidPk(),
  checkoutSessionId: uuid('checkout_session_id').references(() => checkoutSessions.id, {
    onDelete: 'set null',
  }),
  clinicId: uuid('clinic_id'), // nullable até a clínica ser criada; FK via migration
  status: provisioningStatus('status').notNull().default('pending'),
  step: text('step'), // último passo concluído (clinic|customer|subscription|owner|defaults)
  error: text('error'),
  ...timestampsPattern(),
}, (t) => ({
  statusIdx: index('tenant_provisioning_status_idx').on(t.status),
  sessionIdx: index('tenant_provisioning_session_idx').on(t.checkoutSessionId),
}));
export type TenantProvisioningRow = typeof tenantProvisioning.$inferSelect;

// Dedup/replay de webhooks Asaas (F-original webhook).
export const processedWebhooks = pgTable('processed_webhooks', {
  asaasEventId: text('asaas_event_id').primaryKey(),
  clinicId: uuid('clinic_id'),
  eventType: text('event_type').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => ({
  // A6/N1: a FK clinic_id é SET NULL no offboarding de clínica, e esta tabela
  // cresce com o VOLUME de webhooks (não com o nº de clínicas) — sem índice, o
  // offboarding faz seq scan de tudo que o Asaas já mandou.
  clinicIdx: index('processed_webhooks_clinic_id_idx').on(t.clinicId),
}));
export type ProcessedWebhookRow = typeof processedWebhooks.$inferSelect;

// Auditoria das execuções de reconciliação (F8).
export const billingReconciliationRuns = pgTable('billing_reconciliation_runs', {
  id: uuidPk(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().default(sql`now()`),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  foundDivergences: integer('found_divergences').notNull().default(0),
  fixedCount: integer('fixed_count').notNull().default(0),
});
export type BillingReconciliationRunRow = typeof billingReconciliationRuns.$inferSelect;

// =====================================================================
// TENANT-SCOPED
// =====================================================================

export const billingCustomers = pgTable('billing_customers', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  name: text('name').notNull(),
  document: text('document'),
  email: text('email').notNull(),
  phone: text('phone'),
  asaasCustomerId: text('asaas_customer_id'),
  ...timestampsPattern(),
}, (t) => ({
  clinicUniq: unique('billing_customers_clinic_uniq').on(t.clinicId),
  clinicIdx: index('billing_customers_clinic_id_idx').on(t.clinicId),
}));
export type BillingCustomerRow = typeof billingCustomers.$inferSelect;

export const subscriptions = pgTable('subscriptions', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  priceId: uuid('price_id').notNull().references(() => prices.id, { onDelete: 'restrict' }),
  billingStatus: subscriptionBillingStatus('billing_status').notNull().default('trial'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().default(sql`now()`),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  gracePeriodUntil: timestamp('grace_period_until', { withTimezone: true }), // G9
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }), // G7
  cancelReason: text('cancel_reason'),
  cancelledBy: uuid('cancelled_by'), // FK auth.users via migration (sem FK, padrão *_by)
  asaasSubscriptionId: text('asaas_subscription_id'),
  dunningStage: integer('dunning_stage').notNull().default(0), // monotônico (0/1/3/7/15/30)
  ...timestampsPattern(),
}, (t) => ({
  clinicUniq: unique('subscriptions_clinic_uniq').on(t.clinicId),
  clinicIdx: index('subscriptions_clinic_id_idx').on(t.clinicId),
  statusIdx: index('subscriptions_billing_status_idx').on(t.billingStatus),
}));
export type SubscriptionRow = typeof subscriptions.$inferSelect;

export const subscriptionHistory = pgTable('subscription_history', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  subscriptionId: uuid('subscription_id')
    .notNull()
    .references(() => subscriptions.id, { onDelete: 'cascade' }),
  oldPlanId: uuid('old_plan_id'),
  newPlanId: uuid('new_plan_id'),
  oldStatus: text('old_status'),
  newStatus: text('new_status'),
  changedBy: uuid('changed_by'), // auth.users ou null (sistema)
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => ({
  clinicSubIdx: index('subscription_history_clinic_sub_idx').on(t.clinicId, t.subscriptionId),
}));
export type SubscriptionHistoryRow = typeof subscriptionHistory.$inferSelect;

export const invoices = pgTable('invoices', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
    onDelete: 'set null',
  }),
  periodStart: date('period_start'),
  periodEnd: date('period_end'),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
  status: invoiceStatus('status').notNull().default('open'),
  dueDate: date('due_date').notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  asaasPaymentId: text('asaas_payment_id'),
  nfeUrl: text('nfe_url'),
  paymentMethod: text('payment_method'),
  ...timestampsPattern(),
}, (t) => ({
  clinicStatusIdx: index('invoices_clinic_status_idx').on(t.clinicId, t.status),
  dueIdx: index('invoices_due_idx').on(t.status, t.dueDate),
  // Resolução do webhook por asaas_payment_id (e dedup de geração).
  asaasPaymentUniq: uniqueIndex('invoices_asaas_payment_uniq')
    .on(t.asaasPaymentId)
    .where(sql`asaas_payment_id IS NOT NULL`),
  totalChk: check('invoices_total_chk', sql`${t.totalAmount} >= 0`),
  paidCoerenciaChk: check(
    'invoices_paid_coerencia_chk',
    sql`${t.status} <> 'paid' OR ${t.paidAt} IS NOT NULL`,
  ),
}));
export type InvoiceRow = typeof invoices.$inferSelect;

export const invoiceItems = pgTable('invoice_items', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  type: invoiceItemType('type').notNull(),
  description: text('description').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => ({
  clinicInvoiceIdx: index('invoice_items_clinic_invoice_idx').on(t.clinicId, t.invoiceId),
}));
export type InvoiceItemRow = typeof invoiceItems.$inferSelect;

export const paymentAttempts = pgTable('payment_attempts', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('asaas'),
  providerPaymentId: text('provider_payment_id'),
  status: paymentAttemptStatus('status').notNull(),
  failureReason: text('failure_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => ({
  clinicInvoiceIdx: index('payment_attempts_clinic_invoice_idx').on(t.clinicId, t.invoiceId),
}));
export type PaymentAttemptRow = typeof paymentAttempts.$inferSelect;

export const setupFees = pgTable('setup_fees', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  valor: numeric('valor', { precision: 12, scale: 2 }).notNull(),
  status: setupFeeStatus('status').notNull().default('pending'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  asaasPaymentId: text('asaas_payment_id'),
  ...timestampsPattern(),
}, (t) => ({
  clinicIdx: index('setup_fees_clinic_id_idx').on(t.clinicId),
  valorChk: check('setup_fees_valor_chk', sql`${t.valor} >= 0`),
}));
export type SetupFeeRow = typeof setupFees.$inferSelect;

export const annualPrepayments = pgTable('annual_prepayments', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  valorTotal: numeric('valor_total', { precision: 12, scale: 2 }).notNull(),
  valorEconomizado: numeric('valor_economizado', { precision: 12, scale: 2 }).notNull().default('0'),
  validUntil: date('valid_until').notNull(),
  refundEligibleUntil: date('refund_eligible_until').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => ({
  clinicIdx: index('annual_prepayments_clinic_id_idx').on(t.clinicId),
  valorChk: check('annual_prepayments_valor_chk', sql`${t.valorTotal} >= 0`),
}));
export type AnnualPrepaymentRow = typeof annualPrepayments.$inferSelect;

export const usageMetrics = pgTable('usage_metrics', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  periodYyyymm: text('period_yyyymm').notNull(), // 'YYYY-MM'
  agendamentosCount: integer('agendamentos_count').notNull().default(0),
  conversasIaCount: integer('conversas_ia_count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => ({
  clinicPeriodUniq: unique('usage_metrics_clinic_period_uniq').on(t.clinicId, t.periodYyyymm),
  clinicIdx: index('usage_metrics_clinic_id_idx').on(t.clinicId),
  periodFmt: check('usage_metrics_period_chk', sql`${t.periodYyyymm} ~ '^[0-9]{4}-[0-9]{2}$'`),
}));
export type UsageMetricsRow = typeof usageMetrics.$inferSelect;

// Ledger GENÉRICO (G6): idempotência exatamente-1× da contagem. A REGRA (qual
// dedup_key/subject) vive em quota_policy.ts, não aqui.
export const usageCounterLedger = pgTable('usage_counter_ledger', {
  clinicId: tenantIdRef(),
  metric: text('metric').notNull(),
  subjectId: text('subject_id').notNull(),
  dedupKey: text('dedup_key').notNull(),
  periodYyyymm: text('period_yyyymm').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => ({
  pk: primaryKey({ columns: [t.clinicId, t.metric, t.dedupKey] }),
}));
export type UsageCounterLedgerRow = typeof usageCounterLedger.$inferSelect;

// Timeline da conta (G1) — append-only, legível, NENHUM consumidor depende.
export const billingEvents = pgTable('billing_events', {
  id: uuidPk(),
  clinicId: tenantIdRef(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => ({
  clinicCreatedIdx: index('billing_events_clinic_created_idx').on(t.clinicId, t.createdAt),
}));
export type BillingEventRow = typeof billingEvents.$inferSelect;
