/** Real migrations and application transaction, synthetic identities, loopback only. */
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

import { readMigrations, startScratchSchema } from './scratch-schema';

const cluster = await startScratchSchema({ port: 55491 });
assert.equal(new URL(cluster.url).hostname, '127.0.0.1');
const sql = cluster.sql;
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: cluster.url,
  DATABASE_URL_DEV: cluster.url,
  DATABASE_URL_RUNTIME: cluster.url,
  SUPABASE_PROJECT_ENV: 'dev',
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_trial',
  SIGNUP_AUTH_ENABLED: 'true',
  SIGNUP_IDENTITY_ENABLED: 'true',
  SAAS_SIGNUP_PROVIDER: 'abacatepay_sandbox',
  ABACATEPAY_STORE_ID: 'store_synthetic',
  ABACATEPAY_API_KEY: 'synthetic-loopback-fixture-only',
  ABACATEPAY_SANDBOX_PROBE_PRODUCT_ID: 'prod_probe',
  ABACATEPAY_SANDBOX_PLAN_PRODUCTS: '{"clinica_2026_2":"prod_synthetic"}',
  ABACATEPAY_WEBHOOK_SECRET: 'synthetic-loopback-webhook-secret-32-characters',
  APP_BASE_URL: 'https://qoro.example',
  LOGIN_HASH_PEPPER: 'synthetic-free-trial-local-hash-pepper-only',
  CRYPTO_SECRET_BACKEND: 'env',
  CRYPTO_MASTER_KEY_V1: Buffer.alloc(32, 7).toString('base64'),
  CRYPTO_LOOKUP_SALT: Buffer.alloc(32, 9).toString('base64'),
  LOG_LEVEL: 'error',
});
delete process.env.VERCEL_ENV;
delete process.env.DATABASE_URL_PROD;
let networkCalls = 0;
let fixtureHttpCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  networkCalls++;
  throw new Error('Network forbidden in local DB proof');
};
const { dbAdmin } = await import('../../src/lib/db');
const { hashEmail } = await import('../../src/lib/auth/email-hash');
const { provisionFreeSignupTrialTx: provision } =
  await import('../../src/contexts/onboarding/internal/signup-free-trial');
const { assertClinicCanWriteTx } = await import('../../src/lib/tenant-access');
const { applyInitialAbacatePayPaymentTx, reconcileMissingAbacatePayInitialPayment } =
  await import('../../src/contexts/billing/internal/abacatepay-processing');
type Evidence = import('../../src/lib/payments/abacatepay/initial-payment').InitialPaymentEvidence;
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
async function seed(options: { old?: boolean; code?: string; email?: string } = {}) {
  const userId = randomUUID();
  const email = options.email ?? `${userId}@example.invalid`;
  const authCreatedAt = new Date(Date.now() - (options.old ? 15 : 2) * 86_400_000);
  await sql`INSERT INTO auth.users(id,email,email_confirmed_at,created_at)
    VALUES(${userId}::uuid,${email},now(),${authCreatedAt})`;
  const [plan] = await sql<
    { id: string }[]
  >`SELECT id::text FROM public.plans WHERE code=${options.code ?? 'clinica_2026_2'}`;
  assert.ok(plan);
  await sql`INSERT INTO public.signup_sessions
    (token_hash,status,idle_expires_at,absolute_expires_at,consumed_at,auth_user_id,
      owner_name,clinic_name,email_hash,accepted_at,answered_at,professionals_band,
      weekly_appointments_band,current_tooling,discovery_source,selected_plan_id)
    VALUES(${createHash('sha256').update(userId).digest('hex')},'email_verified',
      now()+interval '40 minutes',now()+interval '50 minutes',now(),${userId}::uuid,
      'Synthetic owner',${`Synthetic ${userId.slice(0, 8)}`},${hashEmail(email)},now(),now(),
      '2_5','21_50','outro_sistema','indicacao_colega',${plan.id}::uuid)`;
  return { userId, email, authCreatedAt, storeId: 'store_synthetic' };
}
const run = (identity: Awaited<ReturnType<typeof seed>>) =>
  dbAdmin.transaction((tx) => provision(tx, identity));
