import 'server-only';

import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Tx } from '@/lib/db';
import {
  billingResourceKey,
  opaqueBillingId,
  type BillingAccount,
} from '@/lib/payments/saas/contracts';
import type { BillingGatewaySql } from '@/lib/payments/saas/postgres-store';
import type {
  RecurringPaymentEvidence,
  RecurringPaymentRead,
} from '@/lib/payments/saas/recurring-payment';
import { createAbacatePayRenewalPaymentReader } from '@/lib/payments/abacatepay/renewal-payment';

import { invoices, paymentAttempts, subscriptions } from '../schema';
import { recordAbacatePayRecurringPaymentTx } from './abacatepay-recurring-observations';
import { abacatePayRenewalPeriod } from './abacatepay-renewal-period';
import { DUNNING_READONLY_DAYS } from './dunning';
import { toCents, toReaisString } from './money';
import { markInvoicePaid, recordBillingEvent } from './subscriptions';

const contextSchema = z.object({
  account_id: z.uuid(),
  subscription_id: z.uuid(),
  clinic_id: z.uuid(),
  external_subscription_id: z.string(),
  external_customer_id: z.string(),
  origin_checkout_id: z.string(),
  checkout_id: z.string(),
  payment_id: z.string(),
  product_id: z.string(),
  price_id: z.uuid(),
  amount_minor: z.coerce.number().int().positive(),
  anchor_start: z.coerce.date(),
  current_period_end: z.coerce.date(),
  received_at: z.coerce.date(),
  billing_status: z.enum(['trial', 'active', 'past_due', 'cancelled']),
  cancel_at_period_end: z.boolean(),
  cancellation_requested: z.boolean(),
  current_generation: z.boolean(),
  current_price: z.string(),
  monthly: z.boolean(),
  plan_change_pending: z.boolean(),
});
type Context = z.infer<typeof contextSchema>;
const SEARCH_WINDOW_DAYS = 31;
const SEARCH_CLOCK_SKEW_MS = 60_000;

async function contextForEvent(
  database: BillingGatewaySql,
  account: BillingAccount,
  eventId: string,
  lock = false,
): Promise<Context | null> {
  if (
    !opaqueBillingId.safeParse(eventId).success ||
    account.provider !== 'abacatepay' ||
    account.environment !== 'sandbox'
  )
    return null;
  const [context] = z
    .array(contextSchema)
    .max(1)
    .parse(
      await database.execute(sql`
    SELECT a.id::text account_id,s.id::text subscription_id,s.clinic_id::text,
      e.external_subscription_id,e.external_customer_id,coalesce(r.external_checkout_id,b.external_checkout_id) origin_checkout_id,
      e.external_checkout_id checkout_id,e.external_payment_id payment_id,
      coalesce(r.product_id,i.product_id) product_id,coalesce(r.price_id,i.price_id)::text price_id,
      coalesce(r.amount_minor,i.amount_minor)::text amount_minor,coalesce(r.period_start,p.period_start) anchor_start,
      s.current_period_end,e.received_at,s.billing_status,s.cancel_at_period_end,
      EXISTS(SELECT 1 FROM billing_gateway.cancellations c WHERE c.account_id=a.id
        AND c.external_subscription_id=e.external_subscription_id) cancellation_requested,
      (e.external_subscription_id=coalesce(latest.external_subscription_id,b.external_subscription_id)) current_generation,
      pr.amount::text current_price,(pr.billing_cycle='monthly' AND pr.currency='BRL') monthly,
      EXISTS(SELECT 1 FROM public.subscription_change_requests change WHERE change.subscription_id=s.id
        AND change.status::text NOT IN ('applied','cancelled','expired','failed')) plan_change_pending
    FROM billing_gateway.event_inbox e JOIN billing_gateway.accounts a ON a.id=e.account_id
    JOIN billing_gateway.bindings b ON b.account_id=a.id
    JOIN public.subscriptions s ON s.id=b.subscription_id AND s.clinic_id=b.clinic_id
    JOIN public.prices pr ON pr.id=s.price_id
    LEFT JOIN billing_gateway.checkout_intents i ON i.subscription_id=s.id AND i.account_id=a.id AND i.clinic_id=s.clinic_id
    LEFT JOIN billing_gateway.paid_checkouts p ON p.account_id=a.id AND p.checkout_id=b.external_checkout_id
      AND p.subscription_id=s.id AND p.clinic_id=s.clinic_id
    LEFT JOIN billing_gateway.recontracts r ON r.account_id=a.id AND r.subscription_id=s.id AND r.clinic_id=s.clinic_id
      AND r.external_subscription_id=e.external_subscription_id AND r.invoice_id IS NOT NULL
    LEFT JOIN LATERAL (SELECT external_subscription_id FROM billing_gateway.recontracts
      WHERE subscription_id=s.id AND invoice_id IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1) latest ON true
    WHERE a.provider='abacatepay' AND a.environment='sandbox' AND a.external_account_id=${account.accountId}
      AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL
      AND e.event_id=${eventId} AND e.event_type='subscription.renewed'
      AND e.external_checkout_id IS NOT NULL AND e.external_payment_id IS NOT NULL AND e.external_customer_id IS NOT NULL
      AND (e.subscription_id IS NULL OR e.subscription_id=s.id) AND (e.clinic_id IS NULL OR e.clinic_id=s.clinic_id)
      AND ((r.id IS NOT NULL AND r.external_customer_id=e.external_customer_id)
        OR (r.id IS NULL AND p.invoice_id IS NOT NULL AND b.external_subscription_id=e.external_subscription_id
          AND b.external_customer_id=e.external_customer_id))
    ${lock ? sql`FOR UPDATE OF s,b` : sql``}`),
    );
  return context ?? null;
}

