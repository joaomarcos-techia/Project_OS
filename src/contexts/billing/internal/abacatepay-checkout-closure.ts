import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '@/lib/env';
import { assertAbacatePaySandboxRuntime } from '@/lib/payments/saas/acquisition';
import {
  createPostgresGatewayOperationJournal,
  type BillingGatewaySql,
} from '@/lib/payments/saas/postgres-store';
import { createAbacatePaySandboxCommands } from '@/lib/payments/abacatepay/sandbox-commands';
import { GatewayReadError } from '@/lib/payments/saas/contracts';
import { CommandOperationError } from '@/lib/payments/saas/command-operation';
import { captureBackgroundError } from '@/lib/observability/capture';
import type { ManagementDatabase } from './abacatepay-management';
import { recordBillingEvent } from './subscriptions';

/** Immutable paid generation, including re-contracts. Never infer it from ACTIVE. */
export async function readConsumedAbacatePayCheckout(
  database: BillingGatewaySql,
  input: { subscriptionId: string; checkoutId: string; storeId: string },
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
      AND a.provider='abacatepay' AND a.environment='sandbox' AND a.external_account_id=${storeId}
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
  const subscriptionId = z.uuid().parse(input.subscriptionId);
  const checkoutId = z
    .string()
    .regex(/^bill_[A-Za-z0-9_-]+$/)
    .max(200)
    .parse(input.checkoutId);
  if (
    !env.ABACATEPAY_API_KEY ||
    !env.ABACATEPAY_STORE_ID ||
    !env.ABACATEPAY_SANDBOX_PROBE_PRODUCT_ID
  )
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
  });
  if (!bound) throw new GatewayReadError('binding_mismatch');
  const account = {
    provider: 'abacatepay',
    environment: 'sandbox',
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
    const closed = await createAbacatePaySandboxCommands(
      {
        apiKey: env.ABACATEPAY_API_KEY,
        storeId: env.ABACATEPAY_STORE_ID,
        probeProductId: env.ABACATEPAY_SANDBOX_PROBE_PRODUCT_ID,
        timeoutMs: 2000,
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
    await database.transaction((tx) =>
      recordBillingEvent(tx, bound.clinic_id, 'subscription.checkout.closed', {
        provider: 'abacatepay',
        checkoutId: closed.checkoutId,
        externalSubscriptionId: closed.subscriptionId,
        operation: 'close_paid_checkout',
        financialHistoryPreserved: true,
      }),
    );
    return closed;
  } catch (error) {
    const reason =
      error instanceof CommandOperationError ? error.code : 'closure_or_persistence_failed';
    captureBackgroundError(new Error(`AbacatePay checkout closure needs review: ${reason}`), {
      flow: 'billing.abacatepay.checkout_closure',
      clinicId: bound.clinic_id,
    });
    throw error;
  }
}
