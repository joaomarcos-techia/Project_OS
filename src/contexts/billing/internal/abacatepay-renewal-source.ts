import 'server-only';

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { opaqueBillingId } from '@/lib/payments/saas/contracts';
import type { RecurringPaymentEvidence } from '@/lib/payments/saas/recurring-payment';
import type { BillingAccount } from '@/lib/payments/saas/contracts';
import type { BillingGatewaySql } from '@/lib/payments/saas/postgres-store';

/** API readbacks are independent provenance, never synthetic webhook events. */
export type AbacatePayRenewalSource =
  | { kind: 'webhook'; id: string }
  | { kind: 'provider_api'; id: string };

export function parseAbacatePayRenewalSource(
  input: string | AbacatePayRenewalSource,
): AbacatePayRenewalSource | null {
  const parsed = z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('webhook'), id: opaqueBillingId }).strict(),
      z.object({ kind: z.literal('provider_api'), id: z.uuid() }).strict(),
    ])
    .safeParse(typeof input === 'string' ? { kind: 'webhook', id: input } : input);
  return parsed.success ? parsed.data : null;
}

/** The projection carries origin identity, without inventing an event type or ID. */
export function abacatePayRenewalSourceRows(source: AbacatePayRenewalSource) {
  return source.kind === 'webhook'
    ? sql`(SELECT account_id,subscription_id,clinic_id,external_subscription_id,
        external_customer_id,external_checkout_id,external_payment_id,received_at,NULL::text proof_hash
        FROM billing_gateway.event_inbox
        WHERE event_id=${source.id} AND event_type='subscription.renewed')`
    : sql`(SELECT account_id,subscription_id,clinic_id,external_subscription_id,
        external_customer_id,checkout_id external_checkout_id,payment_id external_payment_id,
        observed_at received_at,proof_hash FROM billing_gateway.renewal_api_readbacks WHERE id=${source.id}::uuid)`;
}

/** Resolve the immutable generation before tenant-specific lateral snapshots.
 * Both branches use existing (account_id,external_subscription_id) indexes.
 * UNION deduplicates a generation without broadening ownership or locking peers.
 * The enclosing query must provide the authenticated source `e` and account `a`.
 */
export function abacatePayRenewalBindingRows() {
  return sql`LATERAL (
    SELECT origin.subscription_id,origin.clinic_id FROM billing_gateway.bindings origin
      WHERE origin.account_id=a.id AND origin.external_subscription_id=e.external_subscription_id
    UNION
    SELECT replacement.subscription_id,replacement.clinic_id FROM billing_gateway.recontracts replacement
      WHERE replacement.account_id=a.id AND replacement.external_subscription_id=e.external_subscription_id
        AND replacement.invoice_id IS NOT NULL
  )`;
}

/** Lock before reading joined plan snapshots: a waiting SELECT can retain an old join. */
export async function lockAbacatePayRenewalSubscription(
  database: BillingGatewaySql,
  account: BillingAccount,
  source: AbacatePayRenewalSource,
): Promise<void> {
  await database.execute(sql`
    SELECT s.id FROM ${abacatePayRenewalSourceRows(source)} e
      JOIN billing_gateway.accounts a ON a.id=e.account_id
      JOIN ${abacatePayRenewalBindingRows()} bound ON true
      JOIN billing_gateway.bindings b ON b.account_id=a.id AND b.subscription_id=bound.subscription_id AND b.clinic_id=bound.clinic_id
      JOIN public.subscriptions s ON s.id=b.subscription_id AND s.clinic_id=b.clinic_id
      WHERE true
        AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL
        AND a.provider='abacatepay' AND a.environment='sandbox'
        AND a.external_account_id=${account.accountId}
        AND (e.subscription_id IS NULL OR e.subscription_id=s.id)
        AND (e.clinic_id IS NULL OR e.clinic_id=s.clinic_id)
    FOR UPDATE OF s`);
}

export function abacatePayRenewalProofHash(
  e: Omit<RecurringPaymentEvidence, 'providerPeriodStart' | 'providerPeriodEnd'> & {
    providerPeriodStart?: string | undefined;
    providerPeriodEnd?: string | undefined;
  },
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        e.account.provider,
        e.account.environment,
        e.account.accountId,
        e.subscriptionId,
        e.customerId,
        e.originCheckoutId,
        e.checkoutId,
        e.productId,
        e.paymentId,
        e.statementId,
        e.amountMinor,
        e.paidAmountMinor,
        e.currency,
        new Date(e.chargeCreatedAt).toISOString(),
        new Date(e.confirmedAt).toISOString(),
        e.method,
        e.recurrence,
        e.obligation,
        e.settlement,
        e.providerPeriodStart ?? null,
        e.providerPeriodEnd ?? null,
      ]),
    )
    .digest('hex');
}
