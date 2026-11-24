import {
  abacatePayEnvironment,
  abacatePayPlanProducts,
  abacatePayProbeProductId,
} from '@/lib/payments/saas/acquisition';
import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { dbAdmin } from '@/lib/db';
import { env } from '@/lib/env';
import { buildApplicationUrl, resolvePreviewCallbackOrigin } from '@/lib/http/application-url';
import {
  assertAbacatePayRuntime,
  abacatePayCheckoutAllowed,
  isAbacatePayRuntime,
} from '@/lib/payments/saas/acquisition';
import { createPostgresGatewayOperationJournal } from '@/lib/payments/saas/postgres-store';
import { createAbacatePayCommands } from '@/lib/payments/abacatepay/sandbox-commands';
import { createAbacatePayReadClient } from '@/lib/payments/abacatepay/reader';
import { CommandOperationError } from '@/lib/payments/saas/command-operation';
import { GatewayReadError } from '@/lib/payments/saas/contracts';
import type { RecoveredCheckout } from '@/lib/payments/abacatepay/checkout-recovery';

import { OFFER_2026_PLAN_CODES } from '../proposed-offer';
import { toCents } from './money';
import { reconcileMissingAbacatePayInitialPayment } from './abacatepay-processing';
import { recoverAbacatePayCheckout } from './abacatepay-checkout-recovery';
import { readInitialReplacementCheckout } from './abacatepay-initial-checkout-replacement';
import {
  getAbacatePayPlanChangeOverview,
  getAbacatePayRecontractOptions,
  requestAbacatePayPlanChange,
} from './abacatepay-plan-changes';
import {
  abacatePayManagementReady,
  getAbacatePayManagementContext,
  createAbacatePayRecontractCheckout,
  AbacatePayManagementError,
  requestAbacatePayCancellation,
} from './abacatepay-management';

export async function requestDeferredSubscriptionCancellation(input: {
  clinicId: string;
  requestedBy: string;
  contractId: string;
}) {
  return requestAbacatePayCancellation(dbAdmin, input);
}
export async function requestDeferredSubscriptionPlanChange(input: {
  clinicId: string;
  requestedBy: string;
  contractId: string;
  targetPlanId: string;
}) {
  return requestAbacatePayPlanChange(dbAdmin, input);
}

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
  environment: z.enum(['sandbox', 'production']),
  external_subscription_id: z.string().nullable(),
  price_id: z.uuid(),
  plan_code: z.string(),
  amount: z.string(),
  currency: z.literal('BRL'),
  billing_cycle: z.literal('monthly'),
  billing_status: z.enum(['trial', 'active', 'past_due', 'cancelled']),
  cancel_at_period_end: z.boolean(),
  released_at: z.coerce.date().nullable(),
});

export class DeferredCheckoutError extends Error {
  constructor(
    readonly code:
      | 'unavailable'
      | 'not_eligible'
      | 'already_paid'
      | 'cancelled'
      | 'reconcile_required',
  ) {
    super(`Deferred checkout: ${code}`);
    this.name = 'DeferredCheckoutError';
  }
}

