import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { createAbacatePayReadClient } from '@/lib/payments/abacatepay/reader';
import { createAbacatePayNegativePaymentReader } from '@/lib/payments/abacatepay/negative-payment';
import type { ManagementDatabase } from './abacatepay-management';
import { recordBillingEvent } from './subscriptions';
import { createPersistentAbacatePayRefundReader } from './abacatepay-statement-scan';
const READBACK_BUDGET_MS = 20_000;

const eventSchema = z.object({
  account_id: z.uuid(),
  event_id: z.string(),
  event_type: z.string(),
  subscription_id: z.uuid().nullable(),
  clinic_id: z.uuid().nullable(),
  external_subscription_id: z.string().nullable(),
  external_checkout_id: z.string().nullable(),
  external_customer_id: z.string().nullable(),
  received_at: z.coerce.date(),
});
const contextSchema = z.object({
  subscription_id: z.uuid(),
  clinic_id: z.uuid(),
  external_subscription_id: z.string(),
  external_customer_id: z.string(),
  external_checkout_id: z.string(),
  origin_checkout_id: z.string(),
  product_id: z.string(),
  amount_minor: z.coerce.number().int().positive(),
  current_generation: z.boolean(),
  period_end: z.coerce.date().nullable(),
});

/** Saves a bound readback beside an authenticated notification, never a fabricated financial transition. */
export async function readAbacatePayNegativeEvent(
  database: ManagementDatabase,
  eventId: string,
  deadlineMs = Date.now() + READBACK_BUDGET_MS,
) {
  const [event] = z
    .array(eventSchema)
    .max(1)
    .parse(
      await database.execute(sql`SELECT account_id::text,event_id,event_type,subscription_id::text,clinic_id::text,
    external_subscription_id,external_checkout_id,external_customer_id,received_at FROM billing_gateway.event_inbox
    WHERE event_id=${eventId} AND account_id IN(SELECT id FROM billing_gateway.accounts WHERE provider='abacatepay'
      AND environment='sandbox' AND external_account_id=${env.ABACATEPAY_STORE_ID})`),
    );
  if (!event || !env.ABACATEPAY_API_KEY || !env.ABACATEPAY_STORE_ID) return null;
  const [context] = z
    .array(contextSchema)
    .max(1)
    .parse(
      await database.execute(sql`
    WITH owned AS (
      SELECT b.subscription_id,b.clinic_id,b.account_id,b.external_subscription_id,b.external_customer_id,b.external_checkout_id,i.product_id,i.amount_minor,p.period_end
      FROM billing_gateway.bindings b JOIN billing_gateway.checkout_intents i USING(subscription_id,clinic_id,account_id)
      JOIN billing_gateway.paid_checkouts p ON p.account_id=b.account_id AND p.checkout_id=b.external_checkout_id
      UNION ALL
      SELECT r.subscription_id,r.clinic_id,r.account_id,r.external_subscription_id,r.external_customer_id,r.external_checkout_id,r.product_id,r.amount_minor,r.period_end
      FROM billing_gateway.recontracts r WHERE r.invoice_id IS NOT NULL
      UNION ALL
      SELECT o.subscription_id,o.clinic_id,o.account_id,o.external_subscription_id,o.external_customer_id,o.checkout_id,o.product_id,o.amount_minor,p.period_end
      FROM billing_gateway.recurring_payment_observations o LEFT JOIN billing_gateway.recurring_access_periods p
        ON p.account_id=o.account_id AND p.payment_id=o.payment_id AND p.subscription_id=o.subscription_id AND p.clinic_id=o.clinic_id
    ) SELECT o.subscription_id::text,o.clinic_id::text,o.external_subscription_id,o.external_customer_id,o.external_checkout_id,o.product_id,o.amount_minor::text,o.period_end,
      coalesce((SELECT r.external_checkout_id FROM billing_gateway.recontracts r WHERE r.subscription_id=s.id
        AND r.external_subscription_id=o.external_subscription_id AND r.invoice_id IS NOT NULL),b.external_checkout_id) origin_checkout_id,
      (o.external_subscription_id=coalesce((SELECT r.external_subscription_id FROM billing_gateway.recontracts r
        WHERE r.subscription_id=s.id AND r.invoice_id IS NOT NULL ORDER BY r.created_at DESC,r.id DESC LIMIT 1),b.external_subscription_id)) current_generation
    FROM owned o JOIN public.subscriptions s ON s.id=o.subscription_id AND s.clinic_id=o.clinic_id
    JOIN billing_gateway.bindings b ON b.subscription_id=s.id AND b.account_id=o.account_id
    WHERE o.account_id=${event.account_id}::uuid AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL
      AND (${event.subscription_id}::uuid IS NULL OR o.subscription_id=${event.subscription_id}::uuid)
      AND (${event.clinic_id}::uuid IS NULL OR o.clinic_id=${event.clinic_id}::uuid)
      AND (${event.external_subscription_id}::text IS NULL OR o.external_subscription_id=${event.external_subscription_id})
      AND (${event.external_customer_id}::text IS NULL OR o.external_customer_id=${event.external_customer_id})
      AND ((${event.external_checkout_id}::text IS NOT NULL AND o.external_checkout_id=${event.external_checkout_id})
        OR (${event.external_checkout_id}::text IS NULL AND o.external_checkout_id IN(
          SELECT b.external_checkout_id FROM billing_gateway.bindings b WHERE b.subscription_id=s.id
          UNION ALL SELECT r.external_checkout_id FROM billing_gateway.recontracts r WHERE r.subscription_id=s.id AND r.invoice_id IS NOT NULL)))`),
    );
  if (!context) return null;
  const config = {
    apiKey: env.ABACATEPAY_API_KEY,
    environment: 'sandbox' as const,
    timeoutMs: 2000,
    deadlineMs,
  };
  const read = createAbacatePayReadClient(config);
  if ((await read.readStore()).id !== env.ABACATEPAY_STORE_ID) return null;
  const remote = await read.readSubscription(context.external_subscription_id);
  if (
    remote.customerId !== context.external_customer_id ||
    remote.checkoutId !== context.origin_checkout_id
  )
    return null;
  const refund =
    event.event_type === 'checkout.refunded'
      ? await createAbacatePayNegativePaymentReader(
          { provider: 'abacatepay', environment: 'sandbox', accountId: env.ABACATEPAY_STORE_ID },
          config,
          fetch,
          context.external_checkout_id === context.origin_checkout_id
            ? {
                checkoutId: context.external_checkout_id,
                customerId: context.external_customer_id,
                productId: context.product_id,
                amountMinor: context.amount_minor,
              }
            : undefined,
          createPersistentAbacatePayRefundReader(database, {
            provider: 'abacatepay',
            environment: 'sandbox',
            accountId: env.ABACATEPAY_STORE_ID,
          }),
        ).readRefund({
          checkoutId: context.external_checkout_id,
          customerId: context.external_customer_id,
          productId: context.product_id,
          expectedAmountMinor: context.amount_minor,
          windowStart: new Date(event.received_at.getTime() - 31 * 86_400_000).toISOString(),
          windowEnd: new Date(event.received_at.getTime() + 60_000).toISOString(),
        })
      : null;
  return {
    eventId,
    eventType: event.event_type,
    externalSubscriptionId: context.external_subscription_id,
    sourcePeriodEnd: context.period_end?.toISOString() ?? null,
    subscriptionId: context.subscription_id,
    clinicId: context.clinic_id,
    evidenceLevel: refund?.evidenceLevel ?? 'subscription_status_only',
    recurrenceStatus: remote.status,
    currentGeneration: context.current_generation,
    refundDebitMinor: refund?.refundDebitMinor ?? null,
    reversalObserved: refund?.reversalObserved ?? false,
    checkoutStatus: refund?.checkoutStatus ?? null,
  };
}

