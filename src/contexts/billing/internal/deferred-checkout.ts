import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { dbAdmin } from '@/lib/db';
import { env } from '@/lib/env';
import { buildApplicationUrl, resolvePreviewCallbackOrigin } from '@/lib/http/application-url';
import { assertAbacatePaySandboxRuntime } from '@/lib/payments/saas/acquisition';
import { createPostgresGatewayOperationJournal } from '@/lib/payments/saas/postgres-store';
import { createAbacatePaySandboxCommands } from '@/lib/payments/abacatepay/sandbox-commands';
import { createAbacatePayReadClient } from '@/lib/payments/abacatepay/reader';

import { OFFER_2026_PLAN_CODES } from '../proposed-offer';
import { toCents } from './money';

const productMapSchema = z.partialRecord(
  z.enum(OFFER_2026_PLAN_CODES),
  z.string().regex(/^prod_[A-Za-z0-9_-]+$/),
);
const contractSchema = z.object({
  subscription_id: z.uuid(),
  clinic_id: z.uuid(),
  account_id: z.uuid(),
  external_account_id: z.string().regex(/^store_[A-Za-z0-9_-]+$/),
  provider: z.literal('abacatepay'),
  environment: z.literal('sandbox'),
  external_subscription_id: z.string().nullable(),
  price_id: z.uuid(),
  plan_code: z.string(),
  amount: z.string(),
  currency: z.literal('BRL'),
  billing_cycle: z.literal('monthly'),
  billing_status: z.enum(['trial', 'active', 'past_due', 'cancelled']),
  trial_ends_at: z.coerce.date(),
  released_at: z.coerce.date().nullable(),
  trial_active: z.boolean(),
});

export class DeferredCheckoutError extends Error {
  constructor(
    readonly code:
      | 'unavailable'
      | 'not_eligible'
      | 'trial_active'
      | 'already_paid'
      | 'cancelled'
      | 'reconcile_required',
  ) {
    super(`Deferred checkout: ${code}`);
    this.name = 'DeferredCheckoutError';
  }
}

