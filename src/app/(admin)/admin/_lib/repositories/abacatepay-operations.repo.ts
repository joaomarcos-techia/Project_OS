import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { dbAdmin } from '@/lib/db';
import { env } from '@/lib/env';
import { isAbacatePaySandboxRuntime } from '@/lib/payments/saas/acquisition';
import { listAbacatePayReviews } from '@/contexts/billing/internal/abacatepay-review';

export async function getAbacatePayOperations() {
  if (!isAbacatePaySandboxRuntime() || !env.ABACATEPAY_STORE_ID) return null;
  const [reviews, renewals, backlog, recent] = await Promise.all([
    listAbacatePayReviews(dbAdmin),
    dbAdmin.execute(sql`
      SELECT s.id::text subscription_id,s.clinic_id::text,latest.created_at,latest.payload->>'periodEnd' period_end
      FROM public.subscriptions s JOIN billing_gateway.bindings b ON b.subscription_id=s.id AND b.clinic_id=s.clinic_id
      JOIN billing_gateway.accounts a ON a.id=b.account_id
      JOIN LATERAL (SELECT e.created_at,e.payload FROM public.billing_events e
        WHERE e.clinic_id=s.clinic_id AND e.type='subscription.renewal_watch.observed'
          AND e.payload->>'subscriptionId'=s.id::text ORDER BY e.created_at DESC,e.id DESC LIMIT 1) latest ON true
      WHERE a.provider='abacatepay' AND a.environment='sandbox' AND a.external_account_id=${env.ABACATEPAY_STORE_ID}
        AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL AND latest.payload->>'state'='due'
      ORDER BY latest.created_at LIMIT 50`),
    dbAdmin.execute(sql`
      SELECT count(*) FILTER(WHERE i.state='review')::integer reviews,
        count(*) FILTER(WHERE i.state IN ('received','processing'))::integer queued,
        min(i.received_at) FILTER(WHERE i.state IN ('received','processing','review')) oldest
      FROM billing_gateway.event_inbox i JOIN billing_gateway.accounts a ON a.id=i.account_id
      WHERE a.provider='abacatepay' AND a.environment='sandbox' AND a.external_account_id=${env.ABACATEPAY_STORE_ID}`),
    dbAdmin.execute(sql`SELECT i.account_id::text,i.event_id,i.event_type,i.outcome_code FROM billing_gateway.event_inbox i
      JOIN billing_gateway.accounts a ON a.id=i.account_id WHERE a.provider='abacatepay' AND a.environment='sandbox'
        AND a.external_account_id=${env.ABACATEPAY_STORE_ID} AND i.state='review' ORDER BY i.received_at,i.event_id LIMIT 50`),
  ]);
  return {
    reviews,
    quarantined: z
      .array(
        z.object({
          account_id: z.uuid(),
          event_id: z.string(),
          event_type: z.string(),
          outcome_code: z.string().nullable(),
        }),
      )
      .parse(recent)
      .filter(
        (row) =>
          !reviews.some(
            (eligible) =>
              eligible.account_id === row.account_id && eligible.event_id === row.event_id,
          ),
      ),
    renewals: z
      .array(
        z.object({
          subscription_id: z.uuid(),
          clinic_id: z.uuid(),
          created_at: z.coerce.date(),
          period_end: z.coerce.date(),
        }),
      )
      .parse(renewals),
    backlog: z
      .array(
        z.object({
          reviews: z.number().int(),
          queued: z.number().int(),
          oldest: z.coerce.date().nullable(),
        }),
      )
      .length(1)
      .parse(backlog)[0]!,
  };
}
