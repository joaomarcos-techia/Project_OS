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
  planSeatLimits,
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
} from './events';

// API interna versionada — consumida por Identity (trava de usuários) e telas.
export { billingApiV1, type BillingApiV1 } from './api';
export type {
  PlanCode,
  QuotaType,
  QuotaCheckResult,
  SeatCategory,
  SeatDimension,
  SeatLimits,
  SeatQuotaResult,
  SeatUsage,
} from './api';
export {
  OFFER_2026,
  OFFER_2026_PLAN_CODES,
  isOffer2026PlanCode,
  offer2026MonthlyCents,
  offer2026PlanCodeFor,
  offer2026Professionals,
  offer2026StaffLimit,
  planCatalogOf,
  type Offer2026PlanCode,
  type PlanCatalog,
} from './offer-2026';