export async function recurringSchemaReady(database: BillingGatewaySql): Promise<boolean> {
  const [row] = z
    .array(z.object({ ready: z.boolean() }))
    .max(1)
    .parse(
      await database.execute(sql`
    SELECT to_regclass('billing_gateway.recurring_payment_observations') IS NOT NULL
      AND to_regclass('billing_gateway.recurring_access_periods') IS NOT NULL ready`),
    );
  return row?.ready === true;
}

/** Readback uses a fixed receipt-search window, not a newly invented access period. */
export async function readAbacatePayRenewalForEvent(
  database: BillingGatewaySql,
  account: BillingAccount,
  eventId: string,
  apiKey: string,
): Promise<RecurringPaymentRead> {
  if (!(await recurringSchemaReady(database))) return { state: 'review' };
  const context = await contextForEvent(database, account, eventId);
  if (!context) return { state: 'review' };
  const center = context.received_at.getTime();
  return createAbacatePayRenewalPaymentReader(account, {
    apiKey,
    environment: 'sandbox',
    timeoutMs: 2000,
  }).readRenewalPayment({
    subscriptionId: context.external_subscription_id,
    customerId: context.external_customer_id,
    originCheckoutId: context.origin_checkout_id,
    checkoutId: context.checkout_id,
    paymentId: context.payment_id,
    productId: context.product_id,
    expectedAmountMinor: context.amount_minor,
    windowStart: new Date(center - SEARCH_WINDOW_DAYS * 86_400_000).toISOString(),
    windowEnd: new Date(center + SEARCH_CLOCK_SKEW_MS).toISOString(),
  });
}

export type RenewalApplication = 'applied' | 'duplicate' | 'historical' | 'review';

