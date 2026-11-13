import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '@/lib/env';
import {
  assertAbacatePaySandboxRuntime,
  abacatePayEnvironment,
  abacatePayProbeProductId,
  isAbacatePayRuntime,
} from '@/lib/payments/saas/acquisition';
import {
  createPostgresGatewayOperationJournal,
  type BillingGatewaySql,
} from '@/lib/payments/saas/postgres-store';
import { createAbacatePayCommands } from '@/lib/payments/abacatepay/sandbox-commands';
import { GatewayReadError } from '@/lib/payments/saas/contracts';
import { CommandOperationError } from '@/lib/payments/saas/command-operation';
import { captureBackgroundError } from '@/lib/observability/capture';
import type { ManagementDatabase } from './abacatepay-management';
import { recordBillingEvent } from './subscriptions';

/** Immutable paid generation, including re-contracts. Never infer it from ACTIVE. */
export async function readConsumedAbacatePayCheckout(
  database: BillingGatewaySql,
  input: {
    subscriptionId: string;
    checkoutId: string;
    storeId: string;
    environment?: 'sandbox' | 'production';
  },
) {
  const subscriptionId = z.uuid().parse(input.subscriptionId);
  const checkoutId = z
    .string()
    .regex(/^bill_[A-Za-z0-9_-]+$/)
    .max(200)
    .parse(input.checkoutId);
  const storeId = z
    .string()
    .regex(/^store_[A-Za-z0-9_-]+$/)
    .max(200)
    .parse(input.storeId);
  const [bound] = z
    .array(
      z.object({
        clinic_id: z.uuid(),
        external_subscription_id: z.string(),
        external_customer_id: z.string(),
        product_id: z.string(),
        amount_minor: z.coerce.number().int().positive(),
      }),
    )
    .max(1)
    .parse(
      await database.execute(sql`
    WITH paid AS (
      SELECT b.account_id,b.subscription_id,b.clinic_id,b.external_checkout_id,b.external_subscription_id,
        b.external_customer_id,i.product_id,i.amount_minor,p.invoice_id
      FROM billing_gateway.bindings b JOIN billing_gateway.checkout_intents i USING(account_id,subscription_id,clinic_id)
      JOIN billing_gateway.paid_checkouts p ON p.account_id=b.account_id AND p.checkout_id=b.external_checkout_id
        AND p.subscription_id=b.subscription_id AND p.clinic_id=b.clinic_id
      UNION ALL
      SELECT account_id,subscription_id,clinic_id,external_checkout_id,external_subscription_id,
        external_customer_id,product_id,amount_minor,invoice_id FROM billing_gateway.recontracts WHERE invoice_id IS NOT NULL
    ) SELECT p.clinic_id::text,p.external_subscription_id,p.external_customer_id,p.product_id,p.amount_minor::text
    FROM paid p JOIN billing_gateway.accounts a ON a.id=p.account_id
    JOIN public.invoices invoice ON invoice.id=p.invoice_id AND invoice.subscription_id=p.subscription_id
      AND invoice.clinic_id=p.clinic_id AND invoice.status='paid' AND invoice.total_amount=p.amount_minor/100.0
    JOIN public.subscriptions s ON s.id=p.subscription_id AND s.clinic_id=p.clinic_id
    WHERE p.subscription_id=${subscriptionId}::uuid AND p.external_checkout_id=${checkoutId}
      AND a.provider='abacatepay' AND a.environment=${input.environment ?? 'sandbox'} AND a.external_account_id=${storeId}
      AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL
      AND p.external_subscription_id IS NOT NULL AND p.external_customer_id IS NOT NULL`),
    );
  return bound ?? null;
}

/** Explicit operator seam, not a cron task. Paid Sandbox fixture deletion needs approval. */
export async function closeConsumedAbacatePayCheckout(
  database: ManagementDatabase,
  input: { subscriptionId: string; checkoutId: string },
) {
  assertAbacatePaySandboxRuntime();
  return closePaidCheckoutInEnvironment(database, input, 'sandbox');
}

