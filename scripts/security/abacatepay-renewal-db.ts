/** Real migrations/application/receiver; synthetic identities and provider HTTP, loopback DB only. */
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

import { readMigrations, startScratchSchema } from './scratch-schema';

const cluster = await startScratchSchema({ port: 55492 });
assert.equal(new URL(cluster.url).hostname, '127.0.0.1');
const sql = cluster.sql;
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: cluster.url,
  DATABASE_URL_DEV: cluster.url,
  DATABASE_URL_RUNTIME: cluster.url,
  SUPABASE_PROJECT_ENV: 'dev',
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_renewal',
  SIGNUP_AUTH_ENABLED: 'true',
  SIGNUP_IDENTITY_ENABLED: 'true',
  SAAS_SIGNUP_PROVIDER: 'abacatepay_sandbox',
  ABACATEPAY_STORE_ID: 'store_synthetic',
  ABACATEPAY_API_KEY: 'synthetic-loopback-renewal-only',
  ABACATEPAY_SANDBOX_PROBE_PRODUCT_ID: 'prod_probe',
  ABACATEPAY_SANDBOX_PLAN_PRODUCTS: '{"clinica_2026_2":"prod_synthetic"}',
  ABACATEPAY_WEBHOOK_SECRET: 'synthetic-renewal-webhook-secret-32-characters',
  APP_BASE_URL: 'https://qoro.example',
  LOGIN_HASH_PEPPER: 'synthetic-renewal-local-hash-pepper-only',
  CRYPTO_SECRET_BACKEND: 'env',
  CRYPTO_MASTER_KEY_V1: Buffer.alloc(32, 7).toString('base64'),
  CRYPTO_LOOKUP_SALT: Buffer.alloc(32, 9).toString('base64'),
  LOG_LEVEL: 'error',
});
delete process.env.VERCEL_ENV;
delete process.env.DATABASE_URL_PROD;
const originalFetch = globalThis.fetch;
let networkCalls = 0,
  fixtureHttpCalls = 0;
globalThis.fetch = async () => {
  networkCalls++;
  throw new Error('External network forbidden in renewal DB proof');
};
const { dbAdmin } = await import('../../src/lib/db');
const { hashEmail } = await import('../../src/lib/auth/email-hash');
const { provisionFreeSignupTrialTx: provision } =
  await import('../../src/contexts/onboarding/internal/signup-free-trial');
const { addCalendarMonths } = await import('../../src/contexts/billing/internal/billing-period');
const { applyAbacatePayRenewalTx } =
  await import('../../src/contexts/billing/internal/abacatepay-renewals');
const { recordAbacatePayRecurringPaymentTx } =
  await import('../../src/contexts/billing/internal/abacatepay-recurring-observations');
const { reconcileAbacatePayInbox } =
  await import('../../src/contexts/billing/internal/abacatepay-processing');
