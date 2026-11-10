import 'server-only';

import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { dbAdmin, type Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';
import { isAbacatePaySandboxRuntime } from '@/lib/payments/saas/acquisition';
import { billingResourceKey } from '@/lib/payments/saas/contracts';
import { createAbacatePayReadClient } from '@/lib/payments/abacatepay/reader';
import {
  createAbacatePayInitialPaymentReader,
  type InitialPaymentEvidence,
} from '@/lib/payments/abacatepay/initial-payment';

import { invoices, subscriptions } from '../schema';
import { initialAbacatePayAccessPeriod } from './abacatepay-period';
import { markInvoicePaid, recordBillingEvent } from './subscriptions';
import { toCents, toReaisString } from './money';
import { DUNNING_READONLY_DAYS } from './dunning';
import { applyAbacatePayRenewalTx, readAbacatePayRenewalForEvent } from './abacatepay-renewals';
import {
  abacatePayManagementReady,
  applyAbacatePayRecontractPaymentTx,
  reconcileAbacatePayCancellation,
} from './abacatepay-management';
import {
  readAbacatePayNegativeEvent,
  recordAbacatePayNegativeEventTx,
} from './abacatepay-negative-events';

const bindingSchema = z.object({
  account_id: z.uuid(),
  subscription_id: z.uuid(),
  clinic_id: z.uuid(),
  price_id: z.uuid(),
  amount: z.string(),
  amount_minor: z.coerce.number().int().positive(),
  product_id: z.string(),
  external_customer_id: z.string().nullable(),
  external_subscription_id: z.string().nullable(),
  billing_status: z.enum(['trial', 'active', 'past_due', 'cancelled']),
  trial_ends_at: z.coerce.date(),
});
export type InitialPaymentApplication = 'applied' | 'duplicate' | 'review';

/**
 * Privileged domain seam, never exposed as a request payload. Evidence must come
 * from the authoritative account reader. Dedup + invoice + access are atomic.
 */
export async function applyInitialAbacatePayPaymentTx(
  tx: Tx,
  evidence: InitialPaymentEvidence,
): Promise<InitialPaymentApplication> {
  if (
    evidence.account.provider !== 'abacatepay' ||
    evidence.account.environment !== 'sandbox' ||
    evidence.currency !== 'BRL' ||
    evidence.state !== 'paid' ||
    evidence.recurrence !== 'running' ||
    evidence.amountMinor <= 0 ||
    evidence.amountMinor !== evidence.paidAmountMinor
  )
    return 'review';
  const [binding] = z
    .array(bindingSchema)
    .max(1)
    .parse(
      await tx.execute(sql`
    SELECT a.id::text account_id,b.subscription_id::text,b.clinic_id::text,s.price_id::text,
      pr.amount::text,i.amount_minor::text,i.product_id,b.external_customer_id,
      b.external_subscription_id,s.billing_status,s.trial_ends_at
    FROM billing_gateway.bindings b JOIN billing_gateway.accounts a ON a.id=b.account_id
    JOIN public.subscriptions s ON s.id=b.subscription_id AND s.clinic_id=b.clinic_id
    JOIN public.prices pr ON pr.id=s.price_id
    JOIN billing_gateway.checkout_intents i ON i.subscription_id=s.id AND i.clinic_id=s.clinic_id
      AND i.account_id=a.id AND i.price_id=s.price_id
    WHERE a.provider='abacatepay' AND a.environment='sandbox'
      AND a.external_account_id=${evidence.account.accountId}
      AND b.external_checkout_id=${evidence.checkoutId} AND s.billing_provider='abacatepay'
      AND pr.billing_cycle='monthly' AND pr.currency='BRL'
    FOR UPDATE OF s,b`),
    );
  if (
    !binding ||
    binding.amount_minor !== evidence.amountMinor ||
    toCents(binding.amount) !== evidence.amountMinor ||
    (binding.external_customer_id !== null &&
      binding.external_customer_id !== evidence.customerId) ||
    (binding.external_subscription_id !== null &&
      binding.external_subscription_id !== evidence.subscriptionId)
  )
    return 'review';
  const existing = z.array(z.object({ invoice_id: z.uuid() })).parse(
    await tx.execute(sql`
    SELECT invoice_id::text FROM billing_gateway.paid_checkouts
    WHERE account_id=${binding.account_id}::uuid AND checkout_id=${evidence.checkoutId}`),
  );
  if (existing.length) return 'duplicate';
  if (binding.billing_status !== 'trial') return 'review';
  const period = initialAbacatePayAccessPeriod({
    subscriptionCreatedAt: evidence.subscriptionCreatedAt,
    trialEndsAt: binding.trial_ends_at,
    now: new Date(),
  });
  if (!period) return 'review';
  const attached = z
    .array(z.object({ subscription_id: z.uuid() }))
    .length(1)
    .parse(
      await tx.execute(sql`
    UPDATE billing_gateway.bindings SET external_customer_id=${evidence.customerId},external_subscription_id=${evidence.subscriptionId}
    WHERE subscription_id=${binding.subscription_id}::uuid AND clinic_id=${binding.clinic_id}::uuid
      AND account_id=${binding.account_id}::uuid RETURNING subscription_id::text`),
    );
  if (!attached[0]) return 'review';
  const [invoice] = await tx
    .insert(invoices)
    .values({
      clinicId: binding.clinic_id,
      subscriptionId: binding.subscription_id,
      totalAmount: toReaisString(evidence.amountMinor),
      status: 'open',
      dueDate: period.start.toISOString().slice(0, 10),
      periodStart: period.start.toISOString().slice(0, 10),
      periodEnd: period.end.toISOString().slice(0, 10),
      paymentMethod: 'CARD',
    })
    .returning();
  if (!invoice) throw new Error('Initial SaaS invoice persistence failed');
  await tx.execute(sql`INSERT INTO billing_gateway.paid_checkouts
    (account_id,checkout_id,subscription_id,clinic_id,invoice_id,period_start,period_end)
    VALUES(${binding.account_id}::uuid,${evidence.checkoutId},${binding.subscription_id}::uuid,
      ${binding.clinic_id}::uuid,${invoice.id}::uuid,
      ${period.start.toISOString()}::timestamptz,${period.end.toISOString()}::timestamptz)`);
  await tx
    .update(subscriptions)
    .set({
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      gracePeriodUntil: new Date(period.end.getTime() + DUNNING_READONLY_DAYS * 86_400_000),
    })
    .where(eq(subscriptions.id, binding.subscription_id));
  await markInvoicePaid(tx, binding.clinic_id, invoice, {
    provider: 'abacatepay',
    paymentMethod: 'CARD',
    providerPaymentId: billingResourceKey(evidence.account, 'checkout', evidence.checkoutId),
    idemSuffix: `abacatepay:${binding.account_id}:${evidence.checkoutId}`,
    deferPeriodAdvance: true,
  });
  await recordBillingEvent(tx, binding.clinic_id, 'subscription.initial_payment_verified', {
    provider: 'abacatepay',
    invoiceId: invoice.id,
    periodSource: 'qoro_verified_subscription_creation',
  });
  return 'applied';
}

const queuedSchema = z.object({
  account_id: z.uuid(),
  event_id: z.string(),
  event_type: z.string(),
  lease_token: z.uuid(),
  external_subscription_id: z.string().nullable(),
  external_checkout_id: z.string().nullable(),
  external_customer_id: z.string().nullable(),
  attempts: z.number().int(),
  attempt_limit: z.number().int().positive(),
});
const intentSchema = z.object({
  subscription_id: z.uuid(),
  clinic_id: z.uuid(),
  external_checkout_id: z.string(),
  product_id: z.string(),
  amount_minor: z.coerce.number().int().positive(),
  recontract_id: z.uuid().optional(),
});
const MAX_ATTEMPTS = 10;

/** One bounded event per invocation. Leased work survives process interruption. */
export async function reconcileAbacatePayInbox(input: { eventId?: string } = {}): Promise<{
  applied: number;
  review: number;
  scanned: number;
  retry?: boolean;
}> {
  if (!env.ABACATEPAY_STORE_ID || !env.ABACATEPAY_API_KEY)
    return { applied: 0, review: 0, scanned: 0 };
  if (!isAbacatePaySandboxRuntime()) {
    metrics.emit('billing.abacatepay.reconcile_disabled', { reason: 'runtime_guard' });
    return { applied: 0, review: 0, scanned: 0 };
  }
  const token = randomUUID();
  const eventId =
    input.eventId === undefined ? null : z.string().min(1).max(200).parse(input.eventId);
  const [event] = z
    .array(queuedSchema)
    .max(1)
    .parse(
      await dbAdmin.execute(sql`
    WITH candidate AS (
      SELECT i.account_id,i.event_id,coalesce(replay.authorized_attempt,${MAX_ATTEMPTS}) attempt_limit
      FROM billing_gateway.event_inbox i
      JOIN billing_gateway.accounts a ON a.id=i.account_id
      LEFT JOIN LATERAL (SELECT authorized_attempt FROM billing_gateway.review_replays r
        WHERE r.account_id=i.account_id AND r.event_id=i.event_id
        ORDER BY authorized_attempt DESC LIMIT 1) replay ON true
      WHERE a.provider='abacatepay' AND a.environment='sandbox' AND a.external_account_id=${env.ABACATEPAY_STORE_ID}
        AND (${eventId}::text IS NULL OR i.event_id=${eventId})
        AND i.attempts <= coalesce(replay.authorized_attempt,${MAX_ATTEMPTS})
        AND (i.state='received' OR (i.state='processing' AND i.lease_until < now()))
      ORDER BY i.received_at FOR UPDATE OF i SKIP LOCKED LIMIT 1
    ) UPDATE billing_gateway.event_inbox i SET state='processing',attempts=attempts+1,
      lease_token=${token}::uuid,lease_until=now()+interval '60 seconds'
    FROM candidate c WHERE i.account_id=c.account_id AND i.event_id=c.event_id
    RETURNING i.account_id::text,i.event_id,i.event_type,i.lease_token::text,
      i.external_subscription_id,i.external_checkout_id,i.external_customer_id,i.attempts,c.attempt_limit`),
    );
  if (!event) {
    if (eventId) {
      const [existing] = z
        .array(
          z.object({ state: z.enum(['received', 'processing', 'applied', 'ignored', 'review']) }),
        )
        .max(1)
        .parse(
          await dbAdmin.execute(sql`SELECT i.state FROM billing_gateway.event_inbox i
          JOIN billing_gateway.accounts a ON a.id=i.account_id
          WHERE a.provider='abacatepay' AND a.environment='sandbox'
            AND a.external_account_id=${env.ABACATEPAY_STORE_ID} AND i.event_id=${eventId}`),
        );
      // Do not acknowledge a concurrent lease as if the financial effect had
      // already committed. Otherwise a crashed first worker could lose retries.
      if (existing?.state === 'received' || existing?.state === 'processing') {
        return { applied: 0, review: 0, scanned: 0, retry: true };
      }
    }
    return { applied: 0, review: 0, scanned: 0 };
  }
  async function finish(state: 'received' | 'applied' | 'ignored' | 'review', reason: string) {
    await dbAdmin.execute(sql`UPDATE billing_gateway.event_inbox SET state=${state},outcome_code=${reason},
      lease_token=NULL,lease_until=NULL,processed_at=now()
      WHERE account_id=${event!.account_id}::uuid AND event_id=${event!.event_id}
        AND state='processing' AND lease_token=${token}::uuid`);
  }
  // A process can die during its final lease. One final reservation only
  // closes that stale lease for review; it never performs an eleventh readback.
  if (event.attempts > event.attempt_limit) {
    await finish('review', 'worker_attempts_exhausted');
    return { applied: 0, review: 1, scanned: 1 };
  }
  if (event.event_type === 'subscription.cancelled' && event.external_subscription_id) {
    const result = await reconcileAbacatePayCancellation(dbAdmin, event.external_subscription_id);
    await finish(
      result.confirmed ? 'applied' : 'review',
      result.confirmed ? 'renewal_cancellation_verified' : 'cancellation_requires_review',
    );
    return { applied: result.confirmed, review: Number(result.confirmed === 0), scanned: 1 };
  }
  if (event.event_type === 'subscription.renewed') {
    try {
      const account = {
        provider: 'abacatepay',
        environment: 'sandbox',
        accountId: env.ABACATEPAY_STORE_ID,
      } as const;
      const result = await readAbacatePayRenewalForEvent(
        dbAdmin,
        account,
        event.event_id,
        env.ABACATEPAY_API_KEY,
      );
      if (result.state !== 'paid') {
        const retry = result.state === 'pending' && event.attempts < event.attempt_limit;
        await finish(
          retry ? 'received' : 'review',
          retry ? 'renewal_payment_pending' : 'renewal_readback_requires_review',
        );
        return { applied: 0, review: Number(!retry), scanned: 1, retry };
      }
      const outcome = await dbAdmin.transaction(async (tx) => {
        const lease = z
          .array(z.object({ event_id: z.string() }))
          .max(1)
          .parse(
            await tx.execute(sql`
          SELECT event_id FROM billing_gateway.event_inbox WHERE account_id=${event.account_id}::uuid
            AND event_id=${event.event_id} AND state='processing' AND lease_token=${token}::uuid
            AND lease_until > now() FOR UPDATE`),
          );
        if (!lease[0]) return 'lease_lost';
        const applied = await applyAbacatePayRenewalTx(tx, result.evidence, event.event_id);
        await tx.execute(sql`UPDATE billing_gateway.event_inbox SET state=${applied === 'review' ? 'review' : 'applied'},
          outcome_code=${applied === 'review' ? 'renewal_requires_review' : 'renewal_payment_applied'},
          lease_token=NULL,lease_until=NULL,processed_at=now()
          WHERE account_id=${event.account_id}::uuid AND event_id=${event.event_id} AND lease_token=${token}::uuid`);
        return applied;
      });
      metrics.emit('billing.abacatepay.event_reconciled', { outcome });
      return {
        applied: Number(outcome === 'applied' || outcome === 'historical'),
        review: Number(outcome === 'review'),
        scanned: 1,
        retry: outcome === 'lease_lost',
      };
    } catch {
      const retry = event.attempts < event.attempt_limit;
      await finish(retry ? 'received' : 'review', 'renewal_authoritative_readback_failed');
      metrics.emit('billing.abacatepay.reconcile_failed', {
        reason: 'renewal_readback_or_transaction',
      });
      return { applied: 0, review: Number(!retry), scanned: 1, retry };
    }
  }
  if (
    [
      'subscription.payment_failed',
      'checkout.refunded',
      'checkout.disputed',
      'checkout.lost',
    ].includes(event.event_type)
  ) {
    try {
      const evidence = await readAbacatePayNegativeEvent(dbAdmin, event.event_id);
      if (!evidence) {
        await finish('review', 'negative_event_binding_requires_review');
        return { applied: 0, review: 1, scanned: 1 };
      }
      const recorded = await dbAdmin.transaction(async (tx) => {
        const lease = z
          .array(z.object({ event_id: z.string() }))
          .max(1)
          .parse(
            await tx.execute(sql`
          SELECT event_id FROM billing_gateway.event_inbox WHERE account_id=${event.account_id}::uuid
            AND event_id=${event.event_id} AND state='processing' AND lease_token=${token}::uuid AND lease_until>now() FOR UPDATE`),
          );
        if (!lease.length) return false;
        await recordAbacatePayNegativeEventTx(tx, evidence);
        await tx.execute(sql`UPDATE billing_gateway.event_inbox SET state='review',outcome_code='negative_readback_recorded_human_review',
          lease_token=NULL,lease_until=NULL,processed_at=now(),subscription_id=${evidence.subscriptionId}::uuid,clinic_id=${evidence.clinicId}::uuid
          WHERE account_id=${event.account_id}::uuid AND event_id=${event.event_id} AND lease_token=${token}::uuid`);
        return true;
      });
      metrics.emit('billing.abacatepay.negative_event_review', {
        evidenceLevel: evidence.evidenceLevel,
        recorded,
      });
      return { applied: 0, review: Number(recorded), scanned: 1, retry: !recorded };
    } catch {
      const retry = event.attempts < event.attempt_limit;
      await finish(retry ? 'received' : 'review', 'negative_authoritative_readback_failed');
      metrics.emit('billing.abacatepay.reconcile_failed', {
        reason: 'negative_readback_or_transaction',
      });
      return { applied: 0, review: Number(!retry), scanned: 1, retry };
    }
  }
  if (event.event_type !== 'subscription.completed') {
    // Renewal must not reuse the initial bill's PAID status to extend access.
    const known =
      event.event_type.startsWith('subscription.') || event.event_type.startsWith('checkout.');
    await finish(
      known ? 'review' : 'ignored',
      known ? 'lifecycle_readback_required' : 'unsupported_event',
    );
    return { applied: 0, review: Number(known), scanned: 1 };
  }
  try {
    if (!event.external_subscription_id) {
      await finish('review', 'subscription_reference_missing');
      return { applied: 0, review: 1, scanned: 1 };
    }
    const config = {
      apiKey: env.ABACATEPAY_API_KEY,
      environment: 'sandbox' as const,
      timeoutMs: 2000,
    };
    const read = createAbacatePayReadClient(config);
    const remote = await read.readSubscription(event.external_subscription_id);
    if (
      !remote.checkoutId ||
      (event.external_checkout_id && event.external_checkout_id !== remote.checkoutId) ||
      (event.external_customer_id && event.external_customer_id !== remote.customerId)
    ) {
      await finish('review', 'event_binding_mismatch');
      return { applied: 0, review: 1, scanned: 1 };
    }
    let [intent] = z
      .array(intentSchema)
      .max(1)
      .parse(
        await dbAdmin.execute(sql`
      SELECT b.subscription_id::text,b.clinic_id::text,b.external_checkout_id,i.product_id,i.amount_minor::text
      FROM billing_gateway.bindings b JOIN billing_gateway.checkout_intents i
        ON i.subscription_id=b.subscription_id AND i.account_id=b.account_id AND i.clinic_id=b.clinic_id
      WHERE b.account_id=${event.account_id}::uuid AND b.external_checkout_id=${remote.checkoutId}`),
      );
    if (!intent && (await abacatePayManagementReady(dbAdmin))) {
      [intent] = z
        .array(intentSchema)
        .max(1)
        .parse(
          await dbAdmin.execute(sql`
        SELECT subscription_id::text,clinic_id::text,external_checkout_id,product_id,amount_minor::text,id::text recontract_id
        FROM billing_gateway.recontracts WHERE account_id=${event.account_id}::uuid AND external_checkout_id=${remote.checkoutId}`),
        );
    }
    if (!intent) {
      await finish(
        event.attempts >= event.attempt_limit ? 'review' : 'received',
        'binding_not_ready',
      );
      return {
        applied: 0,
        review: Number(event.attempts >= event.attempt_limit),
        scanned: 1,
        retry: event.attempts < event.attempt_limit,
      };
    }
    const verifiedIntent = intent;
    const product = await read.readProduct(intent.product_id);
    if (
      product.cycle !== 'MONTHLY' ||
      product.price !== intent.amount_minor ||
      product.trialDays != null
    ) {
      await finish('review', 'product_snapshot_mismatch');
      return { applied: 0, review: 1, scanned: 1 };
    }
    const account = {
      provider: 'abacatepay',
      environment: 'sandbox',
      accountId: env.ABACATEPAY_STORE_ID,
    } as const;
    const evidence = await createAbacatePayInitialPaymentReader(account, config).readInitialPayment(
      {
        subscriptionId: remote.id,
        customerId: remote.customerId,
        checkoutId: intent.external_checkout_id,
        productId: intent.product_id,
        expectedAmountMinor: intent.amount_minor,
      },
    );
    // A completed notification can arrive before provider reads converge.
    // Retry a pending bill within the existing bound; never grant from it.
    if (evidence.state === 'pending') {
      const exhausted = event.attempts >= event.attempt_limit;
      await finish(exhausted ? 'review' : 'received', 'initial_payment_pending');
      return { applied: 0, review: Number(exhausted), scanned: 1, retry: !exhausted };
    }
    const applied = await dbAdmin.transaction(async (tx) => {
      // Lock the lease row before granting. An expired worker cannot commit an effect.
      const lease = z.array(z.object({ event_id: z.string() })).parse(
        await tx.execute(sql`
        SELECT event_id FROM billing_gateway.event_inbox WHERE account_id=${event.account_id}::uuid
          AND event_id=${event.event_id} AND state='processing' AND lease_token=${token}::uuid
          AND lease_until > now() FOR UPDATE`),
      );
      if (!lease[0]) return 'review';
      const outcome = verifiedIntent.recontract_id
        ? await applyAbacatePayRecontractPaymentTx(tx, evidence)
        : await applyInitialAbacatePayPaymentTx(tx, evidence);
      await tx.execute(sql`UPDATE billing_gateway.event_inbox SET state=${outcome === 'review' ? 'review' : 'applied'},
        outcome_code=${outcome === 'review' ? 'initial_payment_not_applicable' : 'initial_payment_applied'},
        lease_token=NULL,lease_until=NULL,processed_at=now(),
        subscription_id=${verifiedIntent.subscription_id}::uuid,clinic_id=${verifiedIntent.clinic_id}::uuid
        WHERE account_id=${event.account_id}::uuid AND event_id=${event.event_id} AND lease_token=${token}::uuid`);
      return outcome;
    });
    metrics.emit('billing.abacatepay.event_reconciled', { outcome: applied });
    return {
      applied: Number(applied === 'applied'),
      review: Number(applied === 'review'),
      scanned: 1,
    };
  } catch {
    await finish(
      event.attempts >= event.attempt_limit ? 'review' : 'received',
      'authoritative_readback_failed',
    );
    metrics.emit('billing.abacatepay.reconcile_failed', {
      reason: 'authoritative_readback_or_transaction',
    });
    return {
      applied: 0,
      review: Number(event.attempts >= event.attempt_limit),
      scanned: 1,
      retry: event.attempts < event.attempt_limit,
    };
  }
}

/**
 * Recovers a known initial checkout if its webhook never arrived. No provider
 * event is fabricated and no command/charge is emitted. Only one contract is
 * read per invocation; the audit timestamp rotates pending candidates.
 */
export async function reconcileMissingAbacatePayInitialPayment(
  input: { subscriptionId?: string } = {},
): Promise<{
  scanned: number;
  applied: number;
  duplicate: number;
  review: number;
}> {
  const idle = { scanned: 0, applied: 0, duplicate: 0, review: 0 };
  if (!env.ABACATEPAY_STORE_ID || !env.ABACATEPAY_API_KEY || !isAbacatePaySandboxRuntime())
    return idle;
  const subscriptionId =
    input.subscriptionId === undefined ? null : z.uuid().parse(input.subscriptionId);
  const [candidate] = z
    .array(
      z.object({
        subscription_id: z.uuid(),
        clinic_id: z.uuid(),
        checkout_id: z.string(),
        product_id: z.string(),
        amount_minor: z.coerce.number().int().positive(),
      }),
    )
    .max(1)
    .parse(
      await dbAdmin.execute(sql`
    SELECT s.id::text subscription_id,s.clinic_id::text,b.external_checkout_id checkout_id,
      i.product_id,i.amount_minor::text
    FROM public.subscriptions s JOIN billing_gateway.bindings b ON b.subscription_id=s.id AND b.clinic_id=s.clinic_id
    JOIN billing_gateway.accounts a ON a.id=b.account_id
    JOIN billing_gateway.checkout_intents i ON i.subscription_id=s.id AND i.account_id=a.id AND i.price_id=s.price_id
    JOIN public.trial_access_policies t ON t.subscription_id=s.id AND t.clinic_id=s.clinic_id
    LEFT JOIN LATERAL (
      SELECT max(e.created_at) checked_at FROM public.billing_events e WHERE e.clinic_id=s.clinic_id
        AND e.type='subscription.initial_payment.checked' AND e.payload->>'subscriptionId'=s.id::text
    ) checked ON true
    WHERE s.billing_provider='abacatepay' AND s.billing_status='trial' AND s.asaas_subscription_id IS NULL
      AND s.trial_ends_at <= now() AND t.released_at IS NULL
      AND b.external_checkout_id IS NOT NULL AND b.external_subscription_id IS NULL
      AND a.provider='abacatepay' AND a.environment='sandbox' AND a.external_account_id=${env.ABACATEPAY_STORE_ID}
      AND (${subscriptionId}::uuid IS NULL OR s.id=${subscriptionId}::uuid)
      AND (${subscriptionId}::uuid IS NOT NULL OR checked.checked_at IS NULL OR checked.checked_at < now()-interval '1 hour')
    ORDER BY checked.checked_at NULLS FIRST,i.created_at LIMIT 1
  `),
    );
  if (!candidate) return idle;
  const checked = async (outcome: string) =>
    dbAdmin.transaction((tx) =>
      recordBillingEvent(tx, candidate.clinic_id, 'subscription.initial_payment.checked', {
        subscriptionId: candidate.subscription_id,
        provider: 'abacatepay',
        outcome,
      }),
    );
  try {
    const config = {
      apiKey: env.ABACATEPAY_API_KEY,
      environment: 'sandbox' as const,
      timeoutMs: 2000,
    };
    const account = {
      provider: 'abacatepay',
      environment: 'sandbox',
      accountId: env.ABACATEPAY_STORE_ID,
    } as const;
    const read = createAbacatePayReadClient(config);
    if ((await read.readStore()).id !== account.accountId)
      throw new Error('Readback account mismatch');
    const subscriptions = await read.listSubscriptionsForCheckout(candidate.checkout_id);
    if (subscriptions.length === 0) {
      await checked('pending');
      return { ...idle, scanned: 1 };
    }
    const remote = subscriptions[0];
    if (!remote) throw new Error('Readback subscription missing');
    const product = await read.readProduct(candidate.product_id);
    if (
      product.cycle !== 'MONTHLY' ||
      product.trialDays != null ||
      product.price !== candidate.amount_minor
    )
      throw new Error('Readback product mismatch');
    const evidence = await createAbacatePayInitialPaymentReader(account, config).readInitialPayment(
      {
        subscriptionId: remote.id,
        customerId: remote.customerId,
        checkoutId: candidate.checkout_id,
        productId: candidate.product_id,
        expectedAmountMinor: candidate.amount_minor,
      },
    );
    if (evidence.state !== 'paid') {
      await checked(evidence.state);
      return { ...idle, scanned: 1, review: Number(evidence.state !== 'pending') };
    }
    const outcome = await dbAdmin.transaction(async (tx) => {
      const applied = await applyInitialAbacatePayPaymentTx(tx, evidence);
      await recordBillingEvent(tx, candidate.clinic_id, 'subscription.initial_payment.checked', {
        subscriptionId: candidate.subscription_id,
        provider: 'abacatepay',
        outcome: applied,
      });
      return applied;
    });
    metrics.emit('billing.abacatepay.initial_payment_reconciled', { outcome });
    return {
      scanned: 1,
      applied: Number(outcome === 'applied'),
      duplicate: Number(outcome === 'duplicate'),
      review: Number(outcome === 'review'),
    };
  } catch {
    await checked('readback_or_transaction_failed');
    metrics.emit('billing.abacatepay.reconcile_failed', { reason: 'missing_initial_webhook' });
    return { ...idle, scanned: 1, review: 1 };
  }
}
