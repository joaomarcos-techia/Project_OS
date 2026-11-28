import { abacatePayEnvironment } from '@/lib/payments/saas/acquisition';
import 'server-only';

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { isAbacatePayRuntime } from '@/lib/payments/saas/acquisition';
import type { BillingGatewaySql } from '@/lib/payments/saas/postgres-store';

const reviewRow = z.object({
  account_id: z.uuid(),
  event_id: z.string(),
  event_type: z.string(),
  payload_hash: z.string().regex(/^[a-f0-9]{64}$/),
  attempts: z.number().int().nonnegative(),
  subscription_id: z.uuid(),
  clinic_id: z.uuid(),
  outcome_code: z.string().nullable(),
  received_at: z.coerce.date(),
  replay_count: z.number().int().nonnegative(),
});
export const abacatePayReplayInput = z
  .object({
    accountId: z.uuid(),
    eventId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/),
    clinicId: z.uuid(),
    snapshot: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.enum(['provider_recovered', 'binding_reconciled', 'evidence_available']),
    evidenceReference: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/),
  })
  .strict();
export class AbacatePayReviewError extends Error {
  constructor(readonly code: 'unavailable' | 'snapshot_changed' | 'replay_limit') {
    super(`AbacatePay review: ${code}`);
  }
}
type ReviewRow = z.infer<typeof reviewRow>;
function fingerprint(row: ReviewRow) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        row.account_id,
        row.event_id,
        row.clinic_id,
        row.subscription_id,
        row.payload_hash,
        row.attempts,
      ]),
    )
    .digest('hex');
}
function enabled() {
  return isAbacatePayRuntime() && Boolean(env.ABACATEPAY_STORE_ID);
}
async function reviews(database: BillingGatewaySql, key?: { accountId: string; eventId: string }) {
  if (!enabled()) return [];
  return z.array(reviewRow).parse(
    await database.execute(sql`
    SELECT e.account_id::text,e.event_id,e.event_type,e.payload_hash,e.attempts,
      b.subscription_id::text,b.clinic_id::text,e.outcome_code,e.received_at,
      (SELECT count(*)::integer FROM billing_gateway.review_replays replay
        WHERE replay.account_id=e.account_id AND replay.event_id=e.event_id
          AND replay.created_at>now()-interval '24 hours') replay_count
    FROM billing_gateway.event_inbox e JOIN billing_gateway.accounts a ON a.id=e.account_id
    JOIN billing_gateway.bindings b ON b.account_id=a.id
      AND ((b.external_subscription_id=e.external_subscription_id AND b.external_customer_id=e.external_customer_id)
        OR EXISTS(SELECT 1 FROM billing_gateway.recontracts r WHERE r.account_id=a.id
          AND r.subscription_id=b.subscription_id AND r.clinic_id=b.clinic_id
          AND r.external_subscription_id=e.external_subscription_id AND r.external_customer_id=e.external_customer_id))
    JOIN public.subscriptions s ON s.id=b.subscription_id AND s.clinic_id=b.clinic_id
    WHERE a.provider='abacatepay' AND a.environment=${abacatePayEnvironment()} AND a.external_account_id=${env.ABACATEPAY_STORE_ID}
      AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL AND e.state='review'
      AND e.event_type IN ('subscription.completed','subscription.renewed','subscription.cancelled',
        'subscription.payment_failed','checkout.refunded','checkout.disputed','checkout.lost')
      AND (e.subscription_id IS NULL OR (e.subscription_id=b.subscription_id AND e.clinic_id=b.clinic_id))
      AND (${key?.accountId ?? null}::uuid IS NULL OR e.account_id=${key?.accountId ?? null}::uuid)
      AND (${key?.eventId ?? null}::text IS NULL OR e.event_id=${key?.eventId ?? null})
    ORDER BY e.received_at,e.event_id LIMIT 50`),
  );
}
/** Privileged server seam. Caller must enforce fresh superadmin MFA before using it. */
export async function listAbacatePayReviews(database: BillingGatewaySql) {
  return (await reviews(database)).map((row) => ({ ...row, snapshot: fingerprint(row) }));
}
/** Caller owns the transaction and super_admin_actions audit. No payment/period command is accepted. */
export async function authorizeAbacatePayReplayTx(tx: Tx, raw: unknown, actorId: string) {
  if (!enabled()) throw new AbacatePayReviewError('unavailable');
  const input = abacatePayReplayInput.parse(raw);
  z.uuid().parse(actorId);
  await tx.execute(sql`SET LOCAL lock_timeout='2s'`);
  await tx.execute(sql`SELECT event_id FROM billing_gateway.event_inbox
    WHERE account_id=${input.accountId}::uuid AND event_id=${input.eventId} FOR UPDATE`);
  const rows = await reviews(tx, input);
  if (
    rows.length !== 1 ||
    rows[0]?.clinic_id !== input.clinicId ||
    fingerprint(rows[0]) !== input.snapshot
  )
    throw new AbacatePayReviewError('snapshot_changed');
  const row = rows[0];
  if (row.replay_count >= 3) throw new AbacatePayReviewError('replay_limit');
  const [approval] = z
    .array(z.object({ id: z.uuid() }))
    .length(1)
    .parse(
      await tx.execute(sql`
    INSERT INTO billing_gateway.review_replays(account_id,event_id,subscription_id,clinic_id,payload_hash,
      expected_attempts,requested_by,reason,evidence_reference)
    VALUES(${row.account_id}::uuid,${row.event_id},${row.subscription_id}::uuid,${row.clinic_id}::uuid,
      ${row.payload_hash},${row.attempts},${actorId}::uuid,${input.reason},${input.evidenceReference}) RETURNING id::text`),
    );
  await tx.execute(sql`UPDATE billing_gateway.event_inbox SET state='received',processed_at=NULL,
    outcome_code='operator_readback_authorized',lease_token=NULL,lease_until=NULL
    WHERE account_id=${row.account_id}::uuid AND event_id=${row.event_id} AND state='review' AND attempts=${row.attempts}`);
  return { approvalId: approval!.id, state: 'queued' as const };
}