export async function createDeferredSubscriptionCheckout(input: { clinicId: string }) {
  assertAbacatePaySandboxRuntime();
  if (
    !env.ABACATEPAY_API_KEY ||
    !env.ABACATEPAY_STORE_ID ||
    !env.ABACATEPAY_SANDBOX_PROBE_PRODUCT_ID
  ) {
    throw new DeferredCheckoutError('unavailable');
  }
  const clinicId = z.uuid().parse(input.clinicId);
  const callbackOrigin = resolvePreviewCallbackOrigin() ?? env.APP_BASE_URL;
  if (!callbackOrigin) throw new DeferredCheckoutError('unavailable');
  const callbackUrl = buildApplicationUrl(callbackOrigin, '/configuracoes/assinatura');
  let productMap: z.infer<typeof productMapSchema>;
  try {
    productMap = productMapSchema.parse(JSON.parse(env.ABACATEPAY_SANDBOX_PLAN_PRODUCTS ?? '{}'));
  } catch {
    throw new DeferredCheckoutError('unavailable');
  }
  const rows = z
    .array(contractSchema)
    .max(1)
    .parse(
      await dbAdmin.execute(sql`
    SELECT s.id::text subscription_id,s.clinic_id::text,a.id::text account_id,
      a.external_account_id,a.provider,a.environment,b.external_subscription_id,
      pr.id::text price_id,p.code plan_code,pr.amount::text,pr.currency,pr.billing_cycle,
      s.billing_status,s.trial_ends_at,ta.released_at,(s.trial_ends_at > now()) trial_active
    FROM public.subscriptions s JOIN public.plans p ON p.id=s.plan_id
    JOIN public.prices pr ON pr.id=s.price_id
    JOIN billing_gateway.bindings b ON b.subscription_id=s.id AND b.clinic_id=s.clinic_id
    JOIN billing_gateway.accounts a ON a.id=b.account_id
    JOIN public.trial_access_policies ta ON ta.subscription_id=s.id AND ta.clinic_id=s.clinic_id
    WHERE s.clinic_id=${clinicId}::uuid AND s.asaas_subscription_id IS NULL
      AND a.provider='abacatepay' AND a.environment='sandbox'
  `),
    );
  const contract = rows[0];
  if (!contract || contract.external_account_id !== env.ABACATEPAY_STORE_ID)
    throw new DeferredCheckoutError('not_eligible');
  if (contract.billing_status === 'cancelled') throw new DeferredCheckoutError('cancelled');
  if (
    contract.released_at ||
    contract.external_subscription_id ||
    contract.billing_status !== 'trial'
  ) {
    throw new DeferredCheckoutError('already_paid');
  }
  if (contract.trial_active) throw new DeferredCheckoutError('trial_active');
  const code = z.enum(OFFER_2026_PLAN_CODES).safeParse(contract.plan_code);
  const configuredProductId = code.success ? productMap[code.data] : undefined;
  if (!configuredProductId) throw new DeferredCheckoutError('unavailable');
  const amountMinor = toCents(contract.amount);
  await dbAdmin.execute(sql`INSERT INTO billing_gateway.checkout_intents
    (subscription_id,clinic_id,account_id,price_id,product_id,amount_minor)
    VALUES(${contract.subscription_id}::uuid,${clinicId}::uuid,${contract.account_id}::uuid,
      ${contract.price_id}::uuid,${configuredProductId},${amountMinor}) ON CONFLICT DO NOTHING`);
  const [intent] = z
    .array(
      z.object({
        product_id: z.string().regex(/^prod_[A-Za-z0-9_-]+$/),
        price_id: z.uuid(),
        amount_minor: z.coerce.number().int().positive(),
      }),
    )
    .length(1)
    .parse(
      await dbAdmin.execute(sql`SELECT product_id,price_id::text,amount_minor::text
      FROM billing_gateway.checkout_intents WHERE subscription_id=${contract.subscription_id}::uuid
        AND clinic_id=${clinicId}::uuid AND account_id=${contract.account_id}::uuid`),
    );
  if (!intent || intent.price_id !== contract.price_id || intent.amount_minor !== amountMinor) {
    throw new DeferredCheckoutError('reconcile_required');
  }
  const productId = intent.product_id;
  const account = {
    provider: 'abacatepay',
    environment: 'sandbox',
    accountId: contract.external_account_id,
  } as const;
  // The business key is independent of the browser's click/request identifier.
  const journal = createPostgresGatewayOperationJournal(
    account,
    {
      subscriptionId: contract.subscription_id,
      clinicId,
      kind: 'create_checkout',
      businessKey: `initial:${contract.price_id}`,
    },
    dbAdmin,
  );
  const commands = createAbacatePaySandboxCommands(
    {
      apiKey: env.ABACATEPAY_API_KEY,
      storeId: contract.external_account_id,
      probeProductId: env.ABACATEPAY_SANDBOX_PROBE_PRODUCT_ID,
    },
    journal,
  );
  const checkout = await commands.createSubscriptionCheckout({
    operationId: randomUUID(),
    externalId: `qoro-initial-${contract.subscription_id}`,
    productId,
    expectedAmountMinor: amountMinor,
    expectedCycle: 'MONTHLY',
    expectedNativeTrialDays: null,
    returnUrl: callbackUrl,
    completionUrl: callbackUrl,
  });
  const attached = z.array(z.object({ subscription_id: z.uuid() })).parse(
    await dbAdmin.transaction(async (tx) => {
      // Match the payment processor's lock order: contract, then binding.
      // A webhook can race the final checkout attachment.
      await tx.execute(sql`SELECT id FROM public.subscriptions
        WHERE id=${contract.subscription_id}::uuid AND clinic_id=${clinicId}::uuid FOR UPDATE`);
      return tx.execute(sql`
    UPDATE billing_gateway.bindings SET external_checkout_id=${checkout.checkoutId}
    WHERE subscription_id=${contract.subscription_id}::uuid AND clinic_id=${clinicId}::uuid
      AND account_id=${contract.account_id}::uuid
      AND (external_checkout_id IS NULL OR external_checkout_id=${checkout.checkoutId})
    RETURNING subscription_id::text`);
    }),
  );
  if (attached.length !== 1) throw new DeferredCheckoutError('reconcile_required');
  // A confirmed journal result caches the URL, not a permanent PENDING state.
  // Never redirect back to an already paid/reused subscription checkout while
  // the webhook or a financial review is still pending.
  const read = createAbacatePayReadClient({
    apiKey: env.ABACATEPAY_API_KEY,
    environment: 'sandbox',
    timeoutMs: 2000,
  });
  if ((await read.readStore()).id !== contract.external_account_id)
    throw new DeferredCheckoutError('reconcile_required');
  const current = await read.readSubscriptionCheckoutFinancials(checkout.checkoutId);
  if (
    current.status !== 'PENDING' ||
    current.amount !== amountMinor ||
    (current.paidAmount !== null && current.paidAmount !== 0) ||
    current.items.length !== 1 ||
    current.items[0]?.id !== productId ||
    current.items[0]?.quantity !== 1
  ) {
    throw new DeferredCheckoutError('reconcile_required');
  }
  return { state: 'checkout_pending' as const, checkoutUrl: checkout.checkoutUrl };
}

