import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '@/lib/env';
import { captureBackgroundError } from '@/lib/observability/capture';
import { metrics } from '@/lib/observability/metrics';
import { isAbacatePaySandboxRuntime } from '@/lib/payments/saas/acquisition';
import { GatewayReadError } from '@/lib/payments/saas/contracts';
import type { BillingGatewaySql } from '@/lib/payments/saas/postgres-store';
import { createAbacatePayCheckoutIntegrityReader } from '@/lib/payments/abacatepay/checkout-integrity';
import type { CheckoutRecurrenceObservation } from '@/lib/payments/saas/recurrence-integrity';
import type { ManagementDatabase } from './abacatepay-management';
import { recordBillingEvent } from './subscriptions';

const READ_TIMEOUT_MS = 1500;
const CANDIDATE_BUDGET_MS = 7000;
const MAX_CANDIDATES = 3;
const candidateSchema = z.object({
  account_id: z.uuid(),
  subscription_id: z.uuid(),
  clinic_id: z.uuid(),
  generation_id: z.uuid(),
  checkout_id: z.string(),
  external_subscription_id: z.string().nullable(),
  external_customer_id: z.string().nullable(),
  cancellation_requested: z.boolean(),
});
type Candidate = z.infer<typeof candidateSchema>;

/** Also inspect old generations: a copied original link can outlive recontracting. */
async function candidate(
  database: BillingGatewaySql,
  input: {
    checkoutId: string | null;
    generationId?: string;
    due: boolean;
    lock: boolean;
    skipLocked?: boolean;
  },
) {
  const [row] = z
    .array(candidateSchema)
    .max(1)
    .parse(
      await database.execute(sql`
    SELECT a.id::text account_id,s.id::text subscription_id,s.clinic_id::text,g.generation_id::text,
      g.checkout_id,g.external_subscription_id,g.external_customer_id,
      EXISTS(SELECT 1 FROM billing_gateway.cancellations c WHERE c.account_id=a.id
        AND c.external_subscription_id=g.external_subscription_id) cancellation_requested
    FROM public.subscriptions s JOIN billing_gateway.bindings b ON b.subscription_id=s.id AND b.clinic_id=s.clinic_id
    JOIN billing_gateway.accounts a ON a.id=b.account_id
    CROSS JOIN LATERAL (
      SELECT s.id generation_id,b.external_checkout_id checkout_id,b.external_subscription_id,b.external_customer_id
      WHERE b.external_checkout_id IS NOT NULL
      UNION ALL
      SELECT r.id,r.external_checkout_id,r.external_subscription_id,r.external_customer_id FROM billing_gateway.recontracts r
      WHERE r.account_id=a.id AND r.subscription_id=s.id AND r.clinic_id=s.clinic_id AND r.external_checkout_id IS NOT NULL
    ) g
    LEFT JOIN LATERAL (SELECT max(e.created_at) checked_at FROM public.billing_events e
      WHERE e.clinic_id=s.clinic_id AND e.type='subscription.recurrence.checked'
        AND e.payload->>'generationId'=g.generation_id::text) checked ON true
    WHERE a.provider='abacatepay' AND a.environment='sandbox' AND a.external_account_id=${env.ABACATEPAY_STORE_ID}
      AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL
      AND (${input.checkoutId}::text IS NULL OR g.checkout_id=${input.checkoutId})
      AND (${input.generationId ?? null}::uuid IS NULL OR g.generation_id=${input.generationId ?? null}::uuid)
      AND (${!input.due} OR checked.checked_at IS NULL OR checked.checked_at<now()-interval '1 hour')
    ORDER BY checked.checked_at NULLS FIRST,s.id,g.generation_id LIMIT 1
    ${input.lock ? sql`FOR UPDATE OF s ${input.skipLocked === false ? sql`` : sql`SKIP LOCKED`}` : sql``}`),
    );
  return row ?? null;
}