let failure: unknown;
try {
  // Activate only local catalogue entries, as the current DEV offer does.
  await sql`UPDATE public.plans SET ativo=true WHERE code IN ('consultorio_2026','clinica_2026_2')`;
  const identity = await seed();
  const first = await run(identity);
  assert.ok(first.ok);
  const clinicId = first.clinicId;
  await check(
    'free trial creates complete tenant, quotas and immutable origin without provider IO',
    async () => {
      const [row] = await sql<
        {
          owners: number;
          customers: number;
          subs: number;
          policies: number;
          bindings: number;
          claims: number;
        }[]
      >`
      SELECT (SELECT count(*)::int FROM public.profiles WHERE clinic_id=${clinicId}::uuid AND role='owner') owners,
        (SELECT count(*)::int FROM public.billing_customers WHERE clinic_id=${clinicId}::uuid AND asaas_customer_id IS NULL) customers,
        (SELECT count(*)::int FROM public.subscriptions WHERE clinic_id=${clinicId}::uuid AND asaas_subscription_id IS NULL AND billing_status='trial' AND enforce_trial_deadline) subs,
        (SELECT count(*)::int FROM public.trial_access_policies WHERE clinic_id=${clinicId}::uuid AND released_at IS NULL) policies,
        (SELECT count(*)::int FROM billing_gateway.bindings WHERE clinic_id=${clinicId}::uuid) bindings,
        (SELECT count(*)::int FROM billing_gateway.trial_claims WHERE clinic_id=${clinicId}::uuid) claims`;
      assert.deepEqual(row, {
        owners: 1,
        customers: 1,
        subs: 1,
        policies: 1,
        bindings: 1,
        claims: 1,
      });
      const [sub] = await sql<
        { trial_ends_at: Date }[]
      >`SELECT trial_ends_at FROM public.subscriptions WHERE clinic_id=${clinicId}::uuid`;
      assert.equal(
        sub?.trial_ends_at.getTime(),
        identity.authCreatedAt.getTime() + 14 * 86_400_000,
      );
      assert.equal(networkCalls, 0);
    },
  );
  await check(
    '12 concurrent retries return the original tenant without restarting trial',
    async () => {
      const repeated = await Promise.all(Array.from({ length: 12 }, () => run(identity)));
      assert.ok(repeated.every((result) => result.ok && result.clinicId === clinicId));
    },
  );
  await check('12 concurrent initial requests create only one tenant', async () => {
    const next = await seed();
    const concurrent = await Promise.all(Array.from({ length: 12 }, () => run(next)));
    const ids = new Set(concurrent.flatMap((result) => (result.ok ? [result.clinicId] : [])));
    assert.equal(ids.size, 1);
    assert.ok(concurrent.every((result) => result.ok));
  });
  await check(
    'the same beneficiary with another Auth subject cannot gain another trial or access',
    async () => {
      const duplicate = await seed({ email: identity.email });
      assert.deepEqual(await run(duplicate), { ok: false, reason: 'trial_used' });
    },
  );
  await check(
    'expired Auth deadline does not grant a new trial and business writes are blocked',
    async () => {
      const expired = await seed({ old: true });
      const result = await run(expired);
      assert.ok(result.ok);
      await assert.rejects(
        dbAdmin.transaction((tx) => assertClinicCanWriteTx(tx, result.clinicId)),
        (error: unknown) =>
          error instanceof Error && 'code' in error && error.code === 'clinic_write_blocked',
      );
    },
  );
  await check('legacy plan cannot enter the new acquisition cohort', async () => {
    const legacy = await seed({ code: 'solo' });
    assert.deepEqual(await run(legacy), { ok: false, reason: 'invalid_plan' });
  });
  await check(
    'existing remote billing attempt is preserved for its original Asaas journey',
    async () => {
      const legacy = await seed();
      await sql`UPDATE public.signup_sessions SET billing_attempt_state='creation_unknown',billing_attempted_at=now()
      WHERE auth_user_id=${legacy.userId}::uuid`;
      assert.deepEqual(await run(legacy), { ok: false, reason: 'legacy_checkout' });
    },
  );
  await check('existing owner/admin/invited profile cannot be reassigned', async () => {
    const alreadyMember = await seed();
    const originalClinicId = randomUUID();
    await sql`INSERT INTO public.clinics(id,slug,nome,status)
      VALUES(${originalClinicId}::uuid,${`legacy-${originalClinicId.slice(0, 8)}`},'Synthetic existing clinic','active')`;
    await sql`INSERT INTO public.profiles(id,clinic_id,nome,role,ativo,invite_accepted_at)
      VALUES(${alreadyMember.userId}::uuid,${originalClinicId}::uuid,'Synthetic administrative member','attendant',true,now())`;
    assert.deepEqual(await run(alreadyMember), { ok: false, reason: 'forbidden' });
    const [row] = await sql<
      { clinic_id: string }[]
    >`SELECT clinic_id::text FROM public.profiles WHERE id=${alreadyMember.userId}::uuid`;
    assert.equal(row?.clinic_id, originalClinicId);
  });
  await check(
    'failure after provisioning rolls back tenant, claim, binding and draft consumption',
    async () => {
      const retry = await seed();
      const [before] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM public.clinics`;
      await assert.rejects(
        dbAdmin.transaction(async (tx) => {
          const result = await provision(tx, retry);
          assert.ok(result.ok);
          throw new Error('Deliberate synthetic rollback');
        }),
        /Deliberate synthetic rollback/,
      );
      const [after] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM public.clinics`;
      assert.equal(after?.n, before?.n);
      assert.ok((await run(retry)).ok);
    },
  );
  await check('deadline and external account identity cannot be rewritten', async () => {
    await assert.rejects(
      sql`UPDATE billing_gateway.trial_claims SET trial_ends_at=trial_ends_at+interval '1 day'
      WHERE auth_user_id=${identity.userId}::uuid`,
      (error: unknown) => error instanceof Error && 'code' in error && error.code === '23514',
    );
    await assert.rejects(
      sql`UPDATE billing_gateway.accounts SET provider='asaas'`,
      (error: unknown) => error instanceof Error && 'code' in error && error.code === '23514',
    );
  });
  await check(
    'authenticated and anonymous cannot inspect or mutate the private gateway tables',
    async () => {
      for (const role of ['authenticated', 'anon']) {
        await assert.rejects(
          sql.begin(async (tx) => {
            await tx.unsafe(`SET LOCAL ROLE ${role}`);
            await tx`SELECT * FROM billing_gateway.trial_claims`;
          }),
          (error: unknown) => error instanceof Error && 'code' in error && error.code === '42501',
        );
      }
      const [row] = await sql<
        { excess: boolean }[]
      >`SELECT bool_or(has_table_privilege('service_role',c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER')) excess
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='billing_gateway' AND c.relkind='r'`;
      assert.equal(row?.excess, false);
    },
  );
  await check('trial has no initial invoice, charge or gateway operation', async () => {
    const [row] = await sql<{ n: number }[]>`SELECT
      (SELECT count(*)::int FROM public.invoices)+(SELECT count(*)::int FROM billing_gateway.operations) n`;
    assert.equal(row?.n, 0);
    assert.equal(networkCalls, 0);
  });
  await check(
    'Consultorio uses its own monthly price and the same unpaid trial controls',
    async () => {
      const solo = await run(await seed({ code: 'consultorio_2026' }));
      assert.ok(solo.ok);
      const [row] = await sql<
        { code: string; amount: string; provider: string; unpaid: boolean }[]
      >`SELECT
      p.code,pr.amount::text,s.billing_provider provider,ta.released_at IS NULL unpaid
      FROM public.subscriptions s JOIN public.plans p ON p.id=s.plan_id
      JOIN public.prices pr ON pr.id=s.price_id JOIN public.trial_access_policies ta ON ta.subscription_id=s.id
      WHERE s.clinic_id=${solo.clinicId}::uuid`;
      assert.deepEqual(row, {
        code: 'consultorio_2026',
        amount: '197.00',
        provider: 'abacatepay',
        unpaid: true,
      });
      assert.equal(networkCalls, 0);
    },
  );
  // Domain integration only: these are synthetic reader results, not a claim
  // that a Sandbox payment or an external webhook has occurred.
  async function paymentFixture() {
    const owner = await seed({ old: true });
    const trial = await run(owner);
    assert.ok(trial.ok);
    const [row] = await sql<{ subscription_id: string; account_id: string; price_id: string }[]>`
      SELECT s.id::text subscription_id,b.account_id::text,s.price_id::text
      FROM public.subscriptions s JOIN billing_gateway.bindings b ON b.subscription_id=s.id
      WHERE s.clinic_id=${trial.clinicId}::uuid`;
    assert.ok(row);
    const checkoutId = `bill_${randomUUID().replaceAll('-', '')}`;
    await sql`UPDATE billing_gateway.bindings SET external_checkout_id=${checkoutId}
      WHERE subscription_id=${row.subscription_id}::uuid`;
    await sql`INSERT INTO billing_gateway.checkout_intents(subscription_id,clinic_id,account_id,price_id,product_id,amount_minor)
      VALUES(${row.subscription_id}::uuid,${trial.clinicId}::uuid,${row.account_id}::uuid,${row.price_id}::uuid,'prod_synthetic',39700)`;
    const evidence: Evidence = {
      account: { provider: 'abacatepay', environment: 'sandbox', accountId: 'store_synthetic' },
      subscriptionId: `subs_${randomUUID().replaceAll('-', '')}`,
      customerId: `cust_${randomUUID().replaceAll('-', '')}`,
      checkoutId,
      amountMinor: 39700,
      paidAmountMinor: 39700,
      currency: 'BRL',
      state: 'paid',
      rawStatus: 'PAID',
      settlement: 'unknown',
      subscriptionCreatedAt: new Date(Date.now() - 60_000).toISOString(),
      recurrence: 'running',
    };
    return { ...row, clinicId: trial.clinicId, evidence };
  }
  const paid = await paymentFixture();
  const apply = (evidence: Evidence) =>
    dbAdmin.transaction((tx) => applyInitialAbacatePayPaymentTx(tx, evidence));
  await check(
    'verified initial payment atomically records one invoice, origin, paid period and releases quotas',
    async () => {
      assert.equal(await apply(paid.evidence), 'applied');
      const [row] = await sql<
        { paid: number; attempts: number; released: boolean; active: boolean; provider: string }[]
      >`
      SELECT (SELECT count(*)::int FROM public.invoices WHERE clinic_id=s.clinic_id AND status='paid') paid,
        (SELECT count(*)::int FROM public.payment_attempts WHERE clinic_id=s.clinic_id AND provider='abacatepay') attempts,
        ta.released_at IS NOT NULL released,s.billing_status='active' AND c.status='active' active,s.billing_provider provider
      FROM public.subscriptions s JOIN public.clinics c ON c.id=s.clinic_id
      JOIN public.trial_access_policies ta ON ta.subscription_id=s.id WHERE s.id=${paid.subscription_id}::uuid`;
      assert.deepEqual(row, {
        paid: 1,
        attempts: 1,
        released: true,
        active: true,
        provider: 'abacatepay',
      });
      await dbAdmin.transaction((tx) => assertClinicCanWriteTx(tx, paid.clinicId));
    },
  );
  await check(
    '12 simultaneous payment retries cannot duplicate invoices, attempts or entitlement',
    async () => {
      const outcomes = await Promise.all(Array.from({ length: 12 }, () => apply(paid.evidence)));
      assert.ok(outcomes.every((value) => value === 'duplicate'));
      const [row] = await sql<
        { n: number }[]
      >`SELECT count(*)::int n FROM public.invoices WHERE clinic_id=${paid.clinicId}::uuid`;
      assert.equal(row?.n, 1);
    },
  );
  for (const state of ['pending', 'expired', 'cancelled', 'refunded', 'unknown'] as const) {
    await check(`${state} is never accepted as payment`, async () => {
      const pending = await paymentFixture();
      assert.equal(await apply({ ...pending.evidence, state }), 'review');
      const [row] = await sql<
        { n: number }[]
      >`SELECT count(*)::int n FROM public.invoices WHERE clinic_id=${pending.clinicId}::uuid`;
      assert.equal(row?.n, 0);
    });
  }
  await check(
    'wrong account, partial amount, stopped recurrence, future or stale period do not grant access',
    async () => {
      const pending = await paymentFixture();
      const invalid: Evidence[] = [
        { ...pending.evidence, account: { ...pending.evidence.account, accountId: 'store_other' } },
        { ...pending.evidence, paidAmountMinor: 39699 },
        { ...pending.evidence, amountMinor: 19700, paidAmountMinor: 19700 },
        { ...pending.evidence, recurrence: 'stopped' },
        { ...pending.evidence, subscriptionCreatedAt: null },
        { ...pending.evidence, subscriptionCreatedAt: new Date(Date.now() + 60_000).toISOString() },
        {
          ...pending.evidence,
          subscriptionCreatedAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
        },
      ];
      for (const evidence of invalid) assert.equal(await apply(evidence), 'review');
      const [row] = await sql<{ n: number; released: boolean }[]>`SELECT
      (SELECT count(*)::int FROM public.invoices WHERE clinic_id=${pending.clinicId}::uuid) n,
      released_at IS NOT NULL released FROM public.trial_access_policies WHERE clinic_id=${pending.clinicId}::uuid`;
      assert.deepEqual(row, { n: 0, released: false });
    },
  );
  await check(
    'transaction failure rolls back payment, binding and quota release; retry succeeds',
    async () => {
      const pending = await paymentFixture();
      await assert.rejects(
        dbAdmin.transaction(async (tx) => {
          assert.equal(await applyInitialAbacatePayPaymentTx(tx, pending.evidence), 'applied');
          throw new Error('Synthetic payment rollback');
        }),
        /Synthetic payment rollback/,
      );
      const [row] = await sql<{ n: number; external_subscription_id: string | null }[]>`SELECT
      (SELECT count(*)::int FROM public.invoices WHERE clinic_id=${pending.clinicId}::uuid) n,
      external_subscription_id FROM billing_gateway.bindings WHERE subscription_id=${pending.subscription_id}::uuid`;
      assert.deepEqual(row, { n: 0, external_subscription_id: null });
      assert.equal(await apply(pending.evidence), 'applied');
    },
  );
  await check('cancelled contract is not revived by a delayed initial payment', async () => {
    const pending = await paymentFixture();
    await sql`UPDATE public.subscriptions SET billing_status='cancelled' WHERE id=${pending.subscription_id}::uuid`;
    assert.equal(await apply(pending.evidence), 'review');
  });
  await check(
    'payment for another remote customer cannot replace the immutable binding',
    async () => {
      assert.equal(await apply({ ...paid.evidence, customerId: 'cust_other' }), 'review');
    },
  );
  await check(
    'old paid checkout cannot extend expired period or evade write lock after existing grace',
    async () => {
      await sql`UPDATE public.subscriptions SET current_period_start=now()-interval '2 months',
      current_period_end=now()-interval '16 days',grace_period_until=now()-interval '1 day'
      WHERE id=${paid.subscription_id}::uuid`;
      assert.equal(await apply(paid.evidence), 'duplicate');
      await assert.rejects(
        dbAdmin.transaction((tx) => assertClinicCanWriteTx(tx, paid.clinicId)),
        (error: unknown) =>
          error instanceof Error && 'code' in error && error.code === 'clinic_write_blocked',
      );
    },
  );
  await check(
    'billing provider cannot be switched or mixed with an Asaas subscription ID',
    async () => {
      await assert.rejects(
        sql`UPDATE public.subscriptions SET billing_provider='asaas' WHERE id=${paid.subscription_id}::uuid`,
        (error: unknown) => error instanceof Error && 'code' in error && error.code === '23514',
      );
      await assert.rejects(
        sql`UPDATE public.subscriptions SET asaas_subscription_id='sub_mixed' WHERE id=${paid.subscription_id}::uuid`,
        (error: unknown) => error instanceof Error && 'code' in error && error.code === '23514',
      );
    },
  );
  const { createDeferredSubscriptionCheckout } =
    await import('../../src/contexts/billing/internal/deferred-checkout');
  const { POST: webhook } = await import('../../src/app/api/webhooks/abacatepay/route');
  const external = new Map<
    string,
    {
      externalId: string;
      paid: boolean;
      customerId: string;
      subscriptionId: string;
      createdAt: string;
      cancelled?: boolean;
    }
  >();
  let postCalls = 0;
  let cancelCalls = 0;
  let loseCancellationResponse = false;
  globalThis.fetch = async (input, init) => {
    fixtureHttpCalls++;
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, 'https://api.abacatepay.com');
    assert.equal(
      new Headers(init?.headers).get('authorization'),
      'Bearer synthetic-loopback-fixture-only',
    );
    const method = init?.method ?? 'GET';
    const id = url.searchParams.get('id');
    const subscription = (
      checkoutId: string,
      value: NonNullable<ReturnType<typeof external.get>>,
    ) => ({
      id: value.subscriptionId,
      checkoutId,
      customerId: value.customerId,
      amount: 39700,
      currency: 'BRL',
      status: value.cancelled ? 'CANCELLED' : 'ACTIVE',
      method: 'CARD',
      devMode: true,
      trialEndsAt: null,
      createdAt: value.createdAt,
    });
    const checkout = (checkoutId: string, value: NonNullable<ReturnType<typeof external.get>>) => ({
      id: checkoutId,
      externalId: value.externalId,
      url: `https://app.abacatepay.com/pay/${checkoutId}`,
      frequency: 'SUBSCRIPTION',
      customerId: value.paid ? value.customerId : null,
      amount: 39700,
      paidAmount: value.paid ? 39700 : null,
      status: value.paid ? 'PAID' : 'PENDING',
      devMode: true,
      items: [{ id: 'prod_synthetic', quantity: 1 }],
    });
    let data: unknown;
    if (method === 'GET' && url.pathname === '/v2/stores/get') data = { id: 'store_synthetic' };
    else if (method === 'GET' && url.pathname === '/v2/products/get')
      data = {
        id,
        externalId: `synthetic-${id}`,
        price: 39700,
        currency: 'BRL',
        devMode: true,
        cycle: 'MONTHLY',
        trialDays: null,
      };
    else if (method === 'POST' && url.pathname === '/v2/subscriptions/create') {
      postCalls++;
      const body: unknown = JSON.parse(String(init?.body));
      assert.ok(
        typeof body === 'object' &&
          body !== null &&
          'externalId' in body &&
          typeof body.externalId === 'string',
      );
      assert.ok(
        'completionUrl' in body &&
          body.completionUrl === 'https://qoro.example/configuracoes/assinatura',
      );
      const checkoutId = `bill_http${postCalls}`;
      external.set(checkoutId, {
        externalId: body.externalId,
        paid: false,
        customerId: `cust_http${postCalls}`,
        subscriptionId: `subs_http${postCalls}`,
        createdAt: new Date(Date.now() - 1000).toISOString(),
      });
      data = { id: checkoutId };
    } else if (
      method === 'GET' &&
      url.pathname === '/v2/subscriptions/checkouts/get' &&
      id &&
      external.has(id)
    ) {
      data = checkout(id, external.get(id)!);
    } else if (method === 'POST' && url.pathname === '/v2/subscriptions/cancel') {
      const body: unknown = JSON.parse(String(init?.body));
      assert.ok(typeof body === 'object' && body !== null && 'id' in body);
      const entry = [...external].find(
        ([, value]) => value.subscriptionId === body.id && value.paid,
      );
      assert.ok(entry);
      assert.equal(
        entry[1].cancelled,
        undefined,
        'a cancelled subscription must not receive another POST',
      );
      cancelCalls++;
      entry[1].cancelled = true;
      if (loseCancellationResponse) throw new Error('Synthetic acknowledgement lost after commit');
      data = subscription(entry[0], entry[1]);
    } else if (method === 'GET' && url.pathname === '/v2/subscriptions/get') {
      const entry = [...external].find(([, value]) => value.subscriptionId === id && value.paid);
      assert.ok(entry);
      data = subscription(entry[0], entry[1]);
    } else if (method === 'GET' && url.pathname === '/v2/subscriptions/list') {
      const checkoutId = url.searchParams.get('checkoutId');
      assert.ok(checkoutId);
      const value = external.get(checkoutId);
      assert.ok(value);
      return Response.json({
        success: true,
        data: value.paid ? [subscription(checkoutId, value)] : [],
        pagination: { hasMore: false, next: null },
      });
    } else throw new Error('Unexpected fixture HTTP route; no external request was made');
    return Response.json({ success: true, data });
  };
  const checkoutOwner = await seed({ old: true });
  const checkoutTrial = await run(checkoutOwner);
  assert.ok(checkoutTrial.ok);
  await check(
    'post-trial command uses server catalogue, durable journal and one checkout across retries',
    async () => {
      const firstCheckout = await createDeferredSubscriptionCheckout({
        clinicId: checkoutTrial.clinicId,
      });
      const secondCheckout = await createDeferredSubscriptionCheckout({
        clinicId: checkoutTrial.clinicId,
      });
      assert.deepEqual(firstCheckout, secondCheckout);
      assert.equal(postCalls, 1);
      assert.equal(firstCheckout.checkoutUrl, 'https://app.abacatepay.com/pay/bill_http1');
    },
  );
  await check('active trial cannot originate checkout or call provider', async () => {
    const before = fixtureHttpCalls;
    await assert.rejects(
      createDeferredSubscriptionCheckout({ clinicId }),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === 'trial_active',
    );
    assert.equal(fixtureHttpCalls, before);
  });
  const body = JSON.stringify({
    id: 'log_http_initial',
    event: 'subscription.completed',
    apiVersion: 2,
    devMode: true,
    data: {
      subscription: { id: 'subs_http1' },
      checkout: { id: 'bill_http1' },
      customer: { id: 'cust_http1' },
      payment: { id: 'char_http1' },
    },
  });
  const publicKey =
    't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';
  const notification = (secret = process.env.ABACATEPAY_WEBHOOK_SECRET) =>
    new Request(`https://qoro.example/api/webhooks/abacatepay?webhookSecret=${secret}`, {
      method: 'POST',
      body,
      headers: {
        'X-Webhook-Signature': createHmac('sha256', publicKey).update(body).digest('base64'),
      },
    });
  await check('invalid webhook authentication has no readback or financial effect', async () => {
    const before = fixtureHttpCalls;
    assert.equal((await webhook(notification('incorrect-secret'))).status, 401);
    assert.equal(fixtureHttpCalls, before);
  });
  await check(
    'authenticated webhook reads authoritative fixture API and atomically activates exactly one contract',
    async () => {
      const remote = external.get('bill_http1');
      assert.ok(remote);
      remote.paid = true;
      assert.equal((await webhook(notification())).status, 202);
      const [row] = await sql<{ paid: number; state: string; released: boolean }[]>`SELECT
      (SELECT count(*)::int FROM public.invoices WHERE clinic_id=${checkoutTrial.clinicId}::uuid AND status='paid') paid,
      (SELECT state FROM billing_gateway.event_inbox WHERE event_id='log_http_initial') state,
      released_at IS NOT NULL released FROM public.trial_access_policies WHERE clinic_id=${checkoutTrial.clinicId}::uuid`;
      assert.deepEqual(row, { paid: 1, state: 'applied', released: true });
    },
  );
  await check(
    'replayed HTTP event creates no second payment and paid contract cannot originate again',
    async () => {
      assert.equal((await webhook(notification())).status, 200);
      await assert.rejects(
        createDeferredSubscriptionCheckout({ clinicId: checkoutTrial.clinicId }),
        (error: unknown) =>
          error instanceof Error && 'code' in error && error.code === 'already_paid',
      );
      const [row] = await sql<
        { n: number }[]
      >`SELECT count(*)::int n FROM public.invoices WHERE clinic_id=${checkoutTrial.clinicId}::uuid`;
      assert.equal(row?.n, 1);
      assert.equal(postCalls, 1);
      assert.equal(networkCalls, 0);
    },
  );
  // Separate fixture: the original contract above is activated exclusively by
  // the authenticated webhook. This one receives no event at all.
  const lostOwner = await seed({ old: true });
  const lostTrial = await run(lostOwner);
  assert.ok(lostTrial.ok);
  const [lostSubscription] = await sql<{ id: string }[]>`SELECT id::text FROM public.subscriptions
    WHERE clinic_id=${lostTrial.clinicId}::uuid`;
  assert.ok(lostSubscription);
  await createDeferredSubscriptionCheckout({ clinicId: lostTrial.clinicId });
  await check('missing-webhook readback keeps an unpaid checkout restricted', async () => {
    assert.deepEqual(
      await reconcileMissingAbacatePayInitialPayment({
        subscriptionId: lostSubscription.id,
      }),
      { scanned: 1, applied: 0, duplicate: 0, review: 0 },
    );
    const [row] = await sql<{ invoices: number; released: boolean }[]>`SELECT
      (SELECT count(*)::int FROM public.invoices WHERE clinic_id=${lostTrial.clinicId}::uuid) invoices,
      released_at IS NOT NULL released FROM public.trial_access_policies
      WHERE clinic_id=${lostTrial.clinicId}::uuid`;
    assert.deepEqual(row, { invoices: 0, released: false });
  });
  await check(
    'paid cached checkout recovers atomically without a fabricated webhook or second charge',
    async () => {
      const remote = external.get('bill_http2');
      assert.ok(remote);
      remote.paid = true;
      await Promise.all(
        Array.from({ length: 12 }, () =>
          assert.rejects(
            createDeferredSubscriptionCheckout({ clinicId: lostTrial.clinicId }),
            (error: unknown) =>
              error instanceof Error &&
              'code' in error &&
              (error.code === 'already_paid' || error.code === 'reconcile_required'),
          ),
        ),
      );
      const [row] = await sql<{ paid: number; inbox: number; released: boolean }[]>`SELECT
      (SELECT count(*)::int FROM public.invoices WHERE clinic_id=${lostTrial.clinicId}::uuid AND status='paid') paid,
      (SELECT count(*)::int FROM billing_gateway.event_inbox WHERE clinic_id=${lostTrial.clinicId}::uuid
        OR external_checkout_id='bill_http2') inbox,
      released_at IS NOT NULL released FROM public.trial_access_policies
      WHERE clinic_id=${lostTrial.clinicId}::uuid`;
      assert.deepEqual(row, { paid: 1, inbox: 0, released: true });
      assert.equal(postCalls, 2);
    },
  );
  await check('concurrent missing-webhook retries cannot duplicate a paid invoice', async () => {
    await Promise.all(
      Array.from({ length: 12 }, () =>
        reconcileMissingAbacatePayInitialPayment({ subscriptionId: lostSubscription.id }),
      ),
    );
    const [row] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM public.invoices
      WHERE clinic_id=${lostTrial.clinicId}::uuid`;
    assert.equal(row?.n, 1);
    assert.equal(postCalls, 2);
    assert.equal(networkCalls, 0);
  });

  // Cancellation/recontract proof uses synthetic dates and HTTP fixtures only.
  // It does not claim a real paid month elapsed or a new Sandbox payment.
  const {
    requestAbacatePayCancellation: cancel,
    getAbacatePayManagementContext: context,
    applyAbacatePayRecontractPaymentTx: applyRecontract,
    reconcileAbacatePayManagement,
    recoverAbacatePayRecontract,
  } = await import('../../src/contexts/billing/internal/abacatepay-management');
  const live = await context(dbAdmin, checkoutTrial.clinicId);
  assert.ok(live);
  const cancelLive = () =>
    cancel(dbAdmin, {
      clinicId: checkoutTrial.clinicId,
      requestedBy: checkoutOwner.userId,
      contractId: live.generation_id,
    });
  await check('another tenant actor or stale generation cannot request cancellation', async () => {
    for (const input of [
      {
        clinicId: checkoutTrial.clinicId,
        requestedBy: lostOwner.userId,
        contractId: live.generation_id,
      },
      {
        clinicId: checkoutTrial.clinicId,
        requestedBy: checkoutOwner.userId,
        contractId: randomUUID(),
      },
    ])
      await assert.rejects(cancel(dbAdmin, input));
    assert.equal(cancelCalls, 0);
  });
  await check(
    '12 cancellation clicks stop recurrence at most once without shortening access',
    async () => {
      const results = await Promise.allSettled(Array.from({ length: 12 }, cancelLive));
      assert.ok(results.some((value) => value.status === 'fulfilled'));
      for (const result of results)
        if (result.status === 'rejected') {
          assert.ok(
            result.reason instanceof Error &&
              'code' in result.reason &&
              result.reason.code === 'reconcile_required',
          );
        }
      await cancelLive();
      assert.equal(cancelCalls, 1);
      const current = await context(dbAdmin, checkoutTrial.clinicId);
      assert.ok(current?.cancellation_confirmed && current.cancel_at_period_end);
      assert.equal(current.period_end.toISOString(), live.period_end.toISOString());
      assert.equal(current.billing_status, 'active');
      await dbAdmin.transaction((tx) => assertClinicCanWriteTx(tx, checkoutTrial.clinicId));
    },
  );
  await check(
    'replacement checkout before paid end is refused without a provider POST',
    async () => {
      const before = postCalls;
      await assert.rejects(
        createDeferredSubscriptionCheckout({ clinicId: checkoutTrial.clinicId }),
        (error: unknown) =>
          error instanceof Error && 'code' in error && error.code === 'already_paid',
      );
      assert.equal(postCalls, before);
    },
  );
  // Age only this isolated synthetic projection BEFORE cancellation snapshots.
  await sql`UPDATE public.subscriptions SET current_period_start=now()-interval '1 month'-interval '1 day',
    current_period_end=now()-interval '1 day',grace_period_until=now()+interval '14 days'
    WHERE id=${lostSubscription.id}::uuid`;
  const ended = await context(dbAdmin, lostTrial.clinicId);
  assert.ok(ended);
  const [beforeRecontract] =
    await sql`SELECT row_to_json(t)::text policy FROM public.trial_access_policies t WHERE t.clinic_id=${lostTrial.clinicId}::uuid`;
  const [oldBinding] =
    await sql`SELECT row_to_json(b)::text binding FROM billing_gateway.bindings b WHERE b.clinic_id=${lostTrial.clinicId}::uuid`;
  await check(
    'lost cancellation response is recovered by authoritative GET, never another POST',
    async () => {
      loseCancellationResponse = true;
      const input = {
        clinicId: lostTrial.clinicId,
        requestedBy: lostOwner.userId,
        contractId: ended.generation_id,
      };
      await cancel(dbAdmin, input);
      await cancel(dbAdmin, input);
      loseCancellationResponse = false;
      assert.equal(cancelCalls, 2);
      const current = await context(dbAdmin, lostTrial.clinicId);
      assert.equal(current?.billing_status, 'cancelled');
      const [operation] = await sql`SELECT state FROM billing_gateway.operations
      WHERE subscription_id=${lostSubscription.id}::uuid AND kind='cancel_subscription'`;
      assert.equal(operation?.state, 'confirmed');
      await assert.rejects(
        dbAdmin.transaction((tx) => assertClinicCanWriteTx(tx, lostTrial.clinicId)),
      );
    },
  );
  await check(
    'recontract checkout is unique across 12 concurrent attempts and cannot change price',
    async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () =>
          createDeferredSubscriptionCheckout({ clinicId: lostTrial.clinicId }),
        ),
      );
      if (!results.some((value) => value.status === 'fulfilled')) {
        const rejected = results.find((value) => value.status === 'rejected');
        if (rejected?.status === 'rejected') throw rejected.reason;
      }
      assert.ok(results.some((value) => value.status === 'fulfilled'));
      const cached = await createDeferredSubscriptionCheckout({ clinicId: lostTrial.clinicId });
      assert.equal(cached.checkoutUrl, 'https://app.abacatepay.com/pay/bill_http3');
      assert.equal(postCalls, 3);
      const [row] =
        await sql`SELECT count(*)::int n,min(amount_minor)::int amount FROM billing_gateway.recontracts WHERE clinic_id=${lostTrial.clinicId}::uuid`;
      assert.deepEqual(row, { n: 1, amount: 39700 });
      await assert.rejects(
        dbAdmin.transaction((tx) => assertClinicCanWriteTx(tx, lostTrial.clinicId)),
      );
    },
  );
  const replacement = external.get('bill_http3');
  assert.ok(replacement);
  const recontractEvidence: Evidence = {
    account: { provider: 'abacatepay', environment: 'sandbox', accountId: 'store_synthetic' },
    subscriptionId: replacement.subscriptionId,
    customerId: replacement.customerId,
    checkoutId: 'bill_http3',
    amountMinor: 39700,
    paidAmountMinor: 39700,
    currency: 'BRL',
    state: 'paid',
    rawStatus: 'PAID',
    settlement: 'unknown',
    recurrence: 'running',
    subscriptionCreatedAt: replacement.createdAt,
  };
  await check(
    'pending, partial, old, future, stopped or other-store evidence cannot reactivate',
    async () => {
      const invalid: Evidence[] = [
        { ...recontractEvidence, state: 'pending' },
        { ...recontractEvidence, paidAmountMinor: 39699 },
        { ...recontractEvidence, recurrence: 'stopped' },
        {
          ...recontractEvidence,
          subscriptionCreatedAt: new Date(Date.now() + 60_000).toISOString(),
        },
        {
          ...recontractEvidence,
          subscriptionCreatedAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
        },
        {
          ...recontractEvidence,
          account: { ...recontractEvidence.account, accountId: 'store_other' },
        },
        { ...recontractEvidence, checkoutId: 'bill_http2', subscriptionId: 'subs_http2' },
      ];
      for (const evidence of invalid)
        assert.equal(await dbAdmin.transaction((tx) => applyRecontract(tx, evidence)), 'review');
      assert.equal((await context(dbAdmin, lostTrial.clinicId))?.billing_status, 'cancelled');
    },
  );
  await check(
    'recontract transaction rollback preserves cancelled state and original payment',
    async () => {
      await assert.rejects(
        dbAdmin.transaction(async (tx) => {
          assert.equal(await applyRecontract(tx, recontractEvidence), 'applied');
          throw new Error('Synthetic recontract rollback');
        }),
        /Synthetic recontract rollback/,
      );
      assert.equal((await context(dbAdmin, lostTrial.clinicId))?.billing_status, 'cancelled');
      const [row] =
        await sql`SELECT count(*)::int n FROM public.invoices WHERE clinic_id=${lostTrial.clinicId}::uuid`;
      assert.equal(row?.n, 1);
    },
  );
  await check(
    'authoritative missing-webhook recontract activates exactly once without restarting trial',
    async () => {
      replacement.paid = true;
      const outcomes = await Promise.all(
        Array.from({ length: 12 }, () =>
          recoverAbacatePayRecontract(dbAdmin, { clinicId: lostTrial.clinicId }),
        ),
      );
      assert.equal(
        outcomes.reduce((sum, value) => sum + value.applied, 0),
        1,
      );
      const current = await context(dbAdmin, lostTrial.clinicId);
      assert.equal(current?.billing_status, 'active');
      assert.equal(current?.external_subscription_id, 'subs_http3');
      assert.notEqual(current?.generation_id, ended.generation_id);
      assert.equal(current?.cancel_at_period_end, false);
      await dbAdmin.transaction((tx) => assertClinicCanWriteTx(tx, lostTrial.clinicId));
      const [row] =
        await sql`SELECT count(*)::int n FROM public.invoices WHERE clinic_id=${lostTrial.clinicId}::uuid`;
      assert.equal(row?.n, 2);
      const [after] =
        await sql`SELECT row_to_json(t)::text policy FROM public.trial_access_policies t WHERE t.clinic_id=${lostTrial.clinicId}::uuid`;
      assert.deepEqual(after, beforeRecontract);
      const [binding] =
        await sql`SELECT row_to_json(b)::text binding FROM billing_gateway.bindings b WHERE b.clinic_id=${lostTrial.clinicId}::uuid`;
      assert.deepEqual(binding, oldBinding);
    },
  );
  await check(
    'late old cancellation and old checkout cannot cancel or reactivate the replacement',
    async () => {
      await assert.rejects(
        cancel(dbAdmin, {
          clinicId: lostTrial.clinicId,
          requestedBy: lostOwner.userId,
          contractId: ended.generation_id,
        }),
      );
      assert.equal(
        await dbAdmin.transaction((tx) => applyRecontract(tx, recontractEvidence)),
        'duplicate',
      );
      await reconcileAbacatePayManagement(dbAdmin);
      assert.equal((await context(dbAdmin, lostTrial.clinicId))?.billing_status, 'active');
      assert.equal(cancelCalls, 2);
      assert.equal(postCalls, 3);
      assert.equal(networkCalls, 0);
    },
  );
  await check(
    'private cancellation and recontract snapshots are immutable and not client-accessible',
    async () => {
      await assert.rejects(
        sql`UPDATE billing_gateway.cancellations SET confirmed_at=NULL WHERE subscription_id=${lostSubscription.id}::uuid`,
      );
      await assert.rejects(
        sql`UPDATE billing_gateway.recontracts SET amount_minor=1 WHERE clinic_id=${lostTrial.clinicId}::uuid`,
      );
      for (const table of ['cancellations', 'recontracts']) {
        for (const role of ['anon', 'authenticated', 'service_role']) {
          await assert.rejects(
            sql.begin(async (tx) => {
              await tx.unsafe(`SET LOCAL ROLE ${role}`);
              await tx.unsafe(
                `${role === 'service_role' ? 'DELETE FROM' : 'SELECT * FROM'} billing_gateway.${table}`,
              );
            }),
          );
        }
      }
    },
  );
  await check(
    'paid-end write gate does not grant delinquency grace after renewal cancellation',
    async () => {
      const pending = await paymentFixture();
      assert.equal(await apply(pending.evidence), 'applied');
      await sql`UPDATE public.subscriptions SET cancel_at_period_end=true,current_period_end=now()-interval '1 second',
      grace_period_until=now()+interval '14 days' WHERE id=${pending.subscription_id}::uuid`;
      await assert.rejects(
        dbAdmin.transaction((tx) => assertClinicCanWriteTx(tx, pending.clinicId)),
      );
    },
  );
  await check(
    'second-generation cancellation and authenticated new-checkout webhook keep lineage intact',
    async () => {
      // Controlled local state only: not an observation of a real monthly cycle.
      await sql`UPDATE public.subscriptions SET current_period_start=now()-interval '1 month'-interval '1 day',
      current_period_end=now()-interval '1 day' WHERE id=${lostSubscription.id}::uuid`;
      const current = await context(dbAdmin, lostTrial.clinicId);
      assert.ok(current);
      await cancel(dbAdmin, {
        clinicId: lostTrial.clinicId,
        requestedBy: lostOwner.userId,
        contractId: current.generation_id,
      });
      await createDeferredSubscriptionCheckout({ clinicId: lostTrial.clinicId });
      const next = external.get('bill_http4');
      assert.ok(next);
      const [before] =
        await sql`SELECT billing_status FROM public.subscriptions WHERE id=${lostSubscription.id}::uuid`;
      assert.equal(before?.billing_status, 'cancelled');
      next.paid = true;
      const payload = JSON.stringify({
        id: 'log_http_recontract',
        event: 'subscription.completed',
        apiVersion: 2,
        devMode: true,
        data: {
          subscription: { id: next.subscriptionId },
          checkout: { id: 'bill_http4' },
          customer: { id: next.customerId },
        },
      });
      const notification = () =>
        new Request(
          `https://qoro.example/api/webhooks/abacatepay?webhookSecret=${process.env.ABACATEPAY_WEBHOOK_SECRET}`,
          {
            method: 'POST',
            body: payload,
            headers: {
              'X-Webhook-Signature': createHmac('sha256', publicKey)
                .update(payload)
                .digest('base64'),
            },
          },
        );
      assert.equal((await webhook(notification())).status, 202);
      assert.equal((await webhook(notification())).status, 200);
      const active = await context(dbAdmin, lostTrial.clinicId);
      assert.equal(active?.billing_status, 'active');
      assert.equal(active?.external_subscription_id, 'subs_http4');
      const [row] = await sql`SELECT
      (SELECT count(*)::int FROM public.invoices WHERE clinic_id=${lostTrial.clinicId}::uuid) invoices,
      (SELECT count(*)::int FROM billing_gateway.recontracts WHERE clinic_id=${lostTrial.clinicId}::uuid AND invoice_id IS NOT NULL) recontracts,
      (SELECT state FROM billing_gateway.event_inbox WHERE event_id='log_http_recontract') state`;
      assert.deepEqual(row, { invoices: 3, recontracts: 2, state: 'applied' });
      assert.equal(cancelCalls, 3);
      assert.equal(postCalls, 4);
      assert.equal(networkCalls, 0);
    },
  );
} catch (error) {
  failure = error;
} finally {
  globalThis.fetch = originalFetch;
  await mkdir('dist', { recursive: true });
  await writeFile(
    'dist/signup-free-trial-db.json',
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        environment: 'loopback_synthetic',
        migrations: (await readMigrations()).length,
        results,
        networkCalls,
        fixtureHttpCalls,
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
console.log(JSON.stringify({ status: 'PASS', checks: results.length, networkCalls }));