const overviewSchema = z.object({
  plan_name: z.string(),
  amount: z.string(),
  trial_ends_at: z.coerce.date(),
  trial_active: z.boolean(),
  released_at: z.coerce.date().nullable(),
  billing_status: z.enum(['trial', 'active', 'past_due', 'cancelled']),
  paid_period_active: z.boolean(),
});
export async function getDeferredSubscriptionOverview(clinicId: string) {
  if (!env.ABACATEPAY_STORE_ID) return null;
  z.uuid().parse(clinicId);
  assertAbacatePaySandboxRuntime();
  // N/N-1 compatibility: deployments with the additive schema absent are still
  // entirely Asaas. Do not change those callers or silently create a binding.
  const [schema] = z
    .array(z.object({ ready: z.boolean() }))
    .parse(
      await dbAdmin.execute(sql`SELECT to_regclass('billing_gateway.bindings') IS NOT NULL ready`),
    );
  if (!schema?.ready) return null;
  const [overview] = z
    .array(overviewSchema)
    .max(1)
    .parse(
      await dbAdmin.execute(sql`
    SELECT p.name plan_name,pr.amount::text,s.trial_ends_at,
      (s.trial_ends_at > now()) trial_active,ta.released_at,s.billing_status,
      coalesce(s.current_period_end > now(),false) paid_period_active
    FROM public.subscriptions s JOIN public.plans p ON p.id=s.plan_id
    JOIN public.prices pr ON pr.id=s.price_id
    JOIN billing_gateway.bindings b ON b.subscription_id=s.id AND b.clinic_id=s.clinic_id
    JOIN billing_gateway.accounts a ON a.id=b.account_id
    JOIN public.trial_access_policies ta ON ta.subscription_id=s.id AND ta.clinic_id=s.clinic_id
    WHERE s.clinic_id=${clinicId}::uuid AND a.provider='abacatepay'
      AND a.environment='sandbox' AND a.external_account_id=${env.ABACATEPAY_STORE_ID}
      AND s.billing_provider='abacatepay'
  `),
    );
  return overview
    ? {
        planName: overview.plan_name,
        amountMinor: toCents(overview.amount),
        trialEndsAt: overview.trial_ends_at.toISOString(),
        trialActive: overview.trial_active,
        paid: overview.released_at !== null,
        billingStatus: overview.billing_status,
        paidPeriodActive: overview.paid_period_active,
      }
    : null;
}
