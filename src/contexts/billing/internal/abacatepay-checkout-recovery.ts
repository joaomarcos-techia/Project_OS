import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';
import { isAbacatePaySandboxRuntime } from '@/lib/payments/saas/acquisition';
import type { BillingGatewaySql } from '@/lib/payments/saas/postgres-store';
import {
  createAbacatePayCheckoutRecoveryReader,
  type RecoveredCheckout,
} from '@/lib/payments/abacatepay/checkout-recovery';

import { recordBillingEvent } from './subscriptions';
import { createAbacatePayReadClient } from '@/lib/payments/abacatepay/reader';

interface RecoveryDatabase extends BillingGatewaySql {
  transaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T>;
}
const contextSchema = z.object({
  account_id: z.uuid(),
  external_account_id: z.string(),
  subscription_id: z.uuid(),
  clinic_id: z.uuid(),
  operation_id: z.uuid(),
  request_hash: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['running', 'unknown', 'confirmed']),
  result: z.unknown(),
  created_at: z.coerce.date(),
  price_id: z.uuid(),
  product_id: z.string(),
  amount_minor: z.coerce.number().int().positive(),
  external_checkout_id: z.string().nullable(),
  billing_status: z.enum(['trial', 'active', 'past_due', 'cancelled']),
  recontract_id: z.uuid().nullable(),
  prior_subscription_id: z.string().nullable(),
  prior_customer_id: z.string().nullable(),
  prior_checkout_id: z.string().nullable(),
});
type Context = z.infer<typeof contextSchema>;

async function contextFor(
  database: BillingGatewaySql,
  subscriptionId: string,
  clinicId: string,
  lock = false,
  recontractId?: string,
): Promise<Context | null> {
  z.uuid().parse(subscriptionId);
  z.uuid().parse(clinicId);
  if (recontractId) {
    z.uuid().parse(recontractId);
    const [row] = z
      .array(contextSchema)
      .max(1)
      .parse(
        await database.execute(sql`
      SELECT a.id::text account_id,a.external_account_id,s.id::text subscription_id,s.clinic_id::text,
        o.operation_id::text,o.request_hash,o.state,o.result,o.created_at,r.price_id::text,r.product_id,r.amount_minor::text,
        r.external_checkout_id,s.billing_status,r.id::text recontract_id,c.external_subscription_id prior_subscription_id,
        c.external_customer_id prior_customer_id,c.external_checkout_id prior_checkout_id
      FROM public.subscriptions s JOIN billing_gateway.bindings b ON b.subscription_id=s.id AND b.clinic_id=s.clinic_id
      JOIN billing_gateway.accounts a ON a.id=b.account_id
      JOIN billing_gateway.recontracts r ON r.account_id=a.id AND r.subscription_id=s.id AND r.clinic_id=s.clinic_id
      JOIN billing_gateway.cancellations c ON c.account_id=a.id AND c.external_subscription_id=r.prior_external_subscription_id
        AND c.subscription_id=s.id AND c.clinic_id=s.clinic_id AND c.paid_period_end=r.prior_period_end
      JOIN billing_gateway.operations o ON o.account_id=a.id AND o.subscription_id=s.id AND o.clinic_id=s.clinic_id
        AND o.kind='recontract_checkout' AND o.business_key='recontract:'||r.id::text
      WHERE s.id=${subscriptionId}::uuid AND s.clinic_id=${clinicId}::uuid AND r.id=${recontractId}::uuid
        AND a.provider='abacatepay' AND a.environment='sandbox' AND a.external_account_id=${env.ABACATEPAY_STORE_ID}
        AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL AND s.price_id=r.price_id
        AND s.cancel_at_period_end AND c.confirmed_at IS NOT NULL AND c.paid_period_end<=now()
        AND s.current_period_end=c.paid_period_end AND r.invoice_id IS NULL
        AND c.external_subscription_id=coalesce((SELECT latest.external_subscription_id FROM billing_gateway.recontracts latest
          WHERE latest.subscription_id=s.id AND latest.invoice_id IS NOT NULL ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1),b.external_subscription_id)
      ${lock ? sql`FOR UPDATE OF s,r,o` : sql``}`),
      );
    return row ?? null;
  }
  const [row] = z
    .array(contextSchema)
    .max(1)
    .parse(
      await database.execute(sql`
    SELECT a.id::text account_id,a.external_account_id,s.id::text subscription_id,s.clinic_id::text,
      o.operation_id::text,o.request_hash,o.state,o.result,o.created_at,i.price_id::text,i.product_id,i.amount_minor::text,
      b.external_checkout_id,s.billing_status,NULL::text recontract_id,NULL::text prior_subscription_id,
      NULL::text prior_customer_id,NULL::text prior_checkout_id
    FROM public.subscriptions s JOIN billing_gateway.bindings b ON b.subscription_id=s.id AND b.clinic_id=s.clinic_id
    JOIN billing_gateway.accounts a ON a.id=b.account_id
    JOIN billing_gateway.checkout_intents i ON i.subscription_id=s.id AND i.clinic_id=s.clinic_id AND i.account_id=a.id
    JOIN billing_gateway.operations o ON o.subscription_id=s.id AND o.clinic_id=s.clinic_id AND o.account_id=a.id
      AND o.kind='create_checkout' AND o.business_key='initial:'||i.price_id::text
    WHERE s.id=${subscriptionId}::uuid AND s.clinic_id=${clinicId}::uuid
      AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL
      AND a.provider='abacatepay' AND a.environment='sandbox' AND a.external_account_id=${env.ABACATEPAY_STORE_ID}
      AND s.price_id=i.price_id AND NOT s.cancel_at_period_end
      AND s.billing_status IN ('trial','active','past_due')
      AND NOT EXISTS(SELECT 1 FROM billing_gateway.recontracts r WHERE r.subscription_id=s.id)
    ${lock ? sql`FOR UPDATE OF s,b,o` : sql``}`),
    );
  return row ?? null;
}

