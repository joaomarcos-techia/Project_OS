import { abacatePayEnvironment } from '@/lib/payments/saas/acquisition';
import 'server-only';

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '@/lib/env';
import { captureBackgroundError } from '@/lib/observability/capture';
import { metrics } from '@/lib/observability/metrics';
import { isAbacatePayRuntime } from '@/lib/payments/saas/acquisition';
import type { ManagementDatabase } from './abacatepay-management';
import { recordBillingEvent } from './subscriptions';

const MAX_CANDIDATES = 10;
const SCAN_BUDGET_MS = 7000;
const candidateSchema = z.object({
  account_id: z.uuid(),
  subscription_id: z.uuid(),
  clinic_id: z.uuid(),
  generation_id: z.uuid(),
  period_end: z.coerce.date(),
  due: z.boolean(),
  previous_state: z.enum(['due', 'resolved']).nullable(),
  previous_fingerprint: z.string().nullable(),
});

/** A local overdue period is an incident, never evidence that a renewal was paid or lost. */
export async function observeAbacatePayRenewals(database: ManagementDatabase) {
  const idle = { scanned: 0, due: 0, opened: 0, resolved: 0, deferred: false };
  if (!isAbacatePayRuntime() || !env.ABACATEPAY_STORE_ID) return idle;
  const deadline = Date.now() + SCAN_BUDGET_MS;
  const result = await database.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout='2s'`);
    await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
    const rows = z.array(candidateSchema).parse(
      await tx.execute(sql`
      SELECT a.id::text account_id,s.id::text subscription_id,s.clinic_id::text,
        coalesce(r.id,s.id)::text generation_id,s.current_period_end period_end,
        (s.billing_status IN ('active','past_due') AND NOT s.cancel_at_period_end
          AND c.requested_at IS NULL AND pr.billing_cycle='monthly'
          AND s.current_period_end<=now()) due,
        previous.payload->>'state' previous_state,previous.payload->>'fingerprint' previous_fingerprint
      FROM public.subscriptions s
      JOIN billing_gateway.bindings b ON b.subscription_id=s.id AND b.clinic_id=s.clinic_id
      JOIN billing_gateway.accounts a ON a.id=b.account_id
      JOIN public.prices pr ON pr.id=s.price_id
      LEFT JOIN LATERAL (SELECT * FROM billing_gateway.recontracts latest
        WHERE latest.subscription_id=s.id AND latest.account_id=a.id AND latest.clinic_id=s.clinic_id
          AND latest.invoice_id IS NOT NULL ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1) r ON true
      LEFT JOIN billing_gateway.cancellations c ON c.account_id=a.id
        AND c.external_subscription_id=coalesce(r.external_subscription_id,b.external_subscription_id)
      LEFT JOIN LATERAL (SELECT e.payload FROM public.billing_events e
        WHERE e.clinic_id=s.clinic_id AND e.type='subscription.renewal_watch.observed'
          AND e.payload->>'subscriptionId'=s.id::text
        ORDER BY e.created_at DESC,e.id DESC LIMIT 1) previous ON true
      LEFT JOIN LATERAL (SELECT max(e.created_at) checked_at FROM public.billing_events e
        WHERE e.clinic_id=s.clinic_id AND e.type='subscription.renewal_watch.checked'
          AND e.payload->>'subscriptionId'=s.id::text) checked ON true
      WHERE a.provider='abacatepay' AND a.environment=${abacatePayEnvironment()} AND a.external_account_id=${env.ABACATEPAY_STORE_ID}
        AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL
        AND s.current_period_end IS NOT NULL
        AND coalesce(r.external_subscription_id,b.external_subscription_id) IS NOT NULL
        AND (r.invoice_id IS NOT NULL OR EXISTS(SELECT 1 FROM billing_gateway.paid_checkouts p
          WHERE p.account_id=a.id AND p.subscription_id=s.id AND p.clinic_id=s.clinic_id))
        AND ((s.billing_status IN ('active','past_due') AND NOT s.cancel_at_period_end
          AND c.requested_at IS NULL AND pr.billing_cycle='monthly' AND s.current_period_end<=now())
          OR previous.payload->>'state'='due')
        AND (checked.checked_at IS NULL OR checked.checked_at<now()-interval '1 hour'
          OR previous.payload->>'periodEnd' IS DISTINCT FROM to_char(s.current_period_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          OR (previous.payload->>'state'='due' AND (s.cancel_at_period_end OR c.requested_at IS NOT NULL)))
      ORDER BY checked.checked_at NULLS FIRST,s.current_period_end,s.id
      LIMIT ${MAX_CANDIDATES} FOR UPDATE OF s SKIP LOCKED`),
    );
    const counts = { ...idle, deferred: rows.length === MAX_CANDIDATES };
    for (const row of rows) {
      if (Date.now() >= deadline) {
        counts.deferred = true;
        break;
      }
      counts.scanned++;
      const state = row.due ? 'due' : 'resolved';
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify([row.account_id, row.generation_id, row.period_end.toISOString(), state]),
        )
        .digest('hex');
      // Another scan may have committed its audit after this statement snapshot
      // but before we acquired the subscription lock. Re-read under that lock.
      const [latest] = z
        .array(z.object({ fingerprint: z.string(), state: z.enum(['due', 'resolved']) }))
        .max(1)
        .parse(
          await tx.execute(sql`
        SELECT payload->>'fingerprint' fingerprint,payload->>'state' state FROM public.billing_events
        WHERE clinic_id=${row.clinic_id}::uuid AND type='subscription.renewal_watch.observed'
          AND payload->>'subscriptionId'=${row.subscription_id}
        ORDER BY created_at DESC,id DESC LIMIT 1`),
        );
      await recordBillingEvent(tx, row.clinic_id, 'subscription.renewal_watch.checked', {
        provider: 'abacatepay',
        subscriptionId: row.subscription_id,
      });
      if (row.due) counts.due++;
      if (fingerprint === latest?.fingerprint) continue;
      await recordBillingEvent(tx, row.clinic_id, 'subscription.renewal_watch.observed', {
        provider: 'abacatepay',
        subscriptionId: row.subscription_id,
        generationId: row.generation_id,
        periodEnd: row.period_end.toISOString(),
        state,
        fingerprint,
        issue: row.due ? 'renewal_unobserved' : null,
        accessEffect: 'none_human_review_only',
      });
      if (row.due) counts.opened++;
      else if (latest?.state === 'due') counts.resolved++;
    }
    return counts;
  });
  metrics.emit('billing.abacatepay.renewal_watch', result);
  if (result.opened || result.deferred)
    captureBackgroundError(
      new Error(
        result.deferred
          ? 'AbacatePay renewal watch coverage deferred'
          : 'AbacatePay renewal requires operator review',
      ),
      {
        flow: 'billing.abacatepay.renewal_watch',
      },
    );
  return result;
}