async function saveObservation(
  database: ManagementDatabase,
  before: Candidate,
  checkId: string,
  observation: CheckoutRecurrenceObservation,
) {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout='2s'`);
    const current = await candidate(tx, {
      checkoutId: before.checkout_id,
      generationId: before.generation_id,
      due: false,
      lock: true,
      skipLocked: false,
    });
    if (
      !current ||
      current.subscription_id !== before.subscription_id ||
      current.clinic_id !== before.clinic_id ||
      current.external_subscription_id !== before.external_subscription_id ||
      current.external_customer_id !== before.external_customer_id
    )
      return { issue: 'binding_changed', recorded: false, deferred: true };
    const [latest] = z
      .array(z.object({ check_id: z.uuid() }))
      .max(1)
      .parse(
        await tx.execute(sql`
      SELECT payload->>'checkId' check_id FROM public.billing_events WHERE clinic_id=${current.clinic_id}::uuid
        AND type='subscription.recurrence.checked' AND payload->>'generationId'=${current.generation_id}
      ORDER BY created_at DESC,id DESC LIMIT 1`),
      );
    if (latest?.check_id !== checkId)
      return { issue: 'check_superseded', recorded: false, deferred: true };
    const issue =
      observation.issue ??
      (observation.recurrence === 'stopped' && !current.cancellation_requested
        ? 'unexpected_cancellation'
        : observation.recurrence === 'unknown'
          ? 'unknown_recurrence'
          : null);
    await recordBillingEvent(tx, current.clinic_id, 'subscription.recurrence.observed', {
      provider: 'abacatepay',
      checkId,
      generationId: current.generation_id,
      issue,
      recurrence: observation.recurrence,
      complete: observation.complete,
      observedSubscriptionIds: observation.observedSubscriptionIds,
      accessEffect: 'none_human_review_only',
    });
    if (!issue) return { issue: null, recorded: false, deferred: false };
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          current.account_id,
          current.generation_id,
          issue,
          observation.observedSubscriptionIds,
        ]),
      )
      .digest('hex');
    const [existing] = z
      .array(z.object({ id: z.uuid() }))
      .max(1)
      .parse(
        await tx.execute(sql`
      SELECT id::text FROM public.billing_events WHERE clinic_id=${current.clinic_id}::uuid
        AND type='subscription.recurrence.review_required' AND payload->>'fingerprint'=${fingerprint} LIMIT 1`),
      );
    if (existing) return { issue, recorded: false, deferred: false };
    await recordBillingEvent(tx, current.clinic_id, 'subscription.recurrence.review_required', {
      provider: 'abacatepay',
      checkId,
      generationId: current.generation_id,
      fingerprint,
      issue,
      observedSubscriptionIds: observation.observedSubscriptionIds,
      accessEffect: 'none_human_review_only',
    });
    return { issue, recorded: true, deferred: false };
  });
}

/** Read-only remote backstop. Reservations and review evidence use the existing append-only audit. */
export async function reconcileAbacatePayIntegrity(
  database: ManagementDatabase,
  input: { checkoutId?: string; deadlineMs?: number; maxCandidates?: number } = {},
) {
  const idle = { scanned: 0, reviews: 0, failed: 0, deferred: false };
  if (!isAbacatePaySandboxRuntime() || !env.ABACATEPAY_API_KEY || !env.ABACATEPAY_STORE_ID)
    return idle;
  const checkoutId =
    input.checkoutId === undefined
      ? null
      : z
          .string()
          .regex(/^bill_[A-Za-z0-9_-]+$/)
          .max(200)
          .parse(input.checkoutId);
  const limit = z
    .number()
    .int()
    .min(1)
    .max(MAX_CANDIDATES)
    .parse(input.maxCandidates ?? MAX_CANDIDATES);
  const deadline = Math.min(
    z
      .number()
      .finite()
      .parse(input.deadlineMs ?? Date.now() + limit * CANDIDATE_BUDGET_MS + 1000),
    Date.now() + MAX_CANDIDATES * CANDIDATE_BUDGET_MS + 1000,
  );
  const result = { ...idle };
  for (let i = 0; i < limit; i++) {
    if (Date.now() + CANDIDATE_BUDGET_MS > deadline) {
      result.deferred = true;
      break;
    }
    const checkId = randomUUID();
    const reserved = await database.transaction(async (tx) => {
      const selected = await candidate(tx, { checkoutId, due: true, lock: true });
      if (!selected) return null;
      // The lock may have become available after this statement's snapshot.
      // Recheck the audit predicate in a fresh snapshot while holding it.
      const row = await candidate(tx, {
        checkoutId: selected.checkout_id,
        generationId: selected.generation_id,
        due: true,
        lock: false,
      });
      if (!row) return null;
      await recordBillingEvent(tx, row.clinic_id, 'subscription.recurrence.checked', {
        provider: 'abacatepay',
        checkId,
        generationId: row.generation_id,
      });
      return row;
    });
    if (!reserved) break;
    result.scanned++;
    try {
      const observation = await createAbacatePayCheckoutIntegrityReader(
        {
          provider: 'abacatepay',
          environment: 'sandbox',
          accountId: env.ABACATEPAY_STORE_ID,
        },
        { apiKey: env.ABACATEPAY_API_KEY, environment: 'sandbox', timeoutMs: READ_TIMEOUT_MS },
      ).inspect({
        checkoutId: reserved.checkout_id,
        subscriptionId: reserved.external_subscription_id,
        customerId: reserved.external_customer_id,
      });
      const saved = await saveObservation(database, reserved, checkId, observation);
      result.deferred ||= saved.deferred;
      if (saved.recorded) {
        result.reviews++;
        metrics.emit('billing.abacatepay.integrity_review', { reason: saved.issue });
        captureBackgroundError(new Error(`Billing recurrence requires review: ${saved.issue}`), {
          flow: 'billing.abacatepay.integrity',
          clinicId: reserved.clinic_id,
        });
      }
    } catch (error) {
      result.failed++;
      const reason =
        error instanceof GatewayReadError ? error.code : 'readback_or_persistence_failed';
      await database.transaction((tx) =>
        recordBillingEvent(tx, reserved.clinic_id, 'subscription.recurrence.check_failed', {
          provider: 'abacatepay',
          checkId,
          generationId: reserved.generation_id,
          reason,
        }),
      );
      metrics.emit('billing.abacatepay.integrity_failed', { reason });
      captureBackgroundError(new Error(`Billing integrity scan failed: ${reason}`), {
        flow: 'billing.abacatepay.integrity',
        clinicId: reserved.clinic_id,
      });
    }
  }
  // A bounded batch is not proof that every owned checkout was inspected.
  // Make remaining work visible instead of reporting an implicitly clean scan.
  if (
    result.scanned === limit &&
    (await candidate(database, { checkoutId, due: true, lock: false }))
  )
    result.deferred = true;
  metrics.emit('billing.abacatepay.integrity_scan', result);
  return result;
}
