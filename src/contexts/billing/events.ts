/**
 * Billing context events (C13). Producer-side Zod schemas registrados no catálogo
 * do outbox no load do módulo (importado via barrel `src/lib/db/schema/index.ts`
 * através de `./schema`).
 *
 * Regras frozen (ADR-011 / ADR-025):
 *   - Nomes 3-segmentos `billing.<entity>.<action>` (CHECK regex no outbox).
 *   - Payload JSON-safe: timestamps `z.string().datetime()` (NUNCA z.date());
 *     dinheiro `z.number()` (reais, 2 casas); só ids + escalares NÃO-sensíveis.
 *   - Todo evento carrega `clinicId` — o outbox é tenant-scoped. Por isso o ciclo
 *     de CHECKOUT pré-clínica (`started`/`completed`) NÃO é evento de outbox:
 *     vive em `checkout_sessions.status` + métricas. Os eventos abaixo só são
 *     emitidos depois que a clínica existe (provisionamento concluído).
 *   - billing_events (timeline da conta) é OUTRA coisa: ninguém consome (ADR-025).
 *
 * Contrato congelado e documentado em docs/contracts/events/billing.md.
 */
import { z } from 'zod';

import { registerEventSchema } from '@/lib/outbox/catalog';

import { OFFER_2026_PLAN_CODES } from './proposed-offer';

export const BILLING_EVENTS = {
  CUSTOMER_CREATED: 'billing.customer.created',
  CUSTOMER_PORTAL_REQUESTED: 'billing.customer.portal_requested',
  SUBSCRIPTION_CREATED: 'billing.subscription.created',
  SUBSCRIPTION_ACTIVATED: 'billing.subscription.activated',
  SUBSCRIPTION_CHANGED: 'billing.subscription.changed',
  SUBSCRIPTION_CANCELLED: 'billing.subscription.cancelled',
  INVOICE_GENERATED: 'billing.invoice.generated',
  INVOICE_PAID: 'billing.invoice.paid',
  INVOICE_OVERDUE: 'billing.invoice.overdue',
  INVOICE_REFUNDED: 'billing.invoice.refunded',
  // BILLING-002 — cobrança removida no provedor. Distinto de refunded: nada
  // foi pago nem devolvido; a cobrança deixou de existir.
  INVOICE_CANCELLED: 'billing.invoice.cancelled',
  PAYMENT_FAILED: 'billing.payment.failed',
  TRIAL_STARTED: 'billing.trial.started',
  TRIAL_EXPIRED: 'billing.trial.expired',
  TRIAL_CONVERTED: 'billing.trial.converted',
  CLINIC_SUSPENDED: 'billing.clinic.suspended',
  CLINIC_REACTIVATED: 'billing.clinic.reactivated',
  CLINIC_DUNNING_ADVANCED: 'billing.clinic.dunning_advanced',
} as const;

const uuid = z.string().uuid();
const money = z.number().nonnegative();
const planCode = z.enum(['solo', 'clinica', 'pro', ...OFFER_2026_PLAN_CODES]);
const billingCycle = z.enum(['monthly', 'annual']);

// --- customer --------------------------------------------------------------
export const CustomerCreatedSchema = z.object({
  clinicId: uuid,
  billingCustomerId: uuid,
  asaasCustomerId: z.string().nullable(),
});
export type CustomerCreatedPayload = z.infer<typeof CustomerCreatedSchema>;

export const CustomerPortalRequestedSchema = z.object({
  clinicId: uuid,
  requestedBy: uuid,
});
export type CustomerPortalRequestedPayload = z.infer<typeof CustomerPortalRequestedSchema>;

// --- subscription ----------------------------------------------------------
export const SubscriptionCreatedSchema = z.object({
  clinicId: uuid,
  subscriptionId: uuid,
  planCode,
  priceAmount: money,
  billingCycle,
});
export type SubscriptionCreatedPayload = z.infer<typeof SubscriptionCreatedSchema>;

export const SubscriptionActivatedSchema = z.object({
  clinicId: uuid,
  subscriptionId: uuid,
  planCode,
});
export type SubscriptionActivatedPayload = z.infer<typeof SubscriptionActivatedSchema>;

export const SubscriptionChangedSchema = z.object({
  clinicId: uuid,
  subscriptionId: uuid,
  oldPlanCode: planCode.nullable(),
  newPlanCode: planCode.nullable(),
  oldStatus: z.string(),
  newStatus: z.string(),
});
export type SubscriptionChangedPayload = z.infer<typeof SubscriptionChangedSchema>;

export const SubscriptionCancelledSchema = z.object({
  clinicId: uuid,
  subscriptionId: uuid,
  reason: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
});
export type SubscriptionCancelledPayload = z.infer<typeof SubscriptionCancelledSchema>;

// --- invoice ---------------------------------------------------------------
export const InvoiceGeneratedSchema = z.object({
  clinicId: uuid,
  invoiceId: uuid,
  subscriptionId: uuid.nullable(),
  totalAmount: money,
  dueDate: z.string(),
});
export type InvoiceGeneratedPayload = z.infer<typeof InvoiceGeneratedSchema>;