const { createPostgresGatewayInbox } = await import('../../src/lib/payments/saas/postgres-store');
const { POST: webhook } = await import('../../src/app/api/webhooks/abacatepay/route');
type Evidence = import('../../src/lib/payments/saas/recurring-payment').RecurringPaymentEvidence;
const account = {
  provider: 'abacatepay',
  environment: 'sandbox',
  accountId: 'store_synthetic',
} as const;
const inbox = createPostgresGatewayInbox(account, dbAdmin);
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
function month(date: Date, delta: number) {
  const iso = date.toISOString();
  return new Date(`${addCalendarMonths(iso.slice(0, 10), delta)}${iso.slice(10)}`);
}
async function seed() {
  const userId = randomUUID(),
    email = `${userId}@example.invalid`,
    authCreatedAt = new Date(Date.now() - 55 * 86_400_000);
  await sql`INSERT INTO auth.users(id,email,email_confirmed_at,created_at) VALUES(${userId}::uuid,${email},now(),${authCreatedAt})`;
  const [plan] = await sql<
    { id: string }[]
  >`SELECT id::text FROM public.plans WHERE code='clinica_2026_2'`;
  assert.ok(plan);
  await sql`INSERT INTO public.signup_sessions(token_hash,status,idle_expires_at,absolute_expires_at,consumed_at,auth_user_id,
    owner_name,clinic_name,email_hash,accepted_at,answered_at,professionals_band,weekly_appointments_band,current_tooling,discovery_source,selected_plan_id)
    VALUES(${createHash('sha256').update(userId).digest('hex')},'email_verified',now()+interval '40 minutes',now()+interval '50 minutes',now(),${userId}::uuid,
      'Synthetic owner','Synthetic renewal clinic',${hashEmail(email)},now(),now(),'2_5','21_50','outro_sistema','indicacao_colega',${plan.id}::uuid)`;
  const trial = await dbAdmin.transaction((tx) =>
    provision(tx, { userId, email, authCreatedAt, storeId: account.accountId }),
  );
  assert.ok(trial.ok);
  const [row] = await sql<{ subscription_id: string; account_id: string; price_id: string }[]>`
    SELECT s.id::text subscription_id,b.account_id::text,s.price_id::text FROM public.subscriptions s
    JOIN billing_gateway.bindings b ON b.subscription_id=s.id WHERE s.clinic_id=${trial.clinicId}::uuid`;
  assert.ok(row);
  const suffix = randomUUID().replaceAll('-', ''),
    origin = `bill_origin_${suffix}`,
    externalSub = `subs_${suffix}`,
    customer = `cust_${suffix}`;
  const end = new Date(Date.now() - 120_000),
    anchor = month(end, -1);
  await sql`UPDATE billing_gateway.bindings SET external_checkout_id=${origin},external_subscription_id=${externalSub},external_customer_id=${customer}
    WHERE subscription_id=${row.subscription_id}::uuid`;
  await sql`INSERT INTO billing_gateway.checkout_intents(subscription_id,clinic_id,account_id,price_id,product_id,amount_minor)
    VALUES(${row.subscription_id}::uuid,${trial.clinicId}::uuid,${row.account_id}::uuid,${row.price_id}::uuid,'prod_synthetic',39700)`;
  // Explicit synthetic S0, not a simulated or claimed external first payment.
  const [invoice] = await sql<
    { id: string }[]
  >`INSERT INTO public.invoices(clinic_id,subscription_id,total_amount,status,due_date,period_start,period_end,paid_at,payment_method)
    VALUES(${trial.clinicId}::uuid,${row.subscription_id}::uuid,397,'paid',${anchor.toISOString().slice(0, 10)},
      ${anchor.toISOString().slice(0, 10)},${end.toISOString().slice(0, 10)},${anchor},'CARD') RETURNING id::text`;
  assert.ok(invoice);
  await sql`INSERT INTO billing_gateway.paid_checkouts(account_id,checkout_id,subscription_id,clinic_id,invoice_id,period_start,period_end)
    VALUES(${row.account_id}::uuid,${origin},${row.subscription_id}::uuid,${trial.clinicId}::uuid,${invoice.id}::uuid,${anchor},${end})`;
  await sql`UPDATE public.trial_access_policies SET released_at=${anchor},released_by_invoice_id=${invoice.id}::uuid WHERE clinic_id=${trial.clinicId}::uuid`;
  await sql`UPDATE public.subscriptions SET billing_status='active',current_period_start=${anchor},current_period_end=${end},
    grace_period_until=${new Date(end.getTime() + 15 * 86_400_000)} WHERE id=${row.subscription_id}::uuid`;
  const evidence: Evidence = {
    account,
    subscriptionId: externalSub,
    customerId: customer,
    originCheckoutId: origin,
    checkoutId: `bill_cycle_${suffix}`,
    productId: 'prod_synthetic',
    paymentId: `char_${suffix}`,
    statementId: `tran_${suffix}`,
    amountMinor: 39700,
    paidAmountMinor: 39700,
    currency: 'BRL',
    chargeCreatedAt: new Date(end.getTime() - 500).toISOString(),
    confirmedAt: new Date(end.getTime() + 1000).toISOString(),
    method: 'card',
    recurrence: 'running',
    obligation: 'paid',
    settlement: 'unknown',
  };
  return {
    ...row,
    clinicId: trial.clinicId,
    userId,
    anchor,
    end,
    evidence,
    eventId: `log_${suffix}`,
  };
}
type Fixture = Awaited<ReturnType<typeof seed>>;
async function accept(
  f: Fixture,
  eventId = f.eventId,
  evidence = f.evidence,
  type = 'subscription.renewed',
) {
  await inbox.accept(
    {
      eventId,
      eventType: type,
      subscriptionId: evidence.subscriptionId,
      customerId: evidence.customerId,
      checkoutId: evidence.checkoutId,
      paymentId: evidence.paymentId,
    },
    createHash('sha256').update(eventId).digest('hex'),
  );
}
const apply = (f: Fixture, evidence = f.evidence, eventId = f.eventId) =>
  dbAdmin.transaction((tx) => applyAbacatePayRenewalTx(tx, evidence, eventId));