async function closePaidCheckoutInEnvironment(
  database: ManagementDatabase,
  input: { subscriptionId: string; checkoutId: string },
  environment: 'sandbox' | 'production',
  deadlineMs?: number,
) {
  if (abacatePayEnvironment() !== environment) throw new GatewayReadError('environment_mismatch');
  const subscriptionId = z.uuid().parse(input.subscriptionId);
  const checkoutId = z
    .string()
    .regex(/^bill_[A-Za-z0-9_-]+$/)
    .max(200)
    .parse(input.checkoutId);
  if (!env.ABACATEPAY_API_KEY || !env.ABACATEPAY_STORE_ID || !abacatePayProbeProductId())
    throw new GatewayReadError('invalid_input');
  const [ready] = z
    .array(z.object({ ready: z.boolean() }))
    .max(1)
    .parse(
      await database.execute(sql`
    SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='billing_gateway.operations'::regclass
      AND conname='operations_kind_check' AND position('close_paid_checkout' IN pg_get_constraintdef(oid))>0) ready`),
    );
  if (!ready?.ready) throw new GatewayReadError('unavailable');
  const bound = await readConsumedAbacatePayCheckout(database, {
    subscriptionId,
    checkoutId,
    storeId: env.ABACATEPAY_STORE_ID,
    environment,
  });
  if (!bound) throw new GatewayReadError('binding_mismatch');
  const account = {
    provider: 'abacatepay',
    environment,
    accountId: env.ABACATEPAY_STORE_ID,
  } as const;
  const journal = createPostgresGatewayOperationJournal(
    account,
    {
      subscriptionId,
      clinicId: bound.clinic_id,
      kind: 'close_paid_checkout',
      businessKey: checkoutId,
    },
    database,
  );
  try {
    const closed = await createAbacatePayCommands(
      {
        apiKey: env.ABACATEPAY_API_KEY,
        storeId: env.ABACATEPAY_STORE_ID,
        environment,
        probeProductId: abacatePayProbeProductId(),
        timeoutMs: 2000,
        ...(deadlineMs === undefined ? {} : { deadlineMs }),
      },
      journal,
    ).closePaidCheckout({
      operationId: randomUUID(),
      checkoutId,
      subscriptionId: bound.external_subscription_id,
      customerId: bound.external_customer_id,
      productId: bound.product_id,
      expectedAmountMinor: bound.amount_minor,
    });
    await database.transaction(async (tx) => {
      // A short audit lock only AFTER provider IO; no transaction spans HTTP.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`checkout-closed:${environment}:${checkoutId}`},0))`,
      );
      const [existing] = z.array(z.object({ present: z.boolean() })).parse(
        await tx.execute(sql`
        SELECT EXISTS(SELECT 1 FROM public.billing_events WHERE clinic_id=${bound.clinic_id}::uuid
          AND type='subscription.checkout.closed' AND payload->>'checkoutId'=${checkoutId}) present`),
      );
      if (existing?.present) return;
      await recordBillingEvent(tx, bound.clinic_id, 'subscription.checkout.closed', {
        provider: 'abacatepay',
        checkoutId: closed.checkoutId,
        externalSubscriptionId: closed.subscriptionId,
        operation: 'close_paid_checkout',
        financialHistoryPreserved: true,
      });
    });
    return closed;
  } catch (error) {
    if (error instanceof CommandOperationError && error.code === 'operation_in_progress')
      throw error;
    const reason =
      error instanceof CommandOperationError ? error.code : 'closure_or_persistence_failed';
    captureBackgroundError(new Error(`AbacatePay checkout closure needs review: ${reason}`), {
      flow: 'billing.abacatepay.checkout_closure',
      clinicId: bound.clinic_id,
    });
    throw error;
  }
}

/** One paid live generation per tick. Sandbox fixtures remain operator-owned.
 * Unknown/running commands are never replayed; the private journal needs review.
 * Acquisition flags do not stop obligations that were already paid.
 */
export async function reconcileAbacatePayLiveCheckoutClosures(
  database: ManagementDatabase,
  deadlineMs: number,
) {
  const result = { scanned: 0, closed: 0 };
  if (!isAbacatePayRuntime() || abacatePayEnvironment() !== 'production') return result;
  if (!Number.isSafeInteger(deadlineMs)) throw new GatewayReadError('invalid_input');
  if (Date.now() + 2000 >= deadlineMs) return result;
  const [candidate] = z
    .array(z.object({ subscription_id: z.uuid(), checkout_id: z.string() }))
    .max(1)
    .parse(
      await database.execute(sql`
      WITH paid AS (
        SELECT p.account_id,p.subscription_id,p.clinic_id,p.checkout_id,p.invoice_id
        FROM billing_gateway.paid_checkouts p
        UNION ALL
        SELECT account_id,subscription_id,clinic_id,external_checkout_id,invoice_id
        FROM billing_gateway.recontracts WHERE invoice_id IS NOT NULL
      ) SELECT p.subscription_id::text,p.checkout_id
      FROM paid p JOIN billing_gateway.accounts a ON a.id=p.account_id
      JOIN public.invoices i ON i.id=p.invoice_id AND i.clinic_id=p.clinic_id
        AND i.subscription_id=p.subscription_id AND i.status='paid'
      WHERE a.provider='abacatepay' AND a.environment='production'
        AND a.external_account_id=${env.ABACATEPAY_STORE_ID}
        AND NOT EXISTS(SELECT 1 FROM public.billing_events e WHERE e.clinic_id=p.clinic_id
          AND e.type='subscription.checkout.closed' AND e.payload->>'checkoutId'=p.checkout_id)
        AND NOT EXISTS(SELECT 1 FROM billing_gateway.operations o WHERE o.account_id=p.account_id
          AND o.subscription_id=p.subscription_id AND o.clinic_id=p.clinic_id
          AND o.kind='close_paid_checkout' AND o.business_key=p.checkout_id AND o.state IN ('running','unknown'))
      ORDER BY i.created_at,p.subscription_id,p.checkout_id LIMIT 1`),
    );
  if (!candidate) return result;
  result.scanned = 1;
  try {
    await closePaidCheckoutInEnvironment(
      database,
      {
        subscriptionId: candidate.subscription_id,
        checkoutId: candidate.checkout_id,
      },
      'production',
      deadlineMs,
    );
  } catch (error) {
    if (error instanceof CommandOperationError && error.code === 'operation_in_progress')
      return result;
    throw error;
  }
  result.closed = 1;
  return result;
}
