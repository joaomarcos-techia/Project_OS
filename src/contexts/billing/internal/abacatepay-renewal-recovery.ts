import { abacatePayEnvironment } from '@/lib/payments/saas/acquisition';
import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { captureBackgroundError } from '@/lib/observability/capture';
import { metrics } from '@/lib/observability/metrics';
import { isAbacatePayRuntime } from '@/lib/payments/saas/acquisition';
import { GatewayReadError } from '@/lib/payments/saas/contracts';
import type { BillingGatewaySql } from '@/lib/payments/saas/postgres-store';
import type { RecurringPaymentEvidence } from '@/lib/payments/saas/recurring-payment';
import { createAbacatePayReadClient } from '@/lib/payments/abacatepay/reader';
import { createAbacatePayRenewalPaymentReader } from '@/lib/payments/abacatepay/renewal-payment';
import type { ManagementDatabase } from './abacatepay-management';
import { abacatePayRenewalPeriod } from './abacatepay-renewal-period';
import { applyAbacatePayRenewalTx } from './abacatepay-renewals';
import { abacatePayRenewalProofHash } from './abacatepay-renewal-source';
import { recordBillingEvent } from './subscriptions';
import {
  createPersistentAbacatePayStatementReader,
  AbacatePayStatementScanPending,
} from './abacatepay-statement-scan';

const READ_BUDGET_MS = 12_000;
const READ_TIMEOUT_MS = 1500;
const candidateSchema = z.object({
  account_id: z.uuid(),
  subscription_id: z.uuid(),
  clinic_id: z.uuid(),
  external_subscription_id: z.string(),
  external_customer_id: z.string(),
  checkout_id: z.string(),
  price_id: z.uuid(),
  product_id: z.string(),
  amount_minor: z.coerce.number().int().positive(),
  anchor_start: z.coerce.date(),
  pending_price_id: z.uuid().nullable(),
  pending_product_id: z.string().nullable(),
  pending_amount: z.coerce.number().int().positive().nullable(),
});
type Candidate = z.infer<typeof candidateSchema>;

export async function abacatePayRenewalRecoveryReady(database: BillingGatewaySql) {
  const [row] = z
    .array(z.object({ ready: z.boolean() }))
    .max(1)
    .parse(
      await database.execute(sql`
    SELECT to_regclass('billing_gateway.renewal_api_readbacks') IS NOT NULL
      AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='billing_gateway'
        AND table_name='recurring_payment_observations' AND column_name='source_readback_id') ready`),
    );
  return row?.ready === true;
}