async function state(f: Fixture) {
  const [row] =
    await sql`SELECT s.billing_status,s.current_period_start::text,s.current_period_end::text,s.dunning_stage,
  (SELECT count(*)::int FROM public.invoices WHERE clinic_id=s.clinic_id) invoices,
  (SELECT count(*)::int FROM billing_gateway.recurring_payment_observations WHERE clinic_id=s.clinic_id) observations,
  (SELECT count(*)::int FROM billing_gateway.recurring_access_periods WHERE clinic_id=s.clinic_id) cycles
  FROM public.subscriptions s WHERE s.id=${f.subscription_id}::uuid`;
  assert.ok(row);
  return row;
}
function useHttp(f: Fixture, options: { fail?: boolean; cycle?: string; status?: string } = {}) {
  globalThis.fetch = async (target, init) => {
    fixtureHttpCalls++;
    const url = new URL(target instanceof Request ? target.url : String(target));
    assert.equal(url.origin, 'https://api.abacatepay.com');
    assert.equal(init?.method, 'GET');
    if (options.fail) return new Response('{}', { status: 503 });
    const subscription = {
      id: f.evidence.subscriptionId,
      checkoutId: f.evidence.originCheckoutId,
      customerId: f.evidence.customerId,
      amount: 39700,
      status: options.status ?? 'ACTIVE',
      method: 'CARD',
      devMode: true,
      trialEndsAt: null,
      createdAt: f.anchor.toISOString(),
    };
    let data: unknown;
    switch (url.pathname) {
      case '/v2/stores/get':
        data = { id: 'store_synthetic' };
        break;
      case '/v2/products/get':
        data = {
          id: 'prod_synthetic',
          externalId: 'local-renewal',
          price: 39700,
          currency: 'BRL',
          devMode: true,
          cycle: options.cycle ?? 'MONTHLY',
          trialDays: null,
        };
        break;
      case '/v2/subscriptions/get':
        data = subscription;
        break;
      case '/v2/subscriptions/list':
        return Response.json({
          success: true,
          data: [subscription],
          pagination: { hasMore: false, next: null },
        });
      case '/v2/subscriptions/checkouts/get':
        data = {
          id: f.evidence.checkoutId,
          frequency: 'SUBSCRIPTION',
          customerId: f.evidence.customerId,
          amount: 39700,
          paidAmount: 39700,
          status: 'PAID',
          devMode: true,
          items: [{ id: 'prod_synthetic', quantity: 1 }],
          createdAt: f.evidence.chargeCreatedAt,
        };
        break;
      case '/v2/bank-statement/list':
        return Response.json({
          success: true,
          data: [
            {
              id: f.evidence.statementId,
              currency: 'BRL',
              createdAt: f.evidence.confirmedAt,
              checkoutId: f.evidence.checkoutId,
              paymentIntentId: f.evidence.paymentId,
              customer: { publicId: f.evidence.customerId },
              movements: [
                {
                  amount: 39700,
                  kind: 'CARD_APPROVED',
                  method: 'CARD',
                  category: 'transaction',
                  balanceEffect: 'none',
                },
              ],
            },
          ],
          pagination: { hasMore: false, next: null },
        });
      default:
        networkCalls++;
        throw new Error('Unexpected provider path in synthetic renewal proof');
    }
    return Response.json({ success: true, data });
  };
}
const publicKey =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';
function notification(f: Fixture) {
  const body = JSON.stringify({
    id: f.eventId,
    event: 'subscription.renewed',
    apiVersion: 2,
    devMode: true,
    data: {
      subscription: { id: f.evidence.subscriptionId },
      customer: { id: f.evidence.customerId },
      checkout: { id: f.evidence.checkoutId },
      payment: { id: f.evidence.paymentId },
    },
  });
  return new Request(
    `https://qoro.example/api/webhooks/abacatepay?webhookSecret=${process.env.ABACATEPAY_WEBHOOK_SECRET}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': createHmac('sha256', publicKey).update(body).digest('base64'),
      },
      body,
    },
  );
}
let failure: unknown;
try {
  await sql`UPDATE public.plans SET ativo=true WHERE code='clinica_2026_2'`;
  const first = await seed();
  await accept(first);
  await check(
    'REN-001 verified renewal records a second invoice and advances the original calendar once',
    async () => {
      assert.equal(await apply(first), 'applied');
      const row = await state(first);
      assert.equal(row.invoices, 2);
      assert.equal(row.cycles, 1);
      assert.equal(row.observations, 1);
      assert.equal(
        new Date(String(row.current_period_end)).toISOString(),
        month(first.anchor, 2).toISOString(),
      );
    },
  );
  await check(
    'REN-002/020 duplicate event and charge do not extend the same period twice',
    async () => {
      const before = await state(first);
      assert.equal(await apply(first), 'duplicate');
      assert.deepEqual(await state(first), before);
    },
  );
  await check(
    'REN-003/004/018 older distinct charge keeps financial evidence without regressing the current period',
    async () => {
      const previous = await state(first),
        e = {
          ...first.evidence,
          checkoutId: `bill_old_${randomUUID()}`,
          paymentId: `char_old_${randomUUID()}`,
          statementId: `tran_old_${randomUUID()}`,
        };
      const event = `log_old_${randomUUID()}`;
      await accept(first, event, e);
      assert.equal(await apply(first, e, event), 'review');
      const current = await state(first);
      assert.equal(current.current_period_end, previous.current_period_end);
      assert.equal(current.invoices, 2);
      assert.equal(current.observations, 2);
    },
  );
  await check(
    'REN-005 unknown event or subscription cannot create a financial effect',
    async () => {
      const before = await state(first);
      assert.equal(await apply(first, first.evidence, 'log_unknown'), 'review');
      assert.equal(
        await apply(first, { ...first.evidence, subscriptionId: 'subs_unknown' }),
        'review',
      );
      assert.deepEqual(await state(first), before);
    },
  );
  await check('REN-006 authenticated references cannot be rebound to another tenant', async () => {
    const other = await seed();
    const before = await state(other);
    await accept(other);
    assert.equal(
      await apply(other, { ...other.evidence, customerId: first.evidence.customerId }),
      'review',
    );
    assert.deepEqual(await state(other), before);
  });
  await check('REN-007 gateway/environment/store mismatch is rejected before writes', async () => {
    const before = await state(first);
    for (const account of [
      { ...first.evidence.account, provider: 'asaas' as const },
      { ...first.evidence.account, environment: 'production' as const },
      { ...first.evidence.account, accountId: 'store_other' },
    ])
      assert.equal(await apply(first, { ...first.evidence, account }), 'review');
    assert.deepEqual(await state(first), before);
  });
  await check(
    'REN-008 cancellation intent wins over automatic renewal access and keeps paid evidence',
    async () => {
      const f = await seed();
      await accept(f);
      await sql`INSERT INTO billing_gateway.cancellations
      (account_id,external_subscription_id,subscription_id,clinic_id,external_customer_id,external_checkout_id,paid_period_start,paid_period_end,requested_by)
      VALUES(${f.account_id}::uuid,${f.evidence.subscriptionId},${f.subscription_id}::uuid,${f.clinicId}::uuid,
      ${f.evidence.customerId},${f.evidence.originCheckoutId},${f.anchor},${f.end},${f.userId}::uuid)`;
      const before = await state(f);
      assert.equal(await apply(f), 'review');
      const after = await state(f);
      assert.equal(after.current_period_end, before.current_period_end);
      assert.equal(after.invoices, 2);
      assert.equal(after.cycles, 1);
    },
  );
  await check(
    'REN-009/010 API outage remains retryable, then the same legitimate event regularizes once',
    async () => {
      const f = await seed();
      await accept(f);
      useHttp(f, { fail: true });
      assert.equal((await reconcileAbacatePayInbox({ eventId: f.eventId })).retry, true);
      assert.equal((await state(f)).invoices, 1);
      useHttp(f);
      assert.equal((await reconcileAbacatePayInbox({ eventId: f.eventId })).applied, 1);
      assert.equal((await state(f)).invoices, 2);
    },
  );
  await check(
    'REN-011 transaction rollback preserves state and permits a later successful replay',
    async () => {
      const f = await seed();
      await accept(f);
      const before = await state(f);
      await assert.rejects(
        dbAdmin.transaction(async (tx) => {
          assert.equal(await applyAbacatePayRenewalTx(tx, f.evidence, f.eventId), 'applied');
          throw new Error('synthetic rollback');
        }),
      );
      assert.deepEqual(await state(f), before);
      assert.equal(await apply(f), 'applied');
    },
  );
  await check(
    'REN-012 twelve concurrent applications produce one invoice and paid cycle',
    async () => {
      const f = await seed();
      await accept(f);
      const outcomes = await Promise.all(Array.from({ length: 12 }, () => apply(f)));
      assert.equal(outcomes.filter((x) => x === 'applied').length, 1);
      assert.equal(outcomes.filter((x) => x === 'duplicate').length, 11);
      assert.equal((await state(f)).invoices, 2);
    },
  );
  await check(
    'REN-013/014/015 database calendar checks reject a shifted month even under another timezone',
    async () => {
      const f = await seed();
      await accept(f);
      assert.equal(
        await dbAdmin.transaction((tx) =>
          recordAbacatePayRecurringPaymentTx(tx, f.evidence, f.eventId),
        ),
        'recorded',
      );
      await assert.rejects(
        sql.begin(async (tx) => {
          await tx`SET LOCAL TIME ZONE 'Pacific/Auckland'`;
          const [invoice] = await tx<
            { id: string }[]
          >`INSERT INTO public.invoices(clinic_id,subscription_id,total_amount,status,due_date,paid_at,payment_method)
            VALUES(${f.clinicId}::uuid,${f.subscription_id}::uuid,397,'paid',CURRENT_DATE,now(),'CARD') RETURNING id::text`;
          assert.ok(invoice);
          await tx`INSERT INTO billing_gateway.recurring_access_periods(account_id,payment_id,external_subscription_id,
            subscription_id,clinic_id,invoice_id,cycle_index,anchor_start,period_start,period_end,access_effect)
            VALUES(${f.account_id}::uuid,${f.evidence.paymentId},${f.evidence.subscriptionId},${f.subscription_id}::uuid,
              ${f.clinicId}::uuid,${invoice.id}::uuid,2,${f.anchor},${month(f.anchor, 1)},${month(f.anchor, 3)},'review')`;
        }),
        { code: '23514', constraint_name: 'recurring_access_calendar_start' },
      );
    },
  );
  await check(
    'REN-016 unsupported annual readback does not create a new annual sale or advance access',
    async () => {
      const f = await seed();
      await accept(f);
      useHttp(f, { cycle: 'ANNUALLY' });
      const before = await state(f);
      assert.equal((await reconcileAbacatePayInbox({ eventId: f.eventId })).applied, 0);
      assert.deepEqual(await state(f), before);
    },
  );
  await check(
    'REN-017 changed product or partial amount is reviewed before duplicate acknowledgement',
    async () => {
      const before = await state(first);
      for (const e of [
        { ...first.evidence, productId: 'prod_other' },
        { ...first.evidence, paidAmountMinor: 39699 },
        { ...first.evidence, amountMinor: 19700, paidAmountMinor: 19700 },
      ])
        assert.equal(await apply(first, e), 'review');
      assert.deepEqual(await state(first), before);
    },
  );
  await check(
    'REN-019 absent renewal references are not invented from the initial PAID checkout',
    async () => {
      const f = await seed();
      const before = await state(f);
      assert.equal((await reconcileAbacatePayInbox({ eventId: 'log_never_received' })).applied, 0);
      assert.deepEqual(await state(f), before);
    },
  );
  await check(
    'real receiver + HMAC + inbox + HTTP readback + DB application survives duplicate and concurrent reconcile',
    async () => {
      const f = await seed();
      useHttp(f);
      const response = await webhook(notification(f));
      assert.equal(response.status, 202);
      assert.equal((await webhook(notification(f))).status, 200);
      await Promise.all([
        webhook(notification(f)),
        reconcileAbacatePayInbox({ eventId: f.eventId }),
      ]);
      const row = await state(f);
      assert.equal(row.invoices, 2);
      assert.equal(row.cycles, 1);
      const [event] =
        await sql`SELECT state FROM billing_gateway.event_inbox WHERE event_id=${f.eventId}`;
      assert.equal(event?.state, 'applied');
    },
  );
  await check(
    'REN-003/004 late earlier cycle records its own invoice without resetting the current access',
    async () => {
      const f = await seed();
      await accept(f);
      const laterDate = month(f.anchor, 2),
        suffix = randomUUID(),
        later = {
          ...f.evidence,
          checkoutId: `bill_later_${suffix}`,
          paymentId: `char_later_${suffix}`,
          statementId: `tran_later_${suffix}`,
          chargeCreatedAt: laterDate.toISOString(),
          confirmedAt: new Date(laterDate.getTime() + 1000).toISOString(),
        };
      const laterEvent = `log_later_${suffix}`;
      await accept(f, laterEvent, later);
      const outcome = await dbAdmin.transaction((tx) =>
        applyAbacatePayRenewalTx(tx, later, laterEvent, new Date(laterDate.getTime() + 2000)),
      );
      assert.equal(outcome, 'applied');
      const before = await state(f);
      assert.equal(await apply(f), 'historical');
      const after = await state(f);
      assert.equal(after.current_period_end, before.current_period_end);
      assert.equal(after.invoices, 3);
      assert.equal(after.cycles, 2);
    },
  );
  await check(
    'REN-017 a local price change does not grant the pending plan from the old payment',
    async () => {
      const f = await seed();
      await accept(f);
      const [price] = await sql<
        { id: string }[]
      >`SELECT pr.id::text FROM public.prices pr JOIN public.plans p ON p.id=pr.plan_id
      WHERE p.code='consultorio_2026' AND pr.billing_cycle='monthly' LIMIT 1`;
      assert.ok(price);
      await sql`UPDATE public.subscriptions SET price_id=${price.id}::uuid WHERE id=${f.subscription_id}::uuid`;
      const before = await state(f);
      assert.equal(await apply(f), 'review');
      assert.equal((await state(f)).current_period_end, before.current_period_end);
    },
  );
  await check(
    'failure/refund/dispute after success stays in review without undoing paid access',
    async () => {
      const f = await seed();
      await accept(f);
      assert.equal(await apply(f), 'applied');
      const before = await state(f);
      for (const type of [
        'subscription.payment_failed',
        'checkout.refunded',
        'checkout.disputed',
        'checkout.lost',
      ]) {
        const eventId = `log_negative_${randomUUID()}`;
        await accept(f, eventId, f.evidence, type);
        assert.equal((await reconcileAbacatePayInbox({ eventId })).review, 1);
      }
      assert.deepEqual(await state(f), before);
    },
  );
  await check('schema is private, FORCE RLS, service_role read/insert only', async () => {
    const [row] =
      await sql`SELECT count(*)::int n,bool_and(c.relrowsecurity AND c.relforcerowsecurity) rls,
      bool_or(has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) public_access,
      bool_or(has_table_privilege('service_role',c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) excess
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='billing_gateway'
      AND c.relname IN ('recurring_payment_observations','recurring_access_periods')`;
    assert.deepEqual(row, { n: 2, rls: true, public_access: false, excess: false });
  });
  await check('financial and access snapshots are immutable', async () => {
    await assert.rejects(
      sql`UPDATE billing_gateway.recurring_payment_observations SET amount_minor=1 WHERE payment_id=${first.evidence.paymentId}`,
      { code: '23514', constraint_name: 'gateway_snapshot_immutable' },
    );
    await assert.rejects(
      sql`UPDATE billing_gateway.recurring_access_periods SET period_end=period_end+interval '1 day' WHERE payment_id=${first.evidence.paymentId}`,
      { code: '23514', constraint_name: 'gateway_snapshot_immutable' },
    );
  });
  await check('paid period cannot reference an invoice belonging to another tenant', async () => {
    const f = await seed(),
      other = await seed();
    await accept(f);
    assert.equal(
      await dbAdmin.transaction((tx) =>
        recordAbacatePayRecurringPaymentTx(tx, f.evidence, f.eventId),
      ),
      'recorded',
    );
    const [otherInvoice] = await sql<
      { id: string }[]
    >`SELECT id::text FROM public.invoices WHERE clinic_id=${other.clinicId}::uuid`;
    assert.ok(otherInvoice);
    await assert.rejects(
      sql`INSERT INTO billing_gateway.recurring_access_periods(account_id,payment_id,external_subscription_id,
      subscription_id,clinic_id,invoice_id,cycle_index,anchor_start,period_start,period_end,access_effect)
      VALUES(${f.account_id}::uuid,${f.evidence.paymentId},${f.evidence.subscriptionId},${f.subscription_id}::uuid,
        ${f.clinicId}::uuid,${otherInvoice.id}::uuid,1,${f.anchor},${month(f.anchor, 1)},${month(f.anchor, 2)},'review')`,
      { code: '23503' },
    );
  });
  await check(
    'anon/authenticated cannot read private financial evidence, and service cannot update it',
    async () => {
      await assert.rejects(
        sql.begin(async (tx) => {
          await tx`SET LOCAL ROLE anon`;
          await tx`SELECT * FROM billing_gateway.recurring_payment_observations`;
        }),
        { code: '42501' },
      );
      await assert.rejects(
        sql.begin(async (tx) => {
          await tx`SET LOCAL ROLE authenticated`;
          await tx`SELECT * FROM billing_gateway.recurring_access_periods`;
        }),
        { code: '42501' },
      );
      await assert.rejects(
        sql.begin(async (tx) => {
          await tx`SET LOCAL ROLE service_role`;
          await tx`UPDATE billing_gateway.recurring_payment_observations SET amount_minor=1 WHERE false`;
        }),
        { code: '42501' },
      );
    },
  );
  assert.equal(networkCalls, 0);
} catch (error) {
  failure = error;
} finally {
  globalThis.fetch = originalFetch;
  await mkdir('dist', { recursive: true });
  await writeFile(
    'dist/abacatepay-renewal-db.json',
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
console.log(
  JSON.stringify({ status: 'PASS', checks: results.length, networkCalls, fixtureHttpCalls }),
);