/** GET-only provider discovery. Confirms the original operation; never resends it. */
export async function recoverAbacatePayCheckout(
  database: RecoveryDatabase,
  input: { subscriptionId: string; clinicId: string; recontractId?: string },
): Promise<
  | { state: 'recovered'; result: RecoveredCheckout }
  | { state: 'pending' | 'review' | 'not_eligible' }
> {
  if (!isAbacatePaySandboxRuntime() || !env.ABACATEPAY_API_KEY || !env.ABACATEPAY_STORE_ID)
    return { state: 'not_eligible' };
  const before = await contextFor(
    database,
    input.subscriptionId,
    input.clinicId,
    false,
    input.recontractId,
  );
  if (!before) return { state: 'not_eligible' };
  const discovered = await createAbacatePayCheckoutRecoveryReader(
    { provider: 'abacatepay', environment: 'sandbox', accountId: before.external_account_id },
    { apiKey: env.ABACATEPAY_API_KEY, environment: 'sandbox', timeoutMs: 2000 },
  ).discover({
    externalId: before.recontract_id
      ? `qoro-recontract-${before.recontract_id}`
      : `qoro-initial-${before.subscription_id}`,
    productId: before.product_id,
    expectedAmountMinor: before.amount_minor,
    requestFingerprint: before.request_hash,
    reservedAt: before.created_at.toISOString(),
  });
  if (discovered.state === 'absent') return { state: 'pending' };
  if (before.prior_subscription_id) {
    const prior = await createAbacatePayReadClient({
      apiKey: env.ABACATEPAY_API_KEY,
      environment: 'sandbox',
      timeoutMs: 2000,
    }).readSubscription(before.prior_subscription_id);
    if (
      prior.status !== 'CANCELLED' ||
      prior.customerId !== before.prior_customer_id ||
      prior.checkoutId !== before.prior_checkout_id
    )
      return { state: 'review' };
  }
  return database.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM public.subscriptions
      WHERE id=${input.subscriptionId}::uuid AND clinic_id=${input.clinicId}::uuid FOR UPDATE`);
    const current = await contextFor(
      tx,
      input.subscriptionId,
      input.clinicId,
      true,
      input.recontractId,
    );
    if (
      !current ||
      current.operation_id !== before.operation_id ||
      current.request_hash !== before.request_hash ||
      (current.external_checkout_id !== null &&
        current.external_checkout_id !== discovered.result.checkoutId)
    )
      return { state: 'review' };
    if (current.state === 'confirmed') {
      // Confirmed snapshots are immutable. A different result cannot be replaced.
      const prior = z
        .object({
          checkoutId: z.string(),
          externalId: z.string(),
          amountMinor: z.number(),
          environment: z.literal('sandbox'),
          state: z.literal('pending'),
          checkoutUrl: z.string(),
        })
        .safeParse(current.result);
      if (!prior.success || JSON.stringify(prior.data) !== JSON.stringify(discovered.result))
        return { state: 'review' };
    } else {
      await tx.execute(sql`UPDATE billing_gateway.operations SET state='confirmed',result=${JSON.stringify(discovered.result)}::jsonb
        WHERE account_id=${current.account_id}::uuid AND operation_id=${current.operation_id}::uuid
          AND request_hash=${current.request_hash} AND state IN ('running','unknown')`);
      await recordBillingEvent(tx, current.clinic_id, 'subscription.checkout.result_recovered', {
        provider: 'abacatepay',
        operationId: current.operation_id,
        providerStatus: discovered.currentStatus,
      });
    }
    if (current.recontract_id) {
      await tx.execute(sql`UPDATE billing_gateway.recontracts SET external_checkout_id=${discovered.result.checkoutId}
        WHERE id=${current.recontract_id}::uuid AND account_id=${current.account_id}::uuid
          AND subscription_id=${current.subscription_id}::uuid AND clinic_id=${current.clinic_id}::uuid
          AND invoice_id IS NULL AND external_checkout_id IS NULL`);
    } else
      await tx.execute(sql`UPDATE billing_gateway.bindings SET external_checkout_id=${discovered.result.checkoutId}
      WHERE subscription_id=${current.subscription_id}::uuid AND clinic_id=${current.clinic_id}::uuid
        AND account_id=${current.account_id}::uuid AND external_checkout_id IS NULL`);
    return { state: 'recovered', result: discovered.result };
  });
}

/** One bounded candidate, same hourly backoff as initial-payment reconciliation. */
export async function reconcileAbacatePayUnknownCheckout(
  database: RecoveryDatabase,
): Promise<void> {
  if (!isAbacatePaySandboxRuntime() || !env.ABACATEPAY_API_KEY || !env.ABACATEPAY_STORE_ID) return;
  const [candidate] = z
    .array(
      z.object({
        subscription_id: z.uuid(),
        clinic_id: z.uuid(),
        operation_id: z.uuid(),
        recontract_id: z.uuid().nullable(),
      }),
    )
    .max(1)
    .parse(
      await database.execute(sql`
    SELECT o.subscription_id::text,o.clinic_id::text,o.operation_id::text,r.id::text recontract_id FROM billing_gateway.operations o
    JOIN billing_gateway.accounts a ON a.id=o.account_id
    JOIN public.subscriptions s ON s.id=o.subscription_id AND s.clinic_id=o.clinic_id
    LEFT JOIN billing_gateway.recontracts r ON r.account_id=a.id AND r.subscription_id=s.id AND r.clinic_id=s.clinic_id
      AND o.kind='recontract_checkout' AND o.business_key='recontract:'||r.id::text AND r.invoice_id IS NULL
    LEFT JOIN LATERAL(SELECT max(e.created_at) checked_at FROM public.billing_events e
      WHERE e.clinic_id=o.clinic_id AND e.type='subscription.checkout.recovery_checked'
        AND e.payload->>'operationId'=o.operation_id::text) checked ON true
    WHERE a.provider='abacatepay' AND a.environment='sandbox' AND a.external_account_id=${env.ABACATEPAY_STORE_ID}
      AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL
      AND (o.kind='create_checkout' OR (o.kind='recontract_checkout' AND r.id IS NOT NULL)) AND o.state IN ('running','unknown')
      AND (checked.checked_at IS NULL OR checked.checked_at<now()-interval '1 hour')
    ORDER BY checked.checked_at NULLS FIRST,o.created_at LIMIT 1`),
    );
  if (!candidate) return;
  let outcome: string;
  try {
    outcome = (
      await recoverAbacatePayCheckout(database, {
        subscriptionId: candidate.subscription_id,
        clinicId: candidate.clinic_id,
        ...(candidate.recontract_id ? { recontractId: candidate.recontract_id } : {}),
      })
    ).state;
  } catch {
    outcome = 'readback_or_transaction_failed';
  }
  await database.transaction((tx) =>
    recordBillingEvent(tx, candidate.clinic_id, 'subscription.checkout.recovery_checked', {
      provider: 'abacatepay',
      subscriptionId: candidate.subscription_id,
      operationId: candidate.operation_id,
      outcome,
    }),
  );
  metrics.emit('billing.abacatepay.checkout_reconciled', { outcome });
}