async function candidate(
  database: BillingGatewaySql,
  subscriptionId: string | null,
  lock: boolean,
) {
  const [row] = z
    .array(candidateSchema)
    .max(1)
    .parse(
      await database.execute(sql`
    SELECT a.id::text account_id,s.id::text subscription_id,s.clinic_id::text,
      coalesce(r.external_subscription_id,b.external_subscription_id) external_subscription_id,
      coalesce(r.external_customer_id,b.external_customer_id) external_customer_id,
      coalesce(r.external_checkout_id,b.external_checkout_id) checkout_id,
      coalesce(applied.to_price_id,r.price_id,i.price_id)::text price_id,
      coalesce(applied.product_id,r.product_id,i.product_id) product_id,
      coalesce(applied.amount_minor,r.amount_minor,i.amount_minor)::text amount_minor,
      coalesce(r.period_start,p.period_start) anchor_start,
      pending.to_price_id::text pending_price_id,pending.product_id pending_product_id,
      pending.amount_minor::text pending_amount
    FROM public.subscriptions s JOIN billing_gateway.bindings b ON b.subscription_id=s.id AND b.clinic_id=s.clinic_id
    JOIN billing_gateway.accounts a ON a.id=b.account_id
    JOIN public.prices pr ON pr.id=s.price_id
    JOIN billing_gateway.paid_checkouts p ON p.account_id=a.id AND p.checkout_id=b.external_checkout_id
      AND p.subscription_id=s.id AND p.clinic_id=s.clinic_id
    JOIN billing_gateway.checkout_intents i ON i.account_id=a.id AND i.subscription_id=s.id AND i.clinic_id=s.clinic_id
    LEFT JOIN LATERAL (SELECT * FROM billing_gateway.recontracts WHERE account_id=a.id AND subscription_id=s.id
      AND clinic_id=s.clinic_id AND invoice_id IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1) r ON true
    LEFT JOIN LATERAL (SELECT * FROM billing_gateway.plan_changes pc WHERE pc.account_id=a.id AND pc.subscription_id=s.id
      AND pc.clinic_id=s.clinic_id AND pc.external_subscription_id=coalesce(r.external_subscription_id,b.external_subscription_id)
      AND pc.invoice_id IS NOT NULL ORDER BY pc.requested_at DESC,pc.id DESC LIMIT 1) applied ON true
    LEFT JOIN billing_gateway.plan_changes pending ON pending.account_id=a.id AND pending.subscription_id=s.id
      AND pending.clinic_id=s.clinic_id AND pending.external_subscription_id=coalesce(r.external_subscription_id,b.external_subscription_id)
      AND pending.invoice_id IS NULL AND pending.from_price_id=s.price_id
    LEFT JOIN LATERAL (SELECT e.created_at checked_at,CASE WHEN e.payload->>'retryAfterSeconds' ~ '^[0-9]{1,5}$'
      THEN (e.payload->>'retryAfterSeconds')::int ELSE 3600 END retry_after
      FROM public.billing_events e WHERE e.clinic_id=s.clinic_id
      AND e.type='subscription.renewal_recovery.checked'
      AND e.payload->>'externalSubscriptionId'=coalesce(r.external_subscription_id,b.external_subscription_id)
      ORDER BY e.created_at DESC,e.id DESC LIMIT 1) checked ON true
    WHERE a.provider='abacatepay' AND a.environment=${abacatePayEnvironment()} AND a.external_account_id=${env.ABACATEPAY_STORE_ID}
      AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL AND pr.billing_cycle='monthly'
      AND coalesce(r.external_subscription_id,b.external_subscription_id) IS NOT NULL
      AND (s.billing_status IN ('active','past_due') OR (${subscriptionId}::uuid IS NOT NULL AND s.billing_status='cancelled'))
      AND (${subscriptionId}::uuid IS NOT NULL OR s.current_period_end <= now()+interval '1 day')
      AND (${subscriptionId}::uuid IS NULL OR s.id=${subscriptionId}::uuid)
      AND (${subscriptionId}::uuid IS NOT NULL OR checked.checked_at IS NULL
        OR checked.checked_at<now()-make_interval(secs=>checked.retry_after))
    ORDER BY checked.checked_at NULLS FIRST,s.id LIMIT 1 ${lock ? sql`FOR UPDATE OF s SKIP LOCKED` : sql``}`),
    );
  return row ?? null;
}

async function persistReadback(
  tx: Tx,
  before: Candidate,
  evidence: RecurringPaymentEvidence,
  priceId: string,
) {
  if (
    evidence.subscriptionId !== before.external_subscription_id ||
    evidence.customerId !== before.external_customer_id ||
    evidence.originCheckoutId !== before.checkout_id ||
    evidence.checkoutId !== before.checkout_id ||
    !evidence.providerPeriodStart ||
    !evidence.providerPeriodEnd
  )
    return null;
  const proofHash = abacatePayRenewalProofHash(evidence);
  const id = randomUUID();
  await tx.execute(sql`INSERT INTO billing_gateway.renewal_api_readbacks
    (id,account_id,subscription_id,clinic_id,external_subscription_id,external_customer_id,checkout_id,payment_id,statement_id,
      price_id,product_id,amount_minor,currency,charge_created_at,confirmed_at,observed_recurrence,
      provider_period_start,provider_period_end,proof_hash)
    VALUES(${id}::uuid,${before.account_id}::uuid,${before.subscription_id}::uuid,${before.clinic_id}::uuid,
      ${evidence.subscriptionId},${evidence.customerId},${evidence.checkoutId},${evidence.paymentId},${evidence.statementId},
      ${priceId}::uuid,${evidence.productId},${evidence.amountMinor},'BRL',${evidence.chargeCreatedAt}::timestamptz,
      ${evidence.confirmedAt}::timestamptz,${evidence.recurrence},${evidence.providerPeriodStart}::date,
      ${evidence.providerPeriodEnd}::date,${proofHash}) ON CONFLICT DO NOTHING`);
  const [row] = z
    .array(z.object({ id: z.uuid() }))
    .max(1)
    .parse(
      await tx.execute(sql`
    SELECT id::text FROM billing_gateway.renewal_api_readbacks WHERE account_id=${before.account_id}::uuid
      AND subscription_id=${before.subscription_id}::uuid AND clinic_id=${before.clinic_id}::uuid
      AND payment_id=${evidence.paymentId} AND statement_id=${evidence.statementId} AND proof_hash=${proofHash}`),
    );
  return row?.id ?? null;
}