/** Approved policy: preserve paid end, review manually; never let an old cycle shorten a newer one. */
export async function recordAbacatePayNegativeEventTx(
  tx: Tx,
  evidence: NonNullable<Awaited<ReturnType<typeof readAbacatePayNegativeEvent>>>,
) {
  await tx.execute(
    sql`SELECT id FROM public.subscriptions WHERE id=${evidence.subscriptionId}::uuid AND clinic_id=${evidence.clinicId}::uuid FOR UPDATE`,
  );
  if (evidence.evidenceLevel === 'refund_debit_verified' && evidence.sourcePeriodEnd) {
    // Do not revoke the paid period or cancel recurrence. A confirmed loss in
    // this exact cycle must not acquire additional unpaid grace after its end.
    await tx.execute(sql`UPDATE public.subscriptions s SET grace_period_until=s.current_period_end
      WHERE s.id=${evidence.subscriptionId}::uuid AND s.clinic_id=${evidence.clinicId}::uuid
        AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL AND s.billing_status IN ('active','past_due')
        AND s.current_period_end=${evidence.sourcePeriodEnd}::timestamptz AND s.grace_period_until>s.current_period_end
        AND ${evidence.externalSubscriptionId}=coalesce((SELECT r.external_subscription_id FROM billing_gateway.recontracts r
          WHERE r.subscription_id=s.id AND r.invoice_id IS NOT NULL ORDER BY r.created_at DESC,r.id DESC LIMIT 1),
          (SELECT b.external_subscription_id FROM billing_gateway.bindings b WHERE b.subscription_id=s.id))`);
  }
  await recordBillingEvent(tx, evidence.clinicId, 'subscription.financial.notification_checked', {
    provider: 'abacatepay',
    ...evidence,
    accessEffect: 'keep_paid_period_human_review',
  });
}
