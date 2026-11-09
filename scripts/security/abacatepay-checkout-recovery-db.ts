/** Real migration/application transactions; only loopback PostgreSQL and synthetic API fixtures. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

import { readMigrations, startScratchSchema } from './scratch-schema';

const cluster = await startScratchSchema({ port: 55493 });
assert.equal(new URL(cluster.url).hostname, '127.0.0.1');
const sql = cluster.sql;
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: cluster.url,
  DATABASE_URL_DEV: cluster.url,
  DATABASE_URL_RUNTIME: cluster.url,
  SUPABASE_PROJECT_ENV: 'dev',
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic',
  SAAS_SIGNUP_PROVIDER: 'abacatepay_sandbox',
  SIGNUP_AUTH_ENABLED: 'true',
  SIGNUP_IDENTITY_ENABLED: 'true',
  ABACATEPAY_STORE_ID: 'store_synthetic',
  ABACATEPAY_API_KEY: 'synthetic-loopback-only',
  ABACATEPAY_SANDBOX_PROBE_PRODUCT_ID: 'prod_probe',
  ABACATEPAY_SANDBOX_PLAN_PRODUCTS: '{"clinica_2026_2":"prod_synthetic"}',
  APP_BASE_URL: 'https://qoro.example',
  LOGIN_HASH_PEPPER: 'synthetic-loopback-checkout-hash-pepper',
  CRYPTO_SECRET_BACKEND: 'env',
  CRYPTO_MASTER_KEY_V1: Buffer.alloc(32, 7).toString('base64'),
  CRYPTO_LOOKUP_SALT: Buffer.alloc(32, 9).toString('base64'),
  LOG_LEVEL: 'error',
});
delete process.env.VERCEL_ENV;
delete process.env.DATABASE_URL_PROD;
const originalFetch = globalThis.fetch;
let networkCalls = 0,
  fixtureCalls = 0,
  posts = 0,
  responseLost = false,
  beforeSendFailure = false,
  unavailable = false;
type Checkout = {
  id: string;
  externalId: string;
  url: string;
  frequency: string;
  devMode: boolean;
  amount: number;
  paidAmount: number | null;
  status: string;
  customerId: string | null;
  items: { id: string; quantity: number }[];
  methods: string[];
  returnUrl: string;
  completionUrl: string;
  createdAt: string;
};
const remote = new Map<string, Checkout[]>();
globalThis.fetch = async (raw, init) => {
  const url = new URL(String(raw));
  if (url.origin !== 'https://api.abacatepay.com') {
    networkCalls++;
    throw new Error('External network forbidden');
  }
  fixtureCalls++;
  if (unavailable) return Response.json({}, { status: 503 });
  let data: unknown;
  if (url.pathname.endsWith('/stores/get')) data = { id: 'store_synthetic' };
  else if (url.pathname.endsWith('/products/get'))
    data = {
      id: url.searchParams.get('id'),
      externalId: 'synthetic-product',
      price: 39700,
      currency: 'BRL',
      cycle: 'MONTHLY',
      trialDays: null,
      devMode: true,
    };
  else if (url.pathname.endsWith('/subscriptions/create')) {
    assert.equal(init?.method, 'POST');
    posts++;
    if (beforeSendFailure) throw new Error('Synthetic failure before processing');
    const body = JSON.parse(String(init.body));
    assert.equal(typeof body.externalId, 'string');
    const item: Checkout = {
      id: `bill_${randomUUID().replaceAll('-', '')}`,
      externalId: body.externalId,
      url: 'https://app.abacatepay.com/pay/synthetic',
      frequency: 'SUBSCRIPTION',
      devMode: true,
      amount: 39700,
      paidAmount: null,
      status: 'PENDING',
      customerId: null,
      items: body.items,
      methods: body.methods,
      returnUrl: body.returnUrl,
      completionUrl: body.completionUrl,
      createdAt: new Date().toISOString(),
    };
    assert.equal(
      remote.has(item.externalId),
      false,
      'Attempted a second provider creation for the same obligation',
    );
    remote.set(item.externalId, [item]);
    if (responseLost) throw new Error('Synthetic response lost after provider effect');
    data = { id: item.id };
  } else if (url.pathname.endsWith('/checkouts/list')) {
    data = remote.get(url.searchParams.get('externalId') ?? '') ?? [];
    return Response.json({ success: true, data, pagination: { hasMore: false, next: null } });
  } else if (url.pathname.endsWith('/checkouts/get')) {
    data = [...remote.values()].flat().find((item) => item.id === url.searchParams.get('id'));
    assert.ok(data);
  } else if (url.pathname.endsWith('/subscriptions/list')) {
    const item = [...remote.values()]
      .flat()
      .find((c) => c.id === url.searchParams.get('checkoutId'));
    data =
      item?.status === 'PAID'
        ? [
            {
              id: `subs_${item.id.slice(5)}`,
              checkoutId: item.id,
              customerId: 'cust_synthetic',
              amount: 39700,
              currency: 'BRL',
              method: 'CARD',
              status: 'ACTIVE',
              devMode: true,
              trialEndsAt: null,
              createdAt: item.createdAt,
            },
          ]
        : [];
    return Response.json({ success: true, data, pagination: { hasMore: false, next: null } });
  } else if (url.pathname.endsWith('/subscriptions/get')) {
    const item = [...remote.values()]
      .flat()
      .find((c) => `subs_${c.id.slice(5)}` === url.searchParams.get('id'));
    assert.ok(item);
    data = {
      id: url.searchParams.get('id'),
      checkoutId: item.id,
      customerId: 'cust_synthetic',
      amount: 39700,
      currency: 'BRL',
      method: 'CARD',
      status: 'ACTIVE',
      devMode: true,
      trialEndsAt: null,
      createdAt: item.createdAt,
    };
  } else throw new Error('Unexpected provider route');
  return Response.json({ success: true, data });
};
const { dbAdmin } = await import('../../src/lib/db');
const { hashEmail } = await import('../../src/lib/auth/email-hash');
const { provisionFreeSignupTrialTx: provision } =
  await import('../../src/contexts/onboarding/internal/signup-free-trial');
const { createDeferredSubscriptionCheckout: create } =
  await import('../../src/contexts/billing/internal/deferred-checkout');
const { recoverAbacatePayCheckout: recover, reconcileAbacatePayUnknownCheckout: scan } =
  await import('../../src/contexts/billing/internal/abacatepay-checkout-recovery');
const { reconcileMissingAbacatePayInitialPayment: applyPayment } =
  await import('../../src/contexts/billing/internal/abacatepay-processing');
const { createPostgresGatewayOperationJournal } =
  await import('../../src/lib/payments/saas/postgres-store');
const { createAbacatePaySandboxCommands } =
  await import('../../src/lib/payments/abacatepay/sandbox-commands');
const { sql: drizzleSql } = await import('drizzle-orm');
const results: { name: string; status: 'PASS' | 'FAIL' }[] = [];
async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    results.push({ name, status: 'PASS' });
  } catch (error) {
    results.push({ name, status: 'FAIL' });
    throw error;
  }
}
async function seed() {
  const userId = randomUUID(),
    email = `${userId}@example.invalid`,
    authCreatedAt = new Date(Date.now() - 16 * 86400000);
  await sql`INSERT INTO auth.users(id,email,email_confirmed_at,created_at)VALUES(${userId}::uuid,${email},now(),${authCreatedAt})`;
  const [plan] = await sql<
    { id: string }[]
  >`SELECT id::text FROM public.plans WHERE code='clinica_2026_2'`;
  assert.ok(plan);
  await sql`INSERT INTO public.signup_sessions(token_hash,status,idle_expires_at,absolute_expires_at,consumed_at,auth_user_id,
 owner_name,clinic_name,email_hash,accepted_at,answered_at,professionals_band,weekly_appointments_band,current_tooling,discovery_source,selected_plan_id)
 VALUES(${createHash('sha256').update(userId).digest('hex')},'email_verified',now()+interval '40 minutes',now()+interval '50 minutes',now(),${userId}::uuid,
 'Synthetic owner','Synthetic unknown checkout',${hashEmail(email)},now(),now(),'2_5','21_50','outro_sistema','indicacao_colega',${plan.id}::uuid)`;
  const trial = await dbAdmin.transaction((tx) =>
    provision(tx, { userId, email, authCreatedAt, storeId: 'store_synthetic' }),
  );
  assert.ok(trial.ok);
  const [row] = await sql<
    { subscriptionId: string; priceId: string; accountId: string }[]
  >`SELECT s.id::text "subscriptionId",s.price_id::text "priceId",b.account_id::text "accountId"
 FROM public.subscriptions s JOIN billing_gateway.bindings b ON b.subscription_id=s.id WHERE s.clinic_id=${trial.clinicId}::uuid`;
  assert.ok(row);
  return { ...row, clinicId: trial.clinicId, reference: `qoro-initial-${row.subscriptionId}` };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
async function state(f: Fixture) {
  const [row] = await sql`SELECT s.billing_status,b.external_checkout_id,
 (SELECT count(*)::int FROM public.invoices WHERE clinic_id=s.clinic_id) invoices,
 (SELECT count(*)::int FROM billing_gateway.operations WHERE subscription_id=s.id) operations,
 (SELECT state FROM billing_gateway.operations WHERE subscription_id=s.id AND kind='create_checkout') operation_state,
 (SELECT released_at IS NOT NULL FROM public.trial_access_policies WHERE clinic_id=s.clinic_id) released,
 (SELECT count(*)::int FROM public.billing_events WHERE clinic_id=s.clinic_id AND type='subscription.checkout.result_recovered') recoveries
 FROM public.subscriptions s JOIN billing_gateway.bindings b ON b.subscription_id=s.id WHERE s.id=${f.subscriptionId}::uuid`;
  assert.ok(row);
  return row;
}
async function reserveWithLostAcknowledgement(f: Fixture) {
  await sql`INSERT INTO billing_gateway.checkout_intents(subscription_id,clinic_id,account_id,price_id,product_id,amount_minor)
 VALUES(${f.subscriptionId}::uuid,${f.clinicId}::uuid,${f.accountId}::uuid,${f.priceId}::uuid,'prod_synthetic',39700)`;
  const journal = createPostgresGatewayOperationJournal(
    { provider: 'abacatepay', environment: 'sandbox', accountId: 'store_synthetic' },
    {
      subscriptionId: f.subscriptionId,
      clinicId: f.clinicId,
      kind: 'create_checkout',
      businessKey: `initial:${f.priceId}`,
    },
    dbAdmin,
  );
  const commands = createAbacatePaySandboxCommands(
    { apiKey: 'synthetic-loopback-only', storeId: 'store_synthetic', probeProductId: 'prod_probe' },
    {
      ...journal,
      async confirm() {
        throw new Error('Synthetic acknowledgement failure');
      },
    },
  );
  await assert.rejects(
    commands.createSubscriptionCheckout({
      operationId: randomUUID(),
      externalId: f.reference,
      productId: 'prod_synthetic',
      expectedAmountMinor: 39700,
      expectedCycle: 'MONTHLY',
      expectedNativeTrialDays: null,
      returnUrl: 'https://qoro.example/configuracoes/assinatura',
      completionUrl: 'https://qoro.example/configuracoes/assinatura',
    }),
  );
}
let failure: unknown;
try {
  await sql`UPDATE public.plans SET ativo=true WHERE code IN ('clinica_2026_2','consultorio_2026')`;
  await check(
    'H3 timeout before remote processing is retained across retries without another POST',
    async () => {
      const f = await seed(),
        before = posts;
      beforeSendFailure = true;
      await assert.rejects(create({ clinicId: f.clinicId }));
      beforeSendFailure = false;
      await assert.rejects(create({ clinicId: f.clinicId }));
      assert.equal(posts - before, 1);
      assert.deepEqual(await state(f), {
        billing_status: 'trial',
        external_checkout_id: null,
        invoices: 0,
        operations: 1,
        operation_state: 'unknown',
        released: false,
        recoveries: 0,
      });
    },
  );
  await check(
    'H3 response lost after provider processing recovers the original checkout without a second creation',
    async () => {
      const f = await seed(),
        before = posts;
      responseLost = true;
      const result = await create({ clinicId: f.clinicId });
      responseLost = false;
      assert.equal(result.state, 'checkout_pending');
      await create({ clinicId: f.clinicId });
      assert.equal(posts - before, 1);
      const after = await state(f);
      assert.equal(after.operation_state, 'confirmed');
      assert.equal(after.invoices, 0);
      assert.equal(after.released, false);
      assert.equal(after.recoveries, 1);
    },
  );
  await check(
    'H3 durable running reservation with lost journal acknowledgement is recoverable by GET',
    async () => {
      const f = await seed(),
        before = posts;
      await reserveWithLostAcknowledgement(f);
      assert.equal((await state(f)).operation_state, 'running');
      assert.equal((await recover(dbAdmin, f)).state, 'recovered');
      assert.equal((await state(f)).operation_state, 'confirmed');
      assert.equal(posts - before, 1);
    },
  );
  await check(
    'H3 concurrent read-only recovery confirms one original operation and one recovery audit',
    async () => {
      const f = await seed(),
        before = posts;
      await reserveWithLostAcknowledgement(f);
      const recovered = await Promise.all(Array.from({ length: 12 }, () => recover(dbAdmin, f)));
      assert.ok(recovered.every((r) => r.state === 'recovered'));
      const after = await state(f);
      assert.equal(after.operations, 1);
      assert.equal(after.recoveries, 1);
      assert.equal(after.invoices, 0);
      assert.equal(posts - before, 1);
    },
  );
  await check(
    'H3 database failure rolls back journal, attachment and audit; retry does not repeat POST',
    async () => {
      const f = await seed(),
        before = posts;
      await reserveWithLostAcknowledgement(f);
      const snapshot = await state(f);
      await assert.rejects(
        recover(
          {
            execute: dbAdmin.execute.bind(dbAdmin),
            transaction: (callback) =>
              dbAdmin.transaction(async (tx) => {
                const result = await callback(tx);
                await tx.execute(drizzleSql`SELECT 1/0`);
                return result;
              }),
          },
          f,
        ),
      );
      assert.deepEqual(await state(f), snapshot);
      assert.equal((await recover(dbAdmin, f)).state, 'recovered');
      assert.equal(posts - before, 1);
    },
  );
  await check(
    'H3 a paid checkout is attached without granting access; separate payment readback applies one invoice',
    async () => {
      const f = await seed(),
        before = posts;
      await reserveWithLostAcknowledgement(f);
      const item = remote.get(f.reference)?.[0];
      assert.ok(item);
      item.status = 'PAID';
      item.paidAmount = 39700;
      item.customerId = 'cust_synthetic';
      assert.equal((await recover(dbAdmin, f)).state, 'recovered');
      assert.equal((await state(f)).invoices, 0);
      assert.equal((await state(f)).released, false);
      const applied = await applyPayment({ subscriptionId: f.subscriptionId });
      assert.equal(applied.applied, 1);
      const after = await state(f);
      assert.equal(after.invoices, 1);
      assert.equal(after.released, true);
      assert.equal(after.billing_status, 'active');
      await assert.rejects(create({ clinicId: f.clinicId }));
      assert.equal(posts - before, 1);
    },
  );
  await check(
    'H3 ambiguity, wrong tenant and API failure preserve the unknown obligation',
    async () => {
      const f = await seed(),
        other = await seed(),
        before = posts;
      await reserveWithLostAcknowledgement(f);
      const snapshot = await state(f);
      assert.equal(
        (await recover(dbAdmin, { subscriptionId: f.subscriptionId, clinicId: other.clinicId }))
          .state,
        'not_eligible',
      );
      unavailable = true;
      await assert.rejects(recover(dbAdmin, f));
      unavailable = false;
      const item = remote.get(f.reference)?.[0];
      assert.ok(item);
      remote.set(f.reference, [item, { ...item, id: 'bill_duplicate' }]);
      await assert.rejects(recover(dbAdmin, f));
      assert.deepEqual(await state(f), snapshot);
      assert.equal(posts - before, 1);
    },
  );
  await check(
    'H5 bounded scanner applies authoritative recovery with durable backoff and no new command',
    async () => {
      const f = await seed();
      await reserveWithLostAcknowledgement(f);
      // Older absent/ambiguous cases are checked first, then the eligible result.
      const before = posts;
      await scan(dbAdmin);
      await scan(dbAdmin);
      await scan(dbAdmin);
      const [events] =
        await sql`SELECT count(*)::int n FROM public.billing_events WHERE type='subscription.checkout.recovery_checked'`;
      assert.ok(events);
      assert.equal(events.n, 3);
      const after = await state(f);
      assert.equal(after.operation_state, 'confirmed');
      assert.ok(after.external_checkout_id);
      assert.equal(after.invoices, 0);
      const reads = fixtureCalls;
      await scan(dbAdmin);
      assert.equal(fixtureCalls, reads, 'Hourly backoff must prevent immediate repeated GETs');
      assert.equal(posts, before);
    },
  );
  assert.equal(networkCalls, 0);
} catch (error) {
  failure = error;
} finally {
  globalThis.fetch = originalFetch;
  await mkdir('dist', { recursive: true });
  await writeFile(
    'dist/abacatepay-checkout-recovery-db.json',
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        environment: 'loopback_synthetic',
        migrations: (await readMigrations()).length,
        results,
        networkCalls,
        fixtureCalls,
        syntheticPostAttempts: posts,
        productionWrites: 0,
        status: failure ? 'FAIL' : 'PASS',
      },
      null,
      2,
    ),
  );
  await cluster.stop();
}
if (failure) throw failure;
console.log(
  JSON.stringify({
    status: 'PASS',
    checks: results.length,
    networkCalls,
    fixtureCalls,
    syntheticPostAttempts: posts,
  }),
);
