/** Real migration/application transactions; only loopback PostgreSQL and synthetic API fixtures. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

import { readMigrations, startScratchSchema } from './scratch-schema';

const catalog = {
  consultorio_2026: { productId: 'prod_one', amountMinor: 19700 },
  clinica_2026_2: { productId: 'prod_synthetic', amountMinor: 39700 },
  clinica_2026_3: { productId: 'prod_three', amountMinor: 54400 },
  clinica_2026_4: { productId: 'prod_four', amountMinor: 69100 },
  clinica_2026_5: { productId: 'prod_five', amountMinor: 83800 },
} as const;
type PlanCode = keyof typeof catalog;
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
  ABACATEPAY_SANDBOX_PLAN_PRODUCTS: JSON.stringify(
    Object.fromEntries(Object.entries(catalog).map(([code, product]) => [code, product.productId])),
  ),
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
      price:
        url.searchParams.get('id') === 'prod_probe'
          ? 100
          : Object.values(catalog).find(
              (product) => product.productId === url.searchParams.get('id'),
            )?.amountMinor,
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
    const product = Object.values(catalog).find(
      (product) => product.productId === body.items?.[0]?.id,
    );
    assert.ok(product);
    assert.deepEqual(body.items, [{ id: product.productId, quantity: 1 }]);
    const item: Checkout = {
      id: `bill_${randomUUID().replaceAll('-', '')}`,
      externalId: body.externalId,
      url: 'https://app.abacatepay.com/pay/synthetic',
      frequency: 'SUBSCRIPTION',
      devMode: true,
      amount: product.amountMinor,
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
              amount: item.amount,
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
      amount: item.amount,
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
async function seed(code: PlanCode = 'clinica_2026_2') {
  const userId = randomUUID(),
    email = `${userId}@example.invalid`,
    authCreatedAt = new Date(Date.now() - 16 * 86400000);
  await sql`INSERT INTO auth.users(id,email,email_confirmed_at,created_at)VALUES(${userId}::uuid,${email},now(),${authCreatedAt})`;
  const [plan] = await sql<{ id: string }[]>`SELECT id::text FROM public.plans WHERE code=${code}`;
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
  return {
    ...row,
    ...catalog[code],
    authCreatedAt,
    clinicId: trial.clinicId,
    reference: `qoro-initial-${row.subscriptionId}`,
  };
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
 VALUES(${f.subscriptionId}::uuid,${f.clinicId}::uuid,${f.accountId}::uuid,${f.priceId}::uuid,${f.productId},${f.amountMinor})`;
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
      productId: f.productId,
      expectedAmountMinor: f.amountMinor,
      expectedCycle: 'MONTHLY',
      expectedNativeTrialDays: null,
      returnUrl: 'https://qoro.example/configuracoes/assinatura',
      completionUrl: 'https://qoro.example/configuracoes/assinatura',
    }),
  );
}
let failure: unknown;
try {
  await sql`UPDATE public.plans SET ativo=true WHERE code IN ('consultorio_2026','clinica_2026_2','clinica_2026_3','clinica_2026_4','clinica_2026_5')`;
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
  for (const code of [
    'consultorio_2026',
    'clinica_2026_2',
    'clinica_2026_3',
    'clinica_2026_4',
    'clinica_2026_5',
  ] as const) {
    await check(
      `INITIAL-${code} first checkout freezes the exact price and releases only its paid quota`,
      async () => {
        const f = await seed(code),
          before = posts;
        const [unpaid] = await sql`SELECT p.code,pr.amount::text,s.trial_ends_at,ta.released_at
        FROM public.subscriptions s JOIN public.plans p ON p.id=s.plan_id JOIN public.prices pr ON pr.id=s.price_id
        JOIN public.trial_access_policies ta ON ta.subscription_id=s.id WHERE s.id=${f.subscriptionId}::uuid`;
        assert.equal(unpaid?.code, code);
        assert.equal(Number(unpaid?.amount) * 100, f.amountMinor);
        assert.equal(unpaid?.released_at, null);
        assert.equal(unpaid?.trial_ends_at.getTime(), f.authCreatedAt.getTime() + 14 * 86_400_000);
        assert.equal((await state(f)).operations, 0);
        assert.equal((await create({ clinicId: f.clinicId })).state, 'checkout_pending');
        await Promise.all(Array.from({ length: 6 }, () => create({ clinicId: f.clinicId })));
        assert.equal(posts - before, 1);
        const item = remote.get(f.reference)?.[0];
        assert.ok(item);
        assert.equal(item.amount, f.amountMinor);
        assert.deepEqual(item.items, [{ id: f.productId, quantity: 1 }]);
        const [frozen] =
          await sql`SELECT amount_minor::int,product_id,price_id::text FROM billing_gateway.checkout_intents
        WHERE subscription_id=${f.subscriptionId}::uuid`;
        assert.deepEqual(frozen, {
          amount_minor: f.amountMinor,
          product_id: f.productId,
          price_id: f.priceId,
        });
        assert.equal((await state(f)).released, false);
        assert.equal((await state(f)).invoices, 0);
        item.status = 'PAID';
        item.paidAmount = f.amountMinor;
        item.customerId = 'cust_synthetic';
        assert.equal((await applyPayment({ subscriptionId: f.subscriptionId })).applied, 1);
        await applyPayment({ subscriptionId: f.subscriptionId });
        await assert.rejects(
          create({ clinicId: f.clinicId }),
          (error) => error instanceof Error && 'code' in error && error.code === 'already_paid',
        );
        const paid = await state(f);
        assert.equal(paid.billing_status, 'active');
        assert.equal(paid.released, true);
        assert.equal(paid.invoices, 1);
        assert.equal(paid.operations, 1);
        const [paidPlan] =
          await sql`SELECT p.code,i.total_amount::text,l.doctors,l.staff,s.trial_ends_at
        FROM public.subscriptions s JOIN public.plans p ON p.id=s.plan_id JOIN public.invoices i ON i.subscription_id=s.id
        JOIN public.plan_seat_limits l ON l.plan_id=p.id WHERE s.id=${f.subscriptionId}::uuid`;
        assert.equal(paidPlan?.code, code);
        assert.equal(Number(paidPlan?.total_amount) * 100, f.amountMinor);
        assert.equal(paidPlan?.doctors, code === 'consultorio_2026' ? 1 : Number(code.slice(-1)));
        assert.equal(paidPlan?.staff, 3);
        assert.equal(paidPlan?.trial_ends_at.getTime(), unpaid?.trial_ends_at.getTime());
        assert.equal(posts - before, 1);
      },
    );
    await check(
      `INITIAL-${code} underpayment cannot release the trial or create a second checkout`,
      async () => {
        const f = await seed(code),
          before = posts;
        await create({ clinicId: f.clinicId });
        const item = remote.get(f.reference)?.[0];
        assert.ok(item);
        item.status = 'PAID';
        item.paidAmount = f.amountMinor - 1;
        item.customerId = 'cust_synthetic';
        await applyPayment({ subscriptionId: f.subscriptionId });
        await assert.rejects(create({ clinicId: f.clinicId }));
        const unpaid = await state(f);
        assert.equal(unpaid.billing_status, 'trial');
        assert.equal(unpaid.invoices, 0);
        assert.equal(unpaid.released, false);
        assert.equal(posts - before, 1);
      },
    );
  }
  for (const failurePoint of ['invoice', 'trial_quota_release'] as const) {
    await check(
      `INITIAL-ATOMIC-${failurePoint} database failure rolls back activation and retries without another charge`,
      async () => {
        const f = await seed('clinica_2026_5'),
          before = posts;
        await create({ clinicId: f.clinicId });
        const item = remote.get(f.reference)?.[0];
        assert.ok(item);
        item.status = 'PAID';
        item.paidAmount = f.amountMinor;
        item.customerId = 'cust_synthetic';
        const unchanged = await state(f);
        // Only this disposable loopback cluster receives fault-injection DDL.
        // Both SQL strings are static; no remote data or identifier is interpolated.
        const target =
          failurePoint === 'invoice' ? 'public.invoices' : 'public.trial_access_policies';
        await sql.unsafe(
          failurePoint === 'invoice'
            ? `CREATE FUNCTION public.synthetic_initial_payment_failure() RETURNS trigger LANGUAGE plpgsql AS $$
              BEGIN RAISE EXCEPTION 'Synthetic invoice persistence failure'; END $$;
              CREATE TRIGGER synthetic_initial_payment_failure BEFORE INSERT ON public.invoices
                FOR EACH ROW EXECUTE FUNCTION public.synthetic_initial_payment_failure();`
            : `CREATE FUNCTION public.synthetic_initial_payment_failure() RETURNS trigger LANGUAGE plpgsql AS $$
              BEGIN IF NEW.released_at IS NOT NULL THEN RAISE EXCEPTION 'Synthetic quota release failure'; END IF;
              RETURN NEW; END $$;
              CREATE TRIGGER synthetic_initial_payment_failure BEFORE UPDATE ON public.trial_access_policies
                FOR EACH ROW EXECUTE FUNCTION public.synthetic_initial_payment_failure();`,
        );
        try {
          const failed = await applyPayment({ subscriptionId: f.subscriptionId });
          assert.equal(failed.applied, 0);
          assert.equal(failed.review, 1);
          assert.deepEqual(await state(f), unchanged);
          const [rolledBack] = await sql`SELECT b.external_subscription_id,b.external_customer_id,
            (SELECT count(*)::int FROM billing_gateway.paid_checkouts WHERE subscription_id=b.subscription_id) receipts,
            (SELECT count(*)::int FROM public.payment_attempts a JOIN public.invoices i ON i.id=a.invoice_id
              WHERE i.subscription_id=b.subscription_id) attempts
            FROM billing_gateway.bindings b WHERE subscription_id=${f.subscriptionId}::uuid`;
          assert.deepEqual(rolledBack, {
            external_subscription_id: null,
            external_customer_id: null,
            receipts: 0,
            attempts: 0,
          });
        } finally {
          await sql.unsafe(
            `DROP TRIGGER synthetic_initial_payment_failure ON ${target}; DROP FUNCTION public.synthetic_initial_payment_failure();`,
          );
        }
        assert.equal((await applyPayment({ subscriptionId: f.subscriptionId })).applied, 1);
        await applyPayment({ subscriptionId: f.subscriptionId });
        const recovered = await state(f);
        assert.equal(recovered.billing_status, 'active');
        assert.equal(recovered.released, true);
        assert.equal(recovered.invoices, 1);
        assert.equal(recovered.operations, 1);
        assert.equal(posts - before, 1);
        const [paid] = await sql`SELECT count(*)::int n FROM public.invoices
          WHERE subscription_id=${f.subscriptionId}::uuid AND status='paid' AND total_amount=${f.amountMinor / 100}`;
        assert.equal(paid?.n, 1);
      },
    );
  }
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