/** The caller holds the inbox lease; observation, invoice, period and rights commit together. */
export async function applyAbacatePayRenewalTx(
  tx: Tx,
  evidence: RecurringPaymentEvidence,
  sourceEventId: string,
  now = new Date(),
): Promise<RenewalApplication> {
  const recorded = await recordAbacatePayRecurringPaymentTx(tx, evidence, sourceEventId);
  if (recorded === 'review') return 'review';
  const context = await contextForEvent(tx, evidence.account, sourceEventId, true);
  if (
    !context ||
    context.amount_minor !== evidence.amountMinor ||
    context.product_id !== evidence.productId
  )
    return 'review';
  const period = abacatePayRenewalPeriod({
    anchorStart: context.anchor_start,
    chargeCreatedAt: evidence.chargeCreatedAt,
    confirmedAt: evidence.confirmedAt,
    now,
  });
  if (!period) return 'review';
  const existing = z
    .array(z.object({ payment_id: z.string() }))
    .max(1)
    .parse(
      await tx.execute(sql`
    SELECT payment_id FROM billing_gateway.recurring_access_periods
    WHERE account_id=${context.account_id}::uuid AND external_subscription_id=${evidence.subscriptionId}
      AND cycle_index=${period.index}`),
    );
  if (existing.length)
    return existing[0]?.payment_id === evidence.paymentId ? 'duplicate' : 'review';
  const canAdvance =
    context.current_generation &&
    context.monthly &&
    !context.plan_change_pending &&
    toCents(context.current_price) === evidence.amountMinor &&
    !context.cancellation_requested &&
    !context.cancel_at_period_end &&
    evidence.recurrence === 'running' &&
    (context.billing_status === 'active' || context.billing_status === 'past_due') &&
    period.end.getTime() > context.current_period_end.getTime() &&
    period.end.getTime() > now.getTime();
  const historical =
    period.end.getTime() <= context.current_period_end.getTime() ||
    period.end.getTime() <= now.getTime();
  const effect = canAdvance ? 'advanced' : historical ? 'historical' : 'review';
  const [invoice] = await tx
    .insert(invoices)
    .values({
      clinicId: context.clinic_id,
      subscriptionId: context.subscription_id,
      totalAmount: toReaisString(evidence.amountMinor),
      status: canAdvance ? 'open' : 'paid',
      paidAt: canAdvance ? null : new Date(evidence.confirmedAt),
      dueDate: period.start.toISOString().slice(0, 10),
      periodStart: period.start.toISOString().slice(0, 10),
      periodEnd: period.end.toISOString().slice(0, 10),
      paymentMethod: 'CARD',
    })
    .returning();
  if (!invoice) throw new Error('Recurring SaaS invoice persistence failed');
  await tx.execute(sql`INSERT INTO billing_gateway.recurring_access_periods
    (account_id,payment_id,external_subscription_id,subscription_id,clinic_id,invoice_id,cycle_index,
      anchor_start,period_start,period_end,access_effect)
    VALUES(${context.account_id}::uuid,${evidence.paymentId},${evidence.subscriptionId},${context.subscription_id}::uuid,
      ${context.clinic_id}::uuid,${invoice.id}::uuid,${period.index},${context.anchor_start.toISOString()}::timestamptz,
      ${period.start.toISOString()}::timestamptz,${period.end.toISOString()}::timestamptz,${effect})`);
  const paymentKey = billingResourceKey(evidence.account, 'payment', evidence.paymentId);
  if (canAdvance) {
    await tx
      .update(subscriptions)
      .set({
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        gracePeriodUntil: new Date(period.end.getTime() + DUNNING_READONLY_DAYS * 86_400_000),
      })
      .where(eq(subscriptions.id, context.subscription_id));
    await markInvoicePaid(tx, context.clinic_id, invoice, {
      provider: 'abacatepay',
      paymentMethod: 'CARD',
      providerPaymentId: paymentKey,
      idemSuffix: `abacatepay:${context.account_id}:${evidence.paymentId}`,
      deferPeriodAdvance: true,
    });
  } else {
    await tx.insert(paymentAttempts).values({
      clinicId: context.clinic_id,
      invoiceId: invoice.id,
      provider: 'abacatepay',
      providerPaymentId: paymentKey,
      status: 'confirmed',
    });
  }
  await recordBillingEvent(tx, context.clinic_id, 'subscription.renewal.payment_recorded', {
    provider: 'abacatepay',
    invoiceId: invoice.id,
    cycleIndex: period.index,
    accessEffect: effect,
    periodSource: 'qoro_original_monthly_calendar',
  });
  return canAdvance ? 'applied' : historical ? 'historical' : 'review';
}
