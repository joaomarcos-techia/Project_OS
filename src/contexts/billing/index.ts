// Superfície pública do contexto `billing` (C13).
// Outros contextos só importam deste arquivo (eslint-plugin-boundaries).
//
// Expõe: entidades de schema + enums, nomes/payloads de evento, e a API interna
// versionada. Server Actions, queries e internals NÃO fazem parte da superfície
// cross-context — vizinhos (Identity) reagem via eventos do outbox.
export {
  // catálogo global
  plans,
  prices,
  planLimits,
  // plataforma
  checkoutSessions,
  tenantProvisioning,
  processedWebhooks,
  billingReconciliationRuns,
  // tenant-scoped
  billingCustomers,
  subscriptions,
  subscriptionHistory,
  invoices,
  invoiceItems,
  paymentAttempts,
  setupFees,
  annualPrepayments,
  usageMetrics,
  usageCounterLedger,
  billingEvents,
  // enums
  billingCycle,
  subscriptionBillingStatus,
  invoiceStatus,
  invoiceItemType,
  checkoutStatus,
  provisioningStatus,
  setupFeeStatus,
  paymentAttemptStatus,
  planLimitMetric,
} from './schema';

export { BILLING_EVENTS } from './events';
export type {
  CustomerCreatedPayload,
  SubscriptionCreatedPayload,
  SubscriptionActivatedPayload,
  SubscriptionChangedPayload,
  SubscriptionCancelledPayload,
  InvoiceGeneratedPayload,
  InvoicePaidPayload,
  InvoiceOverduePayload,
  InvoiceRefundedPayload,
  PaymentFailedPayload,
  TrialStartedPayload,
  ClinicSuspendedPayload,
  ClinicReactivatedPayload,
  ClinicDunningAdvancedPayload,
  AiUsageNoticeRequestedPayload,
} from './events';

// API interna versionada — consumida por Identity (trava de usuários) e telas.
export { billingApiV1, type BillingApiV1 } from './api';
export type { PlanCode, QuotaType, QuotaCheckResult, UserQuotaResult } from './api';