type RenewalRecoveryInput = { subscriptionId?: string; deadlineMs?: number };

async function runMissingRenewalRecovery(
  database: ManagementDatabase,
  input: RenewalRecoveryInput,
) {
  const result = {
    scanned: 0,
    applied: 0,
    historical: 0,
    review: 0,
    pending: 0,
    failed: 0,
    deferred: false,
  };
  if (
    !isAbacatePayRuntime() ||
    !env.ABACATEPAY_API_KEY ||
    !env.ABACATEPAY_STORE_ID ||
    !(await abacatePayRenewalRecoveryReady(database))
  )
    return result;
  const subscriptionId =
    input.subscriptionId === undefined ? null : z.uuid().parse(input.subscriptionId);
  const deadline = Math.min(
    input.deadlineMs === undefined
      ? Date.now() + READ_BUDGET_MS
      : z.number().int().positive().parse(input.deadlineMs),
    Date.now() + READ_BUDGET_MS,
  );
  if (deadline - Date.now() < READ_BUDGET_MS - 100) {
    result.deferred = true;
    metrics.emit('billing.abacatepay.renewal_recovery', result);
    return result;
  }
  const checkId = randomUUID();
  const before = await database.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout='2s'`);
    const row = await candidate(tx, subscriptionId, true);
    if (!row) return null;
    await recordBillingEvent(tx, row.clinic_id, 'subscription.renewal_recovery.checked', {
      provider: 'abacatepay',
      checkId,
      externalSubscriptionId: row.external_subscription_id,
    });
    return row;
  });
  if (!before) return result;
  result.scanned = 1;
  const account = {
    provider: 'abacatepay',
    environment: abacatePayEnvironment(),
    accountId: env.ABACATEPAY_STORE_ID,
  } as const;
  const config = {
    apiKey: env.ABACATEPAY_API_KEY,
    environment: abacatePayEnvironment(),
    timeoutMs: READ_TIMEOUT_MS,
    readAttempts: 2,
    deadlineMs: deadline,
  } as const;
  try {
    const remote = await createAbacatePayReadClient(config).readSubscription(
      before.external_subscription_id,
    );
    // The initial receipt is already handled separately; it is never a renewal.
    if (
      remote.currentPeriodStart &&
      remote.currentPeriodStart <= before.anchor_start.toISOString().slice(0, 10)
    ) {
      result.pending++;
      metrics.emit('billing.abacatepay.renewal_recovery', result);
      return result;
    }
    const target = before.pending_amount !== null && remote.amount === before.pending_amount;
    const productId = target ? before.pending_product_id : before.product_id,
      priceId = target ? before.pending_price_id : before.price_id,
      amount = target ? before.pending_amount : before.amount_minor;
    if (!productId || !priceId || !amount) throw new GatewayReadError('binding_mismatch');
    const readback = await createAbacatePayRenewalPaymentReader(
      account,
      config,
      fetch,
      {
        subscriptionId: before.external_subscription_id,
        customerId: before.external_customer_id,
        checkoutId: before.checkout_id,
      },
      createPersistentAbacatePayStatementReader(database, account),
    ).discoverRenewalPayment({
      subscriptionId: before.external_subscription_id,
      customerId: before.external_customer_id,
      originCheckoutId: before.checkout_id,
      productId,
      expectedAmountMinor: amount,
    });
    if (readback.state !== 'paid') {
      result[readback.state === 'pending' ? 'pending' : 'review']++;
    } else if (
      !abacatePayRenewalPeriod({
        anchorStart: before.anchor_start,
        chargeCreatedAt: readback.evidence.chargeCreatedAt,
        confirmedAt: readback.evidence.confirmedAt,
        now: new Date(),
        ...(readback.evidence.providerPeriodStart === undefined
          ? {}
          : { providerPeriodStart: readback.evidence.providerPeriodStart }),
        ...(readback.evidence.providerPeriodEnd === undefined
          ? {}
          : { providerPeriodEnd: readback.evidence.providerPeriodEnd }),
      })
    ) {
      result.review++;
    } else {
      const outcome = await database.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout='2s'`);
        await tx.execute(sql`SET LOCAL statement_timeout='10s'`);
        await tx.execute(
          sql`SELECT id FROM public.subscriptions WHERE id=${before.subscription_id}::uuid FOR UPDATE`,
        );
        const id = await persistReadback(tx, before, readback.evidence, priceId);
        if (!id) return 'review';
        return applyAbacatePayRenewalTx(tx, readback.evidence, { kind: 'provider_api', id });
      });
      if (outcome === 'applied') result.applied++;
      else if (outcome === 'historical') result.historical++;
      else if (outcome === 'review') result.review++;
    }
    await database.transaction((tx) =>
      recordBillingEvent(tx, before.clinic_id, 'subscription.renewal_recovery.observed', {
        provider: 'abacatepay',
        checkId,
        externalSubscriptionId: before.external_subscription_id,
        ...result,
      }),
    );
    if (result.review)
      captureBackgroundError(new Error('AbacatePay renewal readback needs review'), {
        flow: 'billing.abacatepay.renewal_recovery',
        clinicId: before.clinic_id,
      });
  } catch (error) {
    if (error instanceof AbacatePayStatementScanPending) {
      result.deferred = true;
      await database.transaction((tx) =>
        recordBillingEvent(tx, before.clinic_id, 'subscription.renewal_recovery.checked', {
          provider: 'abacatepay',
          checkId,
          externalSubscriptionId: before.external_subscription_id,
          outcome: 'statement_scan_pending',
          retryAfterSeconds: 5,
        }),
      );
      metrics.emit('billing.abacatepay.renewal_recovery', result);
      return result;
    }
    const inconsistent =
      error instanceof GatewayReadError &&
      [
        'binding_mismatch',
        'environment_mismatch',
        'invalid_response',
        'pagination_invalid',
      ].includes(error.code);
    if (inconsistent) result.review++;
    else result.failed++;
    const reason =
      error instanceof GatewayReadError ? error.code : 'readback_or_transaction_failed';
    await database.transaction((tx) =>
      recordBillingEvent(
        tx,
        before.clinic_id,
        inconsistent
          ? 'subscription.renewal_recovery.review'
          : 'subscription.renewal_recovery.failed',
        {
          provider: 'abacatepay',
          checkId,
          reason,
        },
      ),
    );
    captureBackgroundError(new Error(`AbacatePay renewal recovery failed: ${reason}`), {
      flow: 'billing.abacatepay.renewal_recovery',
      clinicId: before.clinic_id,
    });
  }
  metrics.emit('billing.abacatepay.renewal_recovery', result);
  return result;
}

/** Internal bounded GET-only worker. A directed invocation still cannot override proof. */
export async function reconcileAbacatePayMissingRenewal(
  database: ManagementDatabase,
  input: RenewalRecoveryInput = {},
) {
  try {
    return await runMissingRenewalRecovery(database, input);
  } catch (error) {
    // Schema/candidate reads and even the failure-audit transaction can fail.
    // Emit without another DB attempt; retain the rejection for the cron caller.
    captureBackgroundError(new Error('AbacatePay renewal recovery stopped before completion'), {
      flow: 'billing.abacatepay.renewal_recovery',
    });
    metrics.emit('billing.abacatepay.renewal_recovery', {
      failed: 1,
      stage: 'unhandled_persistence_or_readback',
    });
    throw error;
  }
}
