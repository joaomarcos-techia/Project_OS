import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { GatewayReadError } from '@/lib/payments/saas/contracts';
import {
  createPostgresGatewayOperationJournal,
  type BillingGatewaySql,
} from '@/lib/payments/saas/postgres-store';
import { createAbacatePayCommands } from '@/lib/payments/abacatepay/sandbox-commands';
import {
  createAbacatePayReadClient,
  type AbacatePayReadConfig,
} from '@/lib/payments/abacatepay/reader';
import { createAbacatePayCheckoutRecoveryReader } from '@/lib/payments/abacatepay/checkout-recovery';
import { commandOperationFingerprint } from '@/lib/payments/saas/command-operation';

const scopeSchema = z.object({ subscriptionId: z.uuid(), clinicId: z.uuid() }).strict();
const reference = (prefix: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}[A-Za-z0-9_-]+$`))
    .max(200);
const resultSchema = z.object({
  checkoutId: reference('bill_'),
  externalId: z.string().min(1),
  amountMinor: z.number().int().positive(),
  environment: z.enum(['sandbox', 'production']),
  state: z.literal('pending'),
  checkoutUrl: z.url().refine((value) => {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      ['app.abacatepay.com', 'pay.abacatepay.com'].includes(u.hostname)
    );
  }),
});
const rowSchema = z.object({
  id: z.uuid(),
  subscription_id: z.uuid(),
  clinic_id: z.uuid(),
  account_id: z.uuid(),
  external_account_id: reference('store_'),
  environment: z.enum(['sandbox', 'production']),
  old_checkout_id: reference('bill_'),
  old_external_id: z.string().min(1),
  close_operation_id: z.uuid(),
  create_operation_id: z.uuid(),
  phase: z.enum(['prepared', 'closed', 'bound']),
  new_checkout_id: reference('bill_').nullable(),
  product_id: reference('prod_'),
  amount_minor: z.coerce.number().int().positive(),
  result: z.unknown(),
  current_checkout_id: reference('bill_'),
  eligible: z.boolean(),
});
type Replacement = z.infer<typeof rowSchema>;
type Scope = z.input<typeof scopeSchema>;
type Config = AbacatePayReadConfig & { storeId: string; probeProductId: string };

async function ready(database: BillingGatewaySql) {
  const [row] = z
    .array(z.object({ ready: z.boolean() }))
    .length(1)
    .parse(
      await database.execute(sql`
    SELECT to_regclass('billing_gateway.initial_checkout_replacements') IS NOT NULL ready`),
    );
  return row?.ready === true;
}
async function read(database: BillingGatewaySql, raw: Scope): Promise<Replacement | null> {
  const scope = scopeSchema.parse(raw);
  if (!(await ready(database))) return null;
  const [row] = z
    .array(rowSchema)
    .max(1)
    .parse(
      await database.execute(sql`
    SELECT r.id::text,r.subscription_id::text,r.clinic_id::text,r.account_id::text,
      r.old_checkout_id,origin.result->>'externalId' old_external_id,r.close_operation_id::text,r.create_operation_id::text,
      r.phase,r.new_checkout_id,a.external_account_id,a.environment,i.product_id,i.amount_minor::text,
      b.external_checkout_id current_checkout_id,created.result,
      (s.billing_status='trial' AND NOT s.cancel_at_period_end AND b.external_customer_id IS NULL
        AND b.external_subscription_id IS NULL AND b.external_checkout_id=r.old_checkout_id
        AND EXISTS(SELECT 1 FROM public.profiles WHERE id=r.requested_by AND clinic_id=r.clinic_id AND role='owner' AND ativo)
        AND EXISTS(SELECT 1 FROM public.trial_access_policies WHERE subscription_id=r.subscription_id AND clinic_id=r.clinic_id AND released_at IS NULL)
        AND s.price_id=i.price_id AND EXISTS(SELECT 1 FROM public.prices p WHERE p.id=s.price_id
          AND p.amount*100=i.amount_minor AND p.currency='BRL' AND p.billing_cycle='monthly')
        AND NOT EXISTS(SELECT 1 FROM billing_gateway.recontracts WHERE subscription_id=r.subscription_id)
        AND NOT EXISTS(SELECT 1 FROM public.invoices WHERE subscription_id=r.subscription_id)) eligible
    FROM billing_gateway.initial_checkout_replacements r
    JOIN billing_gateway.accounts a ON a.id=r.account_id AND a.provider='abacatepay'
    JOIN billing_gateway.bindings b ON b.account_id=r.account_id AND b.subscription_id=r.subscription_id AND b.clinic_id=r.clinic_id
    JOIN public.subscriptions s ON s.id=r.subscription_id AND s.clinic_id=r.clinic_id
      AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL
    JOIN billing_gateway.checkout_intents i ON i.account_id=r.account_id AND i.subscription_id=r.subscription_id AND i.clinic_id=r.clinic_id
    JOIN billing_gateway.operations origin ON origin.account_id=r.account_id AND origin.operation_id=r.old_operation_id
    LEFT JOIN billing_gateway.operations created ON created.account_id=r.account_id AND created.operation_id=r.create_operation_id
    WHERE r.subscription_id=${scope.subscriptionId}::uuid AND r.clinic_id=${scope.clinicId}::uuid`),
    );
  return row ?? null;
}

/** No route, env change or automatic migration. Explicit operator invocation only. */
export async function prepareInitialCheckoutReplacement(
  database: BillingGatewaySql,
  input: Scope & {
    oldCheckoutId: string;
    requestedBy: string;
    noPaymentInitiated: true;
  },
) {
  const parsed = scopeSchema
    .extend({
      oldCheckoutId: reference('bill_'),
      requestedBy: z.uuid(),
      noPaymentInitiated: z.literal(true),
    })
    .parse(input);
  if (!(await ready(database))) throw new GatewayReadError('unavailable');
  await database.execute(sql`
    INSERT INTO billing_gateway.initial_checkout_replacements
      (id,subscription_id,clinic_id,account_id,old_checkout_id,old_operation_id,close_operation_id,create_operation_id,requested_by,no_payment_initiated)
    SELECT ${randomUUID()}::uuid,b.subscription_id,b.clinic_id,b.account_id,b.external_checkout_id,o.operation_id,
      ${randomUUID()}::uuid,${randomUUID()}::uuid,${parsed.requestedBy}::uuid,true
    FROM billing_gateway.bindings b JOIN billing_gateway.operations o USING(account_id,subscription_id,clinic_id)
    WHERE b.subscription_id=${parsed.subscriptionId}::uuid AND b.clinic_id=${parsed.clinicId}::uuid
      AND b.external_checkout_id=${parsed.oldCheckoutId} AND o.kind='create_checkout' AND o.state='confirmed'
    ON CONFLICT(subscription_id) DO NOTHING`);
  const row = await read(database, {
    subscriptionId: parsed.subscriptionId,
    clinicId: parsed.clinicId,
  });
  if (!row || row.old_checkout_id !== parsed.oldCheckoutId)
    throw new GatewayReadError('binding_mismatch');
  return { id: row.id, phase: row.phase };
}

/** Initial checkout callers must never fall back to the old URL during replacement. */
export async function readInitialReplacementCheckout(database: BillingGatewaySql, scope: Scope) {
  const row = await read(database, scope);
  if (!row) return null;
  if (row.phase !== 'bound') throw new GatewayReadError('unavailable');
  const checkout = resultSchema.parse(row.result);
  if (
    checkout.checkoutId !== row.new_checkout_id ||
    checkout.checkoutId !== row.current_checkout_id ||
    checkout.environment !== row.environment ||
    checkout.amountMinor !== row.amount_minor ||
    checkout.externalId !== `qoro-initial-replacement-${row.id}`
  )
    throw new GatewayReadError('binding_mismatch');
  return checkout;
}

export function createInitialCheckoutReplacementOperator(
  database: BillingGatewaySql,
  config: Config,
  fetcher: typeof fetch = fetch,
) {
  const client = createAbacatePayReadClient(config, fetcher);
  async function context(scope: Scope) {
    const row = await read(database, scope);
    if (
      !row ||
      row.external_account_id !== config.storeId ||
      row.environment !== config.environment ||
      (row.phase !== 'bound' && !row.eligible)
    )
      throw new GatewayReadError('binding_mismatch');
    if ((await client.readStore()).id !== config.storeId)
      throw new GatewayReadError('binding_mismatch');
    await client.readProduct(config.probeProductId);
    return row;
  }
  const account = {
    provider: 'abacatepay',
    environment: config.environment,
    accountId: config.storeId,
  } as const;
  function journal(row: Replacement, kind: 'close_unpaid_checkout' | 'replace_checkout') {
    return createPostgresGatewayOperationJournal(
      account,
      {
        subscriptionId: row.subscription_id,
        clinicId: row.clinic_id,
        kind,
        businessKey: kind === 'close_unpaid_checkout' ? row.old_checkout_id : `replace:${row.id}`,
      },
      database,
    );
  }
  async function verifyClosed(row: Replacement) {
    const old = await client.readSubscriptionCheckoutFinancials(row.old_checkout_id);
    if (
      old.status !== 'PENDING' ||
      old.customerId !== null ||
      (old.paidAmount ?? 0) !== 0 ||
      old.amount !== row.amount_minor ||
      old.items.length !== 1 ||
      old.items[0]?.id !== row.product_id ||
      old.items[0]?.quantity !== 1 ||
      (await client.listSubscriptionsForCheckout(row.old_checkout_id)).length !== 0 ||
      (await client.listSubscriptionCheckouts()).some((item) => item.id === row.old_checkout_id)
    )
      throw new GatewayReadError('binding_mismatch');
  }
  function request(row: Replacement, callbackUrl: string) {
    return {
      operationId: row.create_operation_id,
      externalId: `qoro-initial-replacement-${row.id}`,
      productId: row.product_id,
      expectedAmountMinor: row.amount_minor,
      expectedCycle: 'MONTHLY' as const,
      expectedNativeTrialDays: null,
      methods: ['CARD', 'PIX'] satisfies ('CARD' | 'PIX')[],
      returnUrl: callbackUrl,
      completionUrl: callbackUrl,
    };
  }
  async function attach(row: Replacement, checkout: z.infer<typeof resultSchema>) {
    if (
      checkout.amountMinor !== row.amount_minor ||
      checkout.environment !== row.environment ||
      checkout.externalId !== `qoro-initial-replacement-${row.id}` ||
      checkout.checkoutId === row.old_checkout_id
    )
      throw new GatewayReadError('binding_mismatch');
    const attached = z
      .array(z.object({ id: z.uuid() }))
      .length(1)
      .parse(
        await database.execute(sql`
      UPDATE billing_gateway.initial_checkout_replacements SET phase='bound',new_checkout_id=${checkout.checkoutId},bound_at=now()
      WHERE id=${row.id}::uuid AND phase='closed' RETURNING id::text`),
      );
    if (!attached[0]) throw new GatewayReadError('unavailable');
    return checkout;
  }
  return {
    async recoverClose(scope: Scope) {
      const row = await context(scope);
      await verifyClosed(row);
      if (row.phase !== 'prepared') return { phase: row.phase };
      const parameters = {
        operationId: undefined,
        checkoutId: row.old_checkout_id,
        externalId: row.old_external_id,
        productId: row.product_id,
        expectedAmountMinor: row.amount_minor,
      };
      const proof = {
        checkoutId: row.old_checkout_id,
        productId: row.product_id,
        amountMinor: row.amount_minor,
        closed: true,
      };
      const recovered = z
        .array(z.object({ operation_id: z.uuid() }))
        .length(1)
        .parse(
          await database.execute(sql`
        UPDATE billing_gateway.operations SET state='confirmed',result=${JSON.stringify(proof)}::jsonb
        WHERE account_id=${row.account_id}::uuid AND operation_id=${row.close_operation_id}::uuid
          AND subscription_id=${row.subscription_id}::uuid AND clinic_id=${row.clinic_id}::uuid
          AND kind='close_unpaid_checkout' AND business_key=${row.old_checkout_id}
          AND request_hash=${commandOperationFingerprint('close_unpaid_checkout', parameters)}
          AND state IN ('running','unknown') RETURNING operation_id::text`),
        );
      if (!recovered[0]) throw new GatewayReadError('unavailable');
      await database.execute(sql`UPDATE billing_gateway.initial_checkout_replacements SET phase='closed',closed_at=now()
        WHERE id=${row.id}::uuid AND phase='prepared'`);
      return { phase: 'closed' as const };
    },
    async close(scope: Scope) {
      const row = await context(scope);
      if (row.phase !== 'prepared') {
        await verifyClosed(row);
        return { phase: row.phase };
      }
      await createAbacatePayCommands(
        config,
        journal(row, 'close_unpaid_checkout'),
        fetcher,
      ).closeUnpaidCheckout({
        operationId: row.close_operation_id,
        checkoutId: row.old_checkout_id,
        externalId: row.old_external_id,
        productId: row.product_id,
        expectedAmountMinor: row.amount_minor,
      });
      await verifyClosed(row);
      await database.execute(sql`UPDATE billing_gateway.initial_checkout_replacements SET phase='closed',closed_at=now()
        WHERE id=${row.id}::uuid AND phase='prepared'`);
      return { phase: 'closed' as const };
    },
    async issue(scope: Scope, callbackUrl: string) {
      const row = await context(scope);
      await verifyClosed(row);
      if (row.phase === 'bound') return readInitialReplacementCheckout(database, scope);
      if (row.phase !== 'closed') throw new GatewayReadError('unavailable');
      const checkout = await createAbacatePayCommands(
        config,
        journal(row, 'replace_checkout'),
        fetcher,
      ).createSubscriptionCheckout(request(row, callbackUrl));
      await verifyClosed(row);
      return attach(row, checkout);
    },
    /** GET-only recovery; absent or ambiguous results never authorize another POST. */
    async recover(scope: Scope, callbackUrl: string) {
      const row = await context(scope);
      await verifyClosed(row);
      if (row.phase === 'bound') return readInitialReplacementCheckout(database, scope);
      if (row.phase !== 'closed') throw new GatewayReadError('unavailable');
      const [op] = z
        .array(z.object({ request_hash: z.string(), created_at: z.coerce.date() }))
        .length(1)
        .parse(
          await database.execute(sql`
        SELECT request_hash,created_at FROM billing_gateway.operations WHERE account_id=${row.account_id}::uuid
          AND operation_id=${row.create_operation_id}::uuid AND kind='replace_checkout'
          AND subscription_id=${row.subscription_id}::uuid AND clinic_id=${row.clinic_id}::uuid`),
        );
      const parameters = { ...request(row, callbackUrl), operationId: undefined };
      if (
        !op ||
        op.request_hash !== commandOperationFingerprint('create_subscription_checkout', parameters)
      )
        throw new GatewayReadError('binding_mismatch');
      const found = await createAbacatePayCheckoutRecoveryReader(account, config, fetcher).discover(
        {
          externalId: parameters.externalId,
          productId: row.product_id,
          expectedAmountMinor: row.amount_minor,
          requestFingerprint: op.request_hash,
          reservedAt: op.created_at.toISOString(),
        },
      );
      if (found.state !== 'found' || !['PENDING', 'PAID'].includes(found.currentStatus))
        throw new GatewayReadError('unavailable');
      await database.execute(sql`UPDATE billing_gateway.operations SET state='confirmed',result=${JSON.stringify(found.result)}::jsonb
        WHERE account_id=${row.account_id}::uuid AND operation_id=${row.create_operation_id}::uuid AND state IN ('running','unknown')`);
      await verifyClosed(row);
      return attach(row, found.result);
    },
  };
}