export const InvoicePaidSchema = z.object({
  clinicId: uuid,
  invoiceId: uuid,
  totalAmount: money,
  paidAt: z.string().datetime(),
  paymentMethod: z.string().nullable(),
});
export type InvoicePaidPayload = z.infer<typeof InvoicePaidSchema>;

export const InvoiceCancelledSchema = z.object({
  clinicId: uuid,
  invoiceId: uuid,
  reason: z.string(),
});
export type InvoiceCancelledPayload = z.infer<typeof InvoiceCancelledSchema>;

export const InvoiceOverdueSchema = z.object({
  clinicId: uuid,
  invoiceId: uuid,
  daysOverdue: z.number().int().nonnegative(),
});
export type InvoiceOverduePayload = z.infer<typeof InvoiceOverdueSchema>;

export const InvoiceRefundedSchema = z.object({
  clinicId: uuid,
  invoiceId: uuid,
  amount: money,
});
export type InvoiceRefundedPayload = z.infer<typeof InvoiceRefundedSchema>;

// --- payment ---------------------------------------------------------------
export const PaymentFailedSchema = z.object({
  clinicId: uuid,
  invoiceId: uuid,
  attemptId: uuid,
  reason: z.string().nullable(),
});
export type PaymentFailedPayload = z.infer<typeof PaymentFailedSchema>;

// --- trial -----------------------------------------------------------------
export const TrialStartedSchema = z.object({
  clinicId: uuid,
  subscriptionId: uuid,
  trialEndsAt: z.string().datetime(),
});
export type TrialStartedPayload = z.infer<typeof TrialStartedSchema>;

export const TrialExpiredSchema = z.object({
  clinicId: uuid,
  subscriptionId: uuid,
});
export type TrialExpiredPayload = z.infer<typeof TrialExpiredSchema>;

export const TrialConvertedSchema = z.object({
  clinicId: uuid,
  subscriptionId: uuid,
});
export type TrialConvertedPayload = z.infer<typeof TrialConvertedSchema>;

// --- clinic access ---------------------------------------------------------
export const ClinicSuspendedSchema = z.object({
  clinicId: uuid,
  mode: z.enum(['readonly', 'blocked']),
  reason: z.string(),
});
export type ClinicSuspendedPayload = z.infer<typeof ClinicSuspendedSchema>;

export const ClinicReactivatedSchema = z.object({
  clinicId: uuid,
});
export type ClinicReactivatedPayload = z.infer<typeof ClinicReactivatedSchema>;

export const ClinicDunningAdvancedSchema = z.object({
  clinicId: uuid,
  subscriptionId: uuid,
  stage: z.number().int().nonnegative(),
  channel: z.enum(['whatsapp', 'email']),
});
export type ClinicDunningAdvancedPayload = z.infer<typeof ClinicDunningAdvancedSchema>;

registerEventSchema(BILLING_EVENTS.CUSTOMER_CREATED, CustomerCreatedSchema);
registerEventSchema(BILLING_EVENTS.CUSTOMER_PORTAL_REQUESTED, CustomerPortalRequestedSchema);
registerEventSchema(BILLING_EVENTS.SUBSCRIPTION_CREATED, SubscriptionCreatedSchema);
registerEventSchema(BILLING_EVENTS.SUBSCRIPTION_ACTIVATED, SubscriptionActivatedSchema);
registerEventSchema(BILLING_EVENTS.SUBSCRIPTION_CHANGED, SubscriptionChangedSchema);
registerEventSchema(BILLING_EVENTS.SUBSCRIPTION_CANCELLED, SubscriptionCancelledSchema);
registerEventSchema(BILLING_EVENTS.INVOICE_GENERATED, InvoiceGeneratedSchema);
registerEventSchema(BILLING_EVENTS.INVOICE_PAID, InvoicePaidSchema);
registerEventSchema(BILLING_EVENTS.INVOICE_CANCELLED, InvoiceCancelledSchema);
registerEventSchema(BILLING_EVENTS.INVOICE_OVERDUE, InvoiceOverdueSchema);
registerEventSchema(BILLING_EVENTS.INVOICE_REFUNDED, InvoiceRefundedSchema);
registerEventSchema(BILLING_EVENTS.PAYMENT_FAILED, PaymentFailedSchema);
registerEventSchema(BILLING_EVENTS.TRIAL_STARTED, TrialStartedSchema);
registerEventSchema(BILLING_EVENTS.TRIAL_EXPIRED, TrialExpiredSchema);
registerEventSchema(BILLING_EVENTS.TRIAL_CONVERTED, TrialConvertedSchema);
registerEventSchema(BILLING_EVENTS.CLINIC_SUSPENDED, ClinicSuspendedSchema);
registerEventSchema(BILLING_EVENTS.CLINIC_REACTIVATED, ClinicReactivatedSchema);
registerEventSchema(BILLING_EVENTS.CLINIC_DUNNING_ADVANCED, ClinicDunningAdvancedSchema);
