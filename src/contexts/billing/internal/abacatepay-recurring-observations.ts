import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Tx } from '@/lib/db';
import { billingAccountSchema, opaqueBillingId } from '@/lib/payments/saas/contracts';
import type { RecurringPaymentEvidence } from '@/lib/payments/saas/recurring-payment';

const evidenceSchema = z
  .object({
    account: billingAccountSchema,
    subscriptionId: opaqueBillingId,
    customerId: opaqueBillingId,
    originCheckoutId: opaqueBillingId,
    checkoutId: opaqueBillingId,
    productId: opaqueBillingId,
    paymentId: opaqueBillingId,
    statementId: opaqueBillingId,
    amountMinor: z.number().int().positive().max(999_999_999_999),
    paidAmountMinor: z.number().int().positive().max(999_999_999_999),
    currency: z.literal('BRL'),
    confirmedAt: z.iso.datetime({ offset: true }),
    chargeCreatedAt: z.iso.datetime({ offset: true }),
    method: z.literal('card'),
    recurrence: z.enum(['running', 'stopped']),
    obligation: z.literal('paid'),
    settlement: z.literal('unknown'),
  })
  .strict();
const contextSchema = z.object({
  account_id: z.uuid(),
  subscription_id: z.uuid(),
  clinic_id: z.uuid(),
  price_id: z.uuid(),
  product_id: z.string(),
  amount_minor: z.coerce.number().int().positive(),
});

/**
 * Financial observation only: no invoice, access extension, dunning reset or quota
 * release. Ownership comes from the authenticated inbox and the immutable paid
 * generation. A future entitlement decision must link this evidence separately.
 */
export async function recordAbacatePayRecurringPaymentTx(
  tx: Tx,
  evidenceInput: RecurringPaymentEvidence,
  sourceEventId: string,
): Promise<'recorded' | 'duplicate' | 'review'> {
  const parsed = evidenceSchema.safeParse(evidenceInput);
  if (!parsed.success || !opaqueBillingId.safeParse(sourceEventId).success) return 'review';
  const evidence = parsed.data;
  if (
    evidence.account.provider !== 'abacatepay' ||
    evidence.account.environment !== 'sandbox' ||
    evidence.amountMinor !== evidence.paidAmountMinor ||
    evidence.checkoutId === evidence.originCheckoutId
  )
    return 'review';
  const [context] = z
    .array(contextSchema)
    .max(1)
    .parse(
      await tx.execute(sql`
    SELECT a.id::text account_id,b.subscription_id::text,b.clinic_id::text,
      coalesce(r.price_id,i.price_id)::text price_id,coalesce(r.product_id,i.product_id) product_id,
      coalesce(r.amount_minor,i.amount_minor)::text amount_minor
    FROM billing_gateway.event_inbox e JOIN billing_gateway.accounts a ON a.id=e.account_id
    JOIN billing_gateway.bindings b ON b.account_id=a.id
    JOIN public.subscriptions s ON s.id=b.subscription_id AND s.clinic_id=b.clinic_id
    LEFT JOIN billing_gateway.recontracts r ON r.account_id=a.id
      AND r.subscription_id=s.id AND r.clinic_id=s.clinic_id
      AND r.external_subscription_id=${evidence.subscriptionId} AND r.invoice_id IS NOT NULL
    LEFT JOIN billing_gateway.checkout_intents i ON i.subscription_id=s.id AND i.account_id=a.id AND i.clinic_id=s.clinic_id
    WHERE a.provider='abacatepay' AND a.environment='sandbox' AND a.external_account_id=${evidence.account.accountId}
      AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL
      AND e.event_id=${sourceEventId} AND e.event_type='subscription.renewed'
      AND (e.subscription_id IS NULL OR e.subscription_id=b.subscription_id)
      AND (e.clinic_id IS NULL OR e.clinic_id=b.clinic_id)
      AND e.external_subscription_id=${evidence.subscriptionId} AND e.external_customer_id=${evidence.customerId}
      AND e.external_checkout_id=${evidence.checkoutId} AND e.external_payment_id=${evidence.paymentId}
      AND ((r.id IS NOT NULL AND r.external_checkout_id=${evidence.originCheckoutId} AND r.external_customer_id=${evidence.customerId})
        OR (r.id IS NULL AND b.external_subscription_id=${evidence.subscriptionId}
          AND b.external_checkout_id=${evidence.originCheckoutId} AND b.external_customer_id=${evidence.customerId}
          AND EXISTS(SELECT 1 FROM billing_gateway.paid_checkouts p WHERE p.account_id=a.id
            AND p.checkout_id=b.external_checkout_id AND p.subscription_id=s.id AND p.clinic_id=s.clinic_id)))
    FOR UPDATE OF b,s`),
    );
  if (
    !context ||
    context.product_id !== evidence.productId ||
    context.amount_minor !== evidence.amountMinor
  )
    return 'review';
  const inserted = z
    .array(z.object({ payment_id: z.string() }))
    .max(1)
    .parse(
      await tx.execute(sql`
    INSERT INTO billing_gateway.recurring_payment_observations
      (account_id,payment_id,statement_id,checkout_id,origin_checkout_id,external_subscription_id,
        external_customer_id,subscription_id,clinic_id,source_event_id,price_id,product_id,amount_minor,
        currency,charge_created_at,confirmed_at,observed_recurrence,settlement)
    VALUES(${context.account_id}::uuid,${evidence.paymentId},${evidence.statementId},${evidence.checkoutId},
      ${evidence.originCheckoutId},${evidence.subscriptionId},${evidence.customerId},
      ${context.subscription_id}::uuid,${context.clinic_id}::uuid,${sourceEventId},
      ${context.price_id}::uuid,${evidence.productId},${evidence.amountMinor},'BRL',
      ${evidence.chargeCreatedAt}::timestamptz,${evidence.confirmedAt}::timestamptz,${evidence.recurrence},'unknown')
    ON CONFLICT DO NOTHING RETURNING payment_id`),
    );
  if (inserted.length === 1) return 'recorded';
  const same = z
    .array(z.object({ payment_id: z.string() }))
    .max(1)
    .parse(
      await tx.execute(sql`
    SELECT payment_id FROM billing_gateway.recurring_payment_observations
    WHERE account_id=${context.account_id}::uuid AND payment_id=${evidence.paymentId}
      AND statement_id=${evidence.statementId} AND checkout_id=${evidence.checkoutId}
      AND origin_checkout_id=${evidence.originCheckoutId} AND external_subscription_id=${evidence.subscriptionId}
      AND external_customer_id=${evidence.customerId} AND subscription_id=${context.subscription_id}::uuid
      AND clinic_id=${context.clinic_id}::uuid AND price_id=${context.price_id}::uuid
      AND product_id=${evidence.productId} AND amount_minor=${evidence.amountMinor}
      AND charge_created_at=${evidence.chargeCreatedAt}::timestamptz
      AND confirmed_at=${evidence.confirmedAt}::timestamptz`),
    );
  return same.length === 1 ? 'duplicate' : 'review';
}
