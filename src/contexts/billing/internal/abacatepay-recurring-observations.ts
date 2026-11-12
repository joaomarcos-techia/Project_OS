import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Tx } from '@/lib/db';
import { billingAccountSchema, opaqueBillingId } from '@/lib/payments/saas/contracts';
import type { RecurringPaymentEvidence } from '@/lib/payments/saas/recurring-payment';
import {
  abacatePayRenewalSourceRows,
  abacatePayRenewalBindingRows,
  abacatePayRenewalProofHash,
  lockAbacatePayRenewalSubscription,
  parseAbacatePayRenewalSource,
  type AbacatePayRenewalSource,
} from './abacatepay-renewal-source';

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
    providerPeriodStart: z.iso.date().optional(),
    providerPeriodEnd: z.iso.date().optional(),
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
 * release. Ownership comes from an authenticated inbox or private API readback,
 * and the immutable paid generation. Neither source is a manual payment override.
 */
export async function recordAbacatePayRecurringPaymentTx(
  tx: Tx,
  evidenceInput: RecurringPaymentEvidence,
  sourceInput: string | AbacatePayRenewalSource,
): Promise<'recorded' | 'duplicate' | 'review'> {
  const parsed = evidenceSchema.safeParse(evidenceInput);
  const source = parseAbacatePayRenewalSource(sourceInput);
  if (!parsed.success || !source) return 'review';
  const evidence = parsed.data;
  if (
    evidence.account.provider !== 'abacatepay' ||
    evidence.account.environment !== 'sandbox' ||
    evidence.amountMinor !== evidence.paidAmountMinor
  )
    return 'review';
  const originalCheckout = evidence.checkoutId === evidence.originCheckoutId;
  if (
    !originalCheckout &&
    (evidence.providerPeriodStart !== undefined || evidence.providerPeriodEnd !== undefined)
  )
    return 'review';
  if (originalCheckout) {
    const start = evidence.providerPeriodStart,
      end = evidence.providerPeriodEnd;
    const day = new Date(evidence.chargeCreatedAt).toISOString().slice(0, 10);
    if (!start || !end || end <= start || day < start || day >= end) return 'review';
    const [schema] = await tx.execute<{
      ready: boolean;
    }>(sql`SELECT EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='billing_gateway' AND table_name='recurring_payment_observations' AND column_name='provider_period_start') ready`);
    if (!schema?.ready) return 'review';
  }
  await lockAbacatePayRenewalSubscription(tx, evidence.account, source);
  const [context] = z
    .array(contextSchema)
    .max(1)
    .parse(
      await tx.execute(sql`
    SELECT a.id::text account_id,b.subscription_id::text,b.clinic_id::text,
      coalesce(pc.to_price_id,r.price_id,i.price_id)::text price_id,coalesce(pc.product_id,r.product_id,i.product_id) product_id,
      coalesce(pc.amount_minor,r.amount_minor,i.amount_minor)::text amount_minor
    FROM ${abacatePayRenewalSourceRows(source)} e JOIN billing_gateway.accounts a ON a.id=e.account_id
    JOIN ${abacatePayRenewalBindingRows()} bound ON true
    JOIN billing_gateway.bindings b ON b.account_id=a.id AND b.subscription_id=bound.subscription_id AND b.clinic_id=bound.clinic_id
    JOIN public.subscriptions s ON s.id=b.subscription_id AND s.clinic_id=b.clinic_id
    LEFT JOIN billing_gateway.recontracts r ON r.account_id=a.id
      AND r.subscription_id=s.id AND r.clinic_id=s.clinic_id
      AND r.external_subscription_id=${evidence.subscriptionId} AND r.invoice_id IS NOT NULL
    LEFT JOIN billing_gateway.checkout_intents i ON i.subscription_id=s.id AND i.account_id=a.id AND i.clinic_id=s.clinic_id
    LEFT JOIN LATERAL (SELECT * FROM billing_gateway.plan_changes change WHERE change.account_id=a.id
      AND change.subscription_id=s.id AND change.clinic_id=s.clinic_id AND change.external_subscription_id=${evidence.subscriptionId}
      AND change.product_id=${evidence.productId} AND change.amount_minor=${evidence.amountMinor}
      AND (change.invoice_id IS NOT NULL OR change.from_price_id=s.price_id)
      ORDER BY change.requested_at DESC,change.id DESC LIMIT 1) pc ON true
    WHERE a.provider='abacatepay' AND a.environment='sandbox' AND a.external_account_id=${evidence.account.accountId}
      AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL
      AND (${source.kind === 'webhook'} OR e.proof_hash=${abacatePayRenewalProofHash(evidence)})
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
        currency,charge_created_at,confirmed_at,observed_recurrence,settlement
        ${originalCheckout ? sql`,provider_period_start,provider_period_end` : sql``}
        ${source.kind === 'provider_api' ? sql`,source_readback_id` : sql``})
    VALUES(${context.account_id}::uuid,${evidence.paymentId},${evidence.statementId},${evidence.checkoutId},
      ${evidence.originCheckoutId},${evidence.subscriptionId},${evidence.customerId},
      ${context.subscription_id}::uuid,${context.clinic_id}::uuid,${source.kind === 'webhook' ? source.id : null},
      ${context.price_id}::uuid,${evidence.productId},${evidence.amountMinor},'BRL',
      ${evidence.chargeCreatedAt}::timestamptz,${evidence.confirmedAt}::timestamptz,${evidence.recurrence},'unknown'
      ${originalCheckout ? sql`,${evidence.providerPeriodStart}::date,${evidence.providerPeriodEnd}::date` : sql``}
      ${source.kind === 'provider_api' ? sql`,${source.id}::uuid` : sql``})
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
      AND confirmed_at=${evidence.confirmedAt}::timestamptz
      ${originalCheckout ? sql`AND provider_period_start=${evidence.providerPeriodStart}::date AND provider_period_end=${evidence.providerPeriodEnd}::date` : sql``}`),
    );
  return same.length === 1 ? 'duplicate' : 'review';
}