export async function createDeferredSubscriptionCheckout(input: {
  clinicId: string;
  targetPlanId?: string;
}) {
  assertAbacatePayRuntime();
  if (!env.ABACATEPAY_API_KEY || !env.ABACATEPAY_STORE_ID || !abacatePayProbeProductId()) {
    throw new DeferredCheckoutError('unavailable');
  }
  const clinicId = z.uuid().parse(input.clinicId);
  if (!abacatePayCheckoutAllowed(clinicId)) throw new DeferredCheckoutError('unavailable');
  const callbackOrigin = resolvePreviewCallbackOrigin() ?? env.APP_BASE_URL;
  if (!callbackOrigin) throw new DeferredCheckoutError('unavailable');
  const callbackUrl = buildApplicationUrl(callbackOrigin, '/configuracoes/assinatura');
  let productMap: z.infer<typeof productMapSchema>;
  try {
    productMap = productMapSchema.parse(JSON.parse(abacatePayPlanProducts() ?? '{}'));
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
      s.billing_status,s.cancel_at_period_end,ta.released_at
    FROM public.subscriptions s JOIN public.plans p ON p.id=s.plan_id
    JOIN public.prices pr ON pr.id=s.price_id
    JOIN billing_gateway.bindings b ON b.subscription_id=s.id AND b.clinic_id=s.clinic_id
    JOIN billing_gateway.accounts a ON a.id=b.account_id
    JOIN public.trial_access_policies ta ON ta.subscription_id=s.id AND ta.clinic_id=s.clinic_id
    WHERE s.clinic_id=${clinicId}::uuid AND s.asaas_subscription_id IS NULL
      AND a.provider='abacatepay' AND a.environment=${abacatePayEnvironment()}
  `),
    );
  const contract = rows[0];
  if (!contract || contract.external_account_id !== env.ABACATEPAY_STORE_ID)
    throw new DeferredCheckoutError('not_eligible');
  if (contract.cancel_at_period_end) {
    const selected = z.enum(OFFER_2026_PLAN_CODES).safeParse(contract.plan_code);
    try {
      return await createAbacatePayRecontractCheckout(dbAdmin, {
        clinicId,
        productId: selected.success ? productMap[selected.data] : undefined,
        ...(input.targetPlanId ? { targetPlanId: input.targetPlanId } : {}),
        callbackUrl,
      });
    } catch (error) {
      if (error instanceof AbacatePayManagementError)
        throw new DeferredCheckoutError(
          error.code === 'period_active' ? 'already_paid' : error.code,
        );
      throw error;
    }
  }
  if (input.targetPlanId) throw new DeferredCheckoutError('not_eligible');
  if (contract.billing_status === 'cancelled') throw new DeferredCheckoutError('cancelled');
  if (
    contract.released_at ||
    contract.external_subscription_id ||
    contract.billing_status !== 'trial'
  ) {
    throw new DeferredCheckoutError('already_paid');
  }
  // The owner may convert during evaluation; this creates a checkout, never access.
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
    environment: abacatePayEnvironment(),
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
  const commands = createAbacatePayCommands(
    {
      environment: abacatePayEnvironment(),
      apiKey: env.ABACATEPAY_API_KEY,
      storeId: contract.external_account_id,
      probeProductId: abacatePayProbeProductId(),
    },
    journal,
  );
  let checkout: RecoveredCheckout | null;
  try {
    checkout = await readInitialReplacementCheckout(dbAdmin, {
      subscriptionId: contract.subscription_id,
      clinicId,
    });
  } catch (error) {
    if (error instanceof GatewayReadError) throw new DeferredCheckoutError('reconcile_required');
    throw error;
  }
  if (!checkout)
    try {
      checkout = await commands.createSubscriptionCheckout({
        operationId: randomUUID(),
        externalId: `qoro-initial-${contract.subscription_id}`,
        productId,
        expectedAmountMinor: amountMinor,
        expectedCycle: 'MONTHLY',
        expectedNativeTrialDays: null,
        methods: ['CARD', 'PIX'],
        returnUrl: callbackUrl,
        completionUrl: callbackUrl,
      });
    } catch (error) {
      if (!(error instanceof CommandOperationError) || error.code === 'invalid_input') throw error;
      const recovered = await recoverAbacatePayCheckout(dbAdmin, {
        subscriptionId: contract.subscription_id,
        clinicId,
      });
      if (recovered.state !== 'recovered') throw new DeferredCheckoutError('reconcile_required');
      checkout = recovered.result;
    }
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
    environment: abacatePayEnvironment(),
    timeoutMs: 2000,
  });
  if ((await read.readStore()).id !== contract.external_account_id)
    throw new DeferredCheckoutError('reconcile_required');
  const current = await read.readSubscriptionCheckoutFinancials(checkout.checkoutId);
  if (current.status === 'PAID') {
    const recovered = await reconcileMissingAbacatePayInitialPayment({
      subscriptionId: contract.subscription_id,
    });
    if (recovered.applied || recovered.duplicate) throw new DeferredCheckoutError('already_paid');
  }
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
  activation_pending: z.boolean(),
});
export async function getDeferredSubscriptionOverview(clinicId: string) {
  if (!env.ABACATEPAY_STORE_ID) return null;
  z.uuid().parse(clinicId);
  // N/N-1 compatibility: deployments with the additive schema absent are still
  // entirely Asaas. Do not change those callers or silently create a binding.
  const [schema] = z
    .array(z.object({ ready: z.boolean() }))
    .parse(
      await dbAdmin.execute(sql`SELECT to_regclass('billing_gateway.bindings') IS NOT NULL ready`),
    );
  if (!schema?.ready) return null;
  // Select management by the persisted obligation, before checking the new
  // provider's environment. A disarmed AbacatePay must not break legacy Asaas.
  const [origin] = z
    .array(z.object({ provider: z.enum(['asaas', 'abacatepay']) }))
    .max(1)
    .parse(
      await dbAdmin.execute(sql`SELECT billing_provider provider FROM public.subscriptions
        WHERE clinic_id=${clinicId}::uuid`),
    );
  if (!origin || origin.provider === 'asaas') return null;
  // The legacy overview also checks persisted origin and shows the existing
  // unavailable state for AbacatePay; it never sends this contract to Asaas.
  if (!isAbacatePayRuntime()) return null;
  const [overview] = z
    .array(overviewSchema)
    .max(1)
    .parse(
      await dbAdmin.execute(sql`
    SELECT p.name plan_name,pr.amount::text,s.trial_ends_at,
      (s.trial_ends_at > now()) trial_active,ta.released_at,s.billing_status,
      coalesce(s.current_period_end > now(),false) paid_period_active,
      (ta.released_at IS NULL AND EXISTS(SELECT 1 FROM billing_gateway.event_inbox e
        WHERE e.account_id=a.id AND e.external_checkout_id=b.external_checkout_id
          AND e.event_type='subscription.completed' AND e.state IN ('received','processing','review'))) activation_pending
    FROM public.subscriptions s JOIN public.plans p ON p.id=s.plan_id
    JOIN public.prices pr ON pr.id=s.price_id
    JOIN billing_gateway.bindings b ON b.subscription_id=s.id AND b.clinic_id=s.clinic_id
    JOIN billing_gateway.accounts a ON a.id=b.account_id
    JOIN public.trial_access_policies ta ON ta.subscription_id=s.id AND ta.clinic_id=s.clinic_id
    WHERE s.clinic_id=${clinicId}::uuid AND a.provider='abacatepay'
      AND a.environment=${abacatePayEnvironment()} AND a.external_account_id=${env.ABACATEPAY_STORE_ID}
      AND s.billing_provider='abacatepay'
  `),
    );
  const managementAvailable =
    Boolean(overview?.released_at) && (await abacatePayManagementReady(dbAdmin));
  const management = managementAvailable
    ? await getAbacatePayManagementContext(dbAdmin, clinicId)
    : null;
  const canRecontract =
    management?.cancellation_confirmed === true &&
    management.cancel_at_period_end &&
    management.period_ended;
  const recontract = canRecontract
    ? await getAbacatePayRecontractOptions(dbAdmin, clinicId)
    : { options: [], pendingPlanId: null };
  return overview
    ? {
        planName: overview.plan_name,
        amountMinor: toCents(overview.amount),
        trialEndsAt: overview.trial_ends_at.toISOString(),
        trialActive: overview.trial_active,
        paid: overview.released_at !== null,
        billingStatus: overview.billing_status,
        paidPeriodActive: overview.paid_period_active,
        activationPending: overview.activation_pending,
        checkoutAvailable: abacatePayCheckoutAllowed(clinicId),
        planChanges: managementAvailable
          ? await getAbacatePayPlanChangeOverview(dbAdmin, clinicId)
          : null,
        recontractOptions: recontract.options,
        recontractPendingPlanId: recontract.pendingPlanId,
        managementAvailable,
        contractId: management?.generation_id ?? null,
        accessUntil: management?.period_end.toISOString() ?? null,
        cancellationState: management?.cancellation_confirmed
          ? ('confirmed' as const)
          : management?.cancellation_requested
            ? ('requested' as const)
            : ('none' as const),
        canRecontract,
      }
    : null;
}
