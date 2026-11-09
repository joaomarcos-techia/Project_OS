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
  ABACATEPAY_SANDBOX_PLAN_PRODUCTS:
    '{"clinica_2026_2":"prod_synthetic","clinica_2026_3":"prod_three","consultorio_2026":"prod_one"}',
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
const { requestAbacatePayPlanChange: changePlan } =
  await import('../../src/contexts/billing/internal/abacatepay-plan-changes');
const { assertClinicCanWriteTx } = await import('../../src/lib/tenant-access');
const { reconcileAbacatePayIntegrity: inspectIntegrity } =
  await import('../../src/contexts/billing/internal/abacatepay-integrity');
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
async function seed(endOffsetMs = -120_000, planCode = 'clinica_2026_2') {
  const amount = planCode === 'consultorio_2026' ? 19700 : 39700,
    productId = planCode === 'consultorio_2026' ? 'prod_one' : 'prod_synthetic';
  const userId = randomUUID(),
    email = `${userId}@example.invalid`,
    authCreatedAt = new Date(Date.now() - 55 * 86_400_000);
  await sql`INSERT INTO auth.users(id,email,email_confirmed_at,created_at) VALUES(${userId}::uuid,${email},now(),${authCreatedAt})`;
  const [plan] = await sql<
    { id: string }[]
  >`SELECT id::text FROM public.plans WHERE code=${planCode}`;
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
  const end = new Date(Date.now() + endOffsetMs),
    anchor = month(end, -1);
  await sql`UPDATE billing_gateway.bindings SET external_checkout_id=${origin},external_subscription_id=${externalSub},external_customer_id=${customer}
    WHERE subscription_id=${row.subscription_id}::uuid`;
  await sql`INSERT INTO billing_gateway.checkout_intents(subscription_id,clinic_id,account_id,price_id,product_id,amount_minor)
    VALUES(${row.subscription_id}::uuid,${trial.clinicId}::uuid,${row.account_id}::uuid,${row.price_id}::uuid,${productId},${amount})`;
  // Explicit synthetic S0, not a simulated or claimed external first payment.
  const [invoice] = await sql<
    { id: string }[]
  >`INSERT INTO public.invoices(clinic_id,subscription_id,total_amount,status,due_date,period_start,period_end,paid_at,payment_method)
    VALUES(${trial.clinicId}::uuid,${row.subscription_id}::uuid,${amount / 100},'paid',${anchor.toISOString().slice(0, 10)},
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
    productId,
    paymentId: `char_${suffix}`,
    statementId: `tran_${suffix}`,
    amountMinor: amount,
    paidAmountMinor: amount,
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
async function financialFingerprint(f: Fixture) {
  const [row] = await sql`SELECT md5(row_to_json(s)::text) subscription,
    (SELECT md5(string_agg(row_to_json(i)::text,'' ORDER BY i.id)) FROM public.invoices i WHERE i.clinic_id=s.clinic_id) invoices,
    (SELECT count(*)::int FROM billing_gateway.operations o WHERE o.clinic_id=s.clinic_id) commands,
    (SELECT count(*)::int FROM public.profiles p WHERE p.clinic_id=s.clinic_id) profiles
    FROM public.subscriptions s WHERE s.id=${f.subscription_id}::uuid`;
  assert.ok(row);
  return row;
}
const inspect = (f: Fixture) =>
  inspectIntegrity(dbAdmin, { checkoutId: f.evidence.originCheckoutId, maxCandidates: 1 });
async function expireIntegrityCheck(f: Fixture) {
  // Synthetic audit age only, not a provider cycle or clock change.
  await sql`UPDATE public.billing_events SET created_at=now()-interval '2 hours'
    WHERE clinic_id=${f.clinicId}::uuid AND type='subscription.recurrence.checked'`;
}
function installHttpFixture(
  f: Fixture,
  options: {
    fail?: boolean;
    cycle?: string;
    status?: string;
    refundMinor?: number;
    reversal?: boolean;
    refundedCheckoutId?: string;
    extraSubscription?: boolean;
    emptySubscriptions?: boolean;
  } = {},
) {
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
          data: options.emptySubscriptions
            ? []
            : [
                subscription,
                ...(options.extraSubscription
                  ? [{ ...subscription, id: 'subs_unexpected', customerId: 'cust_unexpected' }]
                  : []),
              ],
          pagination: { hasMore: false, next: null },
        });
      case '/v2/subscriptions/checkouts/get':
        data = {
          id: url.searchParams.get('id') ?? f.evidence.checkoutId,
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
              checkoutId: options.refundedCheckoutId ?? f.evidence.checkoutId,
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
                ...(options.refundMinor
                  ? [{ amount: options.refundMinor, category: 'refund', balanceEffect: 'debit' }]
                  : []),
                ...(options.reversal
                  ? [{ amount: 39700, category: 'reversal', balanceEffect: 'credit' }]
                  : []),
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
let planPosts = 0;
function installPlanHttpFixture(f: Fixture, loseResponse = false) {
  globalThis.fetch = async (target, init) => {
    fixtureHttpCalls++;
    const url = new URL(String(target));
    assert.equal(url.origin, 'https://api.abacatepay.com');
    const prices: Record<string, number> = {
      prod_probe: 100,
      prod_synthetic: 39700,
      prod_one: 19700,
      prod_three: 54400,
    };
    let data: unknown;
    if (url.pathname.endsWith('/stores/get')) data = { id: account.accountId };
    else if (url.pathname.endsWith('/products/get'))
      data = {
        id: url.searchParams.get('id'),
        externalId: 'synthetic-plan',
        price: prices[url.searchParams.get('id') ?? ''],
        currency: 'BRL',
        cycle: 'MONTHLY',
        trialDays: null,
        devMode: true,
      };
    else if (url.pathname.endsWith('/subscriptions/get'))
      data = {
        id: f.evidence.subscriptionId,
        checkoutId: f.evidence.originCheckoutId,
        customerId: f.evidence.customerId,
        amount: f.evidence.amountMinor,
        status: 'ACTIVE',
        method: 'CARD',
        devMode: true,
        trialEndsAt: null,
        createdAt: f.anchor.toISOString(),
      };
    else if (url.pathname.endsWith('/checkouts/get'))
      data = {
        id: f.evidence.originCheckoutId,
        frequency: 'SUBSCRIPTION',
        customerId: f.evidence.customerId,
        amount: f.evidence.amountMinor,
        paidAmount: f.evidence.amountMinor,
        status: 'PAID',
        devMode: true,
        items: [{ id: f.evidence.productId, quantity: 1 }],
      };
    else if (url.pathname.endsWith('/change-plan')) {
      assert.equal(init?.method, 'POST');
      planPosts++;
      const body = JSON.parse(String(init.body));
      assert.equal(body.id, f.evidence.subscriptionId);
      if (loseResponse) throw Error('Synthetic plan response lost after effect');
      data = {
        id: `subu_${randomUUID().replaceAll('-', '')}`,
        subscriptionId: body.id,
        productId: body.productId,
        quantity: 1,
        status: 'PENDING',
        newAmount: prices[body.productId],
      };
    } else throw Error('Unexpected synthetic plan route');
    return Response.json({ success: true, data });
  };
}
async function targetPlan(code: string) {
  const [row] = await sql<{ id: string }[]>`SELECT id::text FROM public.plans WHERE code=${code}`;
  assert.ok(row);
  return row.id;
}
async function projection(f: Fixture) {
  const [row] = await sql`SELECT s.plan_id::text,s.price_id::text,p.code FROM public.subscriptions s
  JOIN public.plans p ON p.id=s.plan_id WHERE s.id=${f.subscription_id}::uuid`;
  assert.ok(row);
  return row;
}
function changedEvidence(f: Fixture, amount: number, productId: string): Evidence {
  return { ...f.evidence, amountMinor: amount, paidAmountMinor: amount, productId };
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
  await sql`UPDATE public.plans SET ativo=true WHERE code IN ('clinica_2026_2','clinica_2026_3','consultorio_2026')`;
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
      const duplicateEvent = `log_review_duplicate_${randomUUID()}`;
      await accept(f, duplicateEvent);
      assert.equal(
        await apply(f, f.evidence, duplicateEvent),
        'review',
        'A replay must not turn a retained review into successful application',
      );
      assert.deepEqual(await state(f), after);
    },
  );
  await check(
    'REN-009/010 API outage remains retryable, then the same legitimate event regularizes once',
    async () => {
      const f = await seed();
      await accept(f);
      installHttpFixture(f, { fail: true });
      assert.equal((await reconcileAbacatePayInbox({ eventId: f.eventId })).retry, true);
      assert.equal((await state(f)).invoices, 1);
      installHttpFixture(f);
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
      installHttpFixture(f, { cycle: 'ANNUALLY' });
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
      installHttpFixture(f);
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
      installHttpFixture(f);
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
  await check(
    'L3 negative event already bound to another tenant cannot be rebound by remote identifiers',
    async () => {
      const f = await seed(),
        other = await seed();
      await accept(f);
      assert.equal(await apply(f), 'applied');
      const before = await state(f),
        eventId = `log_bound_negative_${randomUUID()}`;
      await accept(f, eventId, f.evidence, 'checkout.refunded');
      await sql`UPDATE billing_gateway.event_inbox SET subscription_id=${other.subscription_id}::uuid,
        clinic_id=${other.clinicId}::uuid WHERE event_id=${eventId}`;
      installHttpFixture(f, { refundMinor: 39700 });
      const reads = fixtureHttpCalls;
      assert.equal((await reconcileAbacatePayInbox({ eventId })).review, 1);
      assert.equal(fixtureHttpCalls, reads);
      const [audit] = await sql`SELECT count(*)::int n FROM public.billing_events
        WHERE type='subscription.financial.notification_checked' AND payload->>'eventId'=${eventId}`;
      assert.deepEqual(audit, { n: 0 });
      const [binding] =
        await sql`SELECT subscription_id::text,clinic_id::text FROM billing_gateway.event_inbox
        WHERE event_id=${eventId}`;
      assert.deepEqual(binding, {
        subscription_id: other.subscription_id,
        clinic_id: other.clinicId,
      });
      assert.deepEqual(await state(f), before);
    },
  );
  await check(
    'L1 an expired worker lease recovers the same renewal after process interruption',
    async () => {
      const f = await seed();
      await accept(f);
      await sql`UPDATE billing_gateway.event_inbox SET state='processing',attempts=1,
        lease_token=gen_random_uuid(),lease_until=now()-interval '1 second' WHERE event_id=${f.eventId}`;
      installHttpFixture(f);
      assert.equal((await reconcileAbacatePayInbox({ eventId: f.eventId })).applied, 1);
      const before = await state(f);
      assert.equal(before.invoices, 2);
      assert.equal((await reconcileAbacatePayInbox({ eventId: f.eventId })).applied, 0);
      assert.deepEqual(await state(f), before);
    },
  );
  await check(
    'L6 interruption of the final lease moves to review without an eleventh provider read',
    async () => {
      const f = await seed();
      await accept(f);
      await sql`UPDATE billing_gateway.event_inbox SET state='processing',attempts=10,
        lease_token=gen_random_uuid(),lease_until=now()-interval '1 second' WHERE event_id=${f.eventId}`;
      installHttpFixture(f);
      const reads = fixtureHttpCalls,
        before = await state(f);
      assert.equal((await reconcileAbacatePayInbox({ eventId: f.eventId })).review, 1);
      assert.equal(fixtureHttpCalls, reads);
      assert.deepEqual(await state(f), before);
      const [event] =
        await sql`SELECT state,outcome_code FROM billing_gateway.event_inbox WHERE event_id=${f.eventId}`;
      assert.deepEqual(event, { state: 'review', outcome_code: 'worker_attempts_exhausted' });
    },
  );
  await check(
    'L3 a negative-event worker that loses its lease cannot commit an audit or grace change',
    async () => {
      const f = await seed();
      await accept(f);
      assert.equal(await apply(f), 'applied');
      const eventId = `log_lease_negative_${randomUUID()}`;
      await accept(f, eventId, f.evidence, 'checkout.refunded');
      installHttpFixture(f, { refundMinor: 39700 });
      const provider = globalThis.fetch;
      let expired = false;
      globalThis.fetch = async (target, init) => {
        if (!expired) {
          expired = true;
          await sql`UPDATE billing_gateway.event_inbox SET lease_until=now()-interval '1 second'
            WHERE event_id=${eventId} AND state='processing'`;
        }
        return provider(target, init);
      };
      assert.equal((await reconcileAbacatePayInbox({ eventId })).retry, true);
      const [before] = await sql`SELECT grace_period_until>current_period_end retained,
        (SELECT count(*)::int FROM public.billing_events WHERE payload->>'eventId'=${eventId}) audits
        FROM public.subscriptions WHERE id=${f.subscription_id}::uuid`;
      assert.deepEqual(before, { retained: true, audits: 0 });
      installHttpFixture(f, { refundMinor: 39700 });
      assert.equal((await reconcileAbacatePayInbox({ eventId })).review, 1);
      const [after] = await sql`SELECT grace_period_until=current_period_end bounded,
        (SELECT count(*)::int FROM public.billing_events WHERE payload->>'eventId'=${eventId}) audits
        FROM public.subscriptions WHERE id=${f.subscription_id}::uuid`;
      assert.deepEqual(after, { bounded: true, audits: 1 });
    },
  );
  await check(
    'L3 negative-event audit failure rolls back access policy and inbox, then replay commits once',
    async () => {
      const f = await seed();
      await accept(f);
      assert.equal(await apply(f), 'applied');
      const eventId = `log_rollback_negative_${randomUUID()}`;
      await accept(f, eventId, f.evidence, 'checkout.refunded');
      installHttpFixture(f, { refundMinor: 39700 });
      await sql.unsafe(`CREATE FUNCTION public.synthetic_negative_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.type='subscription.financial.notification_checked' THEN
          RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER synthetic_negative_audit_failure BEFORE INSERT ON public.billing_events
          FOR EACH ROW EXECUTE FUNCTION public.synthetic_negative_audit_failure();`);
      try {
        assert.equal((await reconcileAbacatePayInbox({ eventId })).retry, true);
        const [row] = await sql`SELECT s.grace_period_until>s.current_period_end retained,e.state,
          (SELECT count(*)::int FROM public.billing_events WHERE payload->>'eventId'=${eventId}) audits
          FROM public.subscriptions s JOIN billing_gateway.event_inbox e ON e.event_id=${eventId}
          WHERE s.id=${f.subscription_id}::uuid`;
        assert.deepEqual(row, { retained: true, state: 'received', audits: 0 });
      } finally {
        await sql.unsafe(`DROP TRIGGER synthetic_negative_audit_failure ON public.billing_events;
          DROP FUNCTION public.synthetic_negative_audit_failure();`);
      }
      assert.equal((await reconcileAbacatePayInbox({ eventId })).review, 1);
      const [row] =
        await sql`SELECT count(*)::int n FROM public.billing_events WHERE payload->>'eventId'=${eventId}`;
      assert.deepEqual(row, { n: 1 });
    },
  );
  await check(
    'L3 a negative notification in the Asaas namespace cannot affect AbacatePay or trigger remote reads',
    async () => {
      const f = await seed();
      await accept(f);
      assert.equal(await apply(f), 'applied');
      const eventId = `log_asaas_negative_${randomUUID()}`;
      const reads = fixtureHttpCalls;
      // A notification naming a different provider account is never selected.
      await sql`INSERT INTO billing_gateway.accounts(provider,environment,external_account_id)
        VALUES('asaas','sandbox',${account.accountId}) ON CONFLICT DO NOTHING`;
      const wrongInbox = createPostgresGatewayInbox({ ...account, provider: 'asaas' }, dbAdmin);
      await wrongInbox.accept(
        {
          eventId,
          eventType: 'checkout.disputed',
          subscriptionId: f.evidence.subscriptionId,
          customerId: f.evidence.customerId,
          checkoutId: f.evidence.checkoutId,
          paymentId: f.evidence.paymentId,
        },
        createHash('sha256').update(eventId).digest('hex'),
      );
      const before = await state(f);
      const result = await reconcileAbacatePayInbox({ eventId });
      assert.equal(result.scanned, 0);
      assert.equal(fixtureHttpCalls, reads);
      assert.deepEqual(await state(f), before);
    },
  );
  await check(
    'H2 full/partial refund observations are idempotent and never cancel access or alter the paid invoice',
    async () => {
      for (const amount of [10000, 39700]) {
        const f = await seed();
        await accept(f);
        assert.equal(await apply(f), 'applied');
        const before = await state(f),
          eventId = `log_refund_${randomUUID()}`;
        await accept(f, eventId, f.evidence, 'checkout.refunded');
        installHttpFixture(f, { fail: true });
        assert.equal((await reconcileAbacatePayInbox({ eventId })).retry, true);
        installHttpFixture(f, { refundMinor: amount });
        const results = await Promise.all(
          Array.from({ length: 8 }, () => reconcileAbacatePayInbox({ eventId })),
        );
        assert.ok(results.some((r) => r.review === 1));
        await reconcileAbacatePayInbox({ eventId });
        assert.deepEqual(await state(f), before);
        const [row] =
          await sql`SELECT count(*)::int n,min(payload->>'refundDebitMinor') amount,min(payload->>'evidenceLevel') level
        FROM public.billing_events WHERE clinic_id=${f.clinicId}::uuid AND type='subscription.financial.notification_checked' AND payload->>'eventId'=${eventId}`;
        assert.deepEqual(row, { n: 1, amount: String(amount), level: 'refund_debit_verified' });
        const [period] = await sql`SELECT grace_period_until=current_period_end at_paid_end
          FROM public.subscriptions WHERE id=${f.subscription_id}::uuid`;
        assert.ok(period);
        assert.equal(period.at_paid_end, true);
        await dbAdmin.transaction((tx) => assertClinicCanWriteTx(tx, f.clinicId));
        // Controlled local clock projection only: do not claim real month-long observation.
        await sql`UPDATE public.subscriptions SET current_period_end=now()-interval '1 second',
          grace_period_until=now()-interval '1 second' WHERE id=${f.subscription_id}::uuid`;
        await assert.rejects(
          dbAdmin.transaction((tx) => assertClinicCanWriteTx(tx, f.clinicId)),
          { code: 'clinic_write_blocked' },
        );
      }
    },
  );
  await check(
    'H2 a verified refund of an older cycle cannot shorten a newer paid cycle',
    async () => {
      const f = await seed();
      await accept(f);
      assert.equal(await apply(f), 'applied');
      const before = await state(f);
      const [graceBefore] =
        await sql`SELECT grace_period_until::text value FROM public.subscriptions
      WHERE id=${f.subscription_id}::uuid`;
      const eventId = `log_old_refund_${randomUUID()}`;
      await accept(
        f,
        eventId,
        { ...f.evidence, checkoutId: f.evidence.originCheckoutId },
        'checkout.refunded',
      );
      installHttpFixture(f, {
        refundMinor: 39700,
        refundedCheckoutId: f.evidence.originCheckoutId,
      });
      assert.equal((await reconcileAbacatePayInbox({ eventId })).review, 1);
      assert.deepEqual(await state(f), before);
      const [graceAfter] = await sql`SELECT grace_period_until::text value FROM public.subscriptions
      WHERE id=${f.subscription_id}::uuid`;
      assert.deepEqual(graceAfter, graceBefore);
      const [audit] =
        await sql`SELECT payload->>'evidenceLevel' level,payload->>'accessEffect' effect
      FROM public.billing_events WHERE clinic_id=${f.clinicId}::uuid
        AND type='subscription.financial.notification_checked' AND payload->>'eventId'=${eventId}`;
      assert.deepEqual(audit, {
        level: 'refund_debit_verified',
        effect: 'keep_paid_period_human_review',
      });
      await dbAdmin.transaction((tx) => assertClinicCanWriteTx(tx, f.clinicId));
    },
  );
  await check(
    'H2 a reversal is recorded as ambiguous rather than a won dispute or restored payment',
    async () => {
      const f = await seed();
      await accept(f);
      assert.equal(await apply(f), 'applied');
      const before = await state(f),
        eventId = `log_reversal_${randomUUID()}`;
      await accept(f, eventId, f.evidence, 'checkout.refunded');
      installHttpFixture(f, { refundMinor: 39700, reversal: true });
      assert.equal((await reconcileAbacatePayInbox({ eventId })).review, 1);
      const [row] =
        await sql`SELECT payload->>'evidenceLevel' level,payload->>'reversalObserved' reversal FROM public.billing_events
      WHERE clinic_id=${f.clinicId}::uuid AND type='subscription.financial.notification_checked'`;
      assert.deepEqual(row, { level: 'status_only', reversal: 'true' });
      assert.deepEqual(await state(f), before);
    },
  );
  await check(
    'H4 extra doctor is scheduled once under concurrency and released only by its full paid renewal',
    async () => {
      const f = await seed(86_400_000),
        targetPlanId = await targetPlan('clinica_2026_3');
      installPlanHttpFixture(f);
      const beforePosts = planPosts,
        before = await projection(f),
        financial = await state(f);
      const request = () =>
        changePlan(dbAdmin, {
          clinicId: f.clinicId,
          requestedBy: f.userId,
          contractId: f.subscription_id,
          targetPlanId,
        });
      const results = await Promise.allSettled(Array.from({ length: 12 }, request));
      assert.ok(results.some((r) => r.status === 'fulfilled'));
      await request();
      assert.equal(planPosts - beforePosts, 1);
      assert.deepEqual(await projection(f), before);
      assert.deepEqual(await state(f), financial);
      const [one] =
        await sql`SELECT count(*)::int n FROM billing_gateway.plan_changes WHERE clinic_id=${f.clinicId}::uuid`;
      assert.deepEqual(one, { n: 1 });
      const evidence = changedEvidence(f, 54400, 'prod_three');
      await accept(f, f.eventId, evidence);
      const outcomes = await Promise.all(
        Array.from({ length: 12 }, () =>
          dbAdmin.transaction((tx) =>
            applyAbacatePayRenewalTx(tx, evidence, f.eventId, new Date(f.end.getTime() + 2000)),
          ),
        ),
      );
      assert.equal(outcomes.filter((v) => v === 'applied').length, 1);
      assert.equal(outcomes.filter((v) => v === 'duplicate').length, 11);
      assert.equal((await projection(f)).code, 'clinica_2026_3');
      assert.equal((await state(f)).invoices, 2);
      const [applied] =
        await sql`SELECT invoice_id IS NOT NULL applied FROM billing_gateway.plan_changes WHERE clinic_id=${f.clinicId}::uuid`;
      assert.deepEqual(applied, { applied: true });
      const nextDate = month(f.end, 1),
        suffix = randomUUID(),
        next = {
          ...evidence,
          paymentId: `char_next_${suffix}`,
          checkoutId: `bill_next_${suffix}`,
          statementId: `tran_next_${suffix}`,
          chargeCreatedAt: nextDate.toISOString(),
          confirmedAt: new Date(nextDate.getTime() + 1000).toISOString(),
        };
      const nextEvent = `log_next_${suffix}`;
      await accept(f, nextEvent, next);
      assert.equal(
        await dbAdmin.transaction((tx) =>
          applyAbacatePayRenewalTx(tx, next, nextEvent, new Date(nextDate.getTime() + 2000)),
        ),
        'applied',
      );
      assert.equal((await state(f)).invoices, 3);
      assert.equal((await projection(f)).code, 'clinica_2026_3');
    },
  );
  await check(
    'H4 Consultorio to Clinica upgrade keeps the original plan until full next-cycle payment',
    async () => {
      const f = await seed(86_400_000, 'consultorio_2026'),
        targetPlanId = await targetPlan('clinica_2026_2');
      installPlanHttpFixture(f);
      await changePlan(dbAdmin, {
        clinicId: f.clinicId,
        requestedBy: f.userId,
        contractId: f.subscription_id,
        targetPlanId,
      });
      assert.equal((await projection(f)).code, 'consultorio_2026');
      const evidence = changedEvidence(f, 39700, 'prod_synthetic');
      await accept(f, f.eventId, evidence);
      assert.equal(
        await dbAdmin.transaction((tx) =>
          applyAbacatePayRenewalTx(tx, evidence, f.eventId, new Date(f.end.getTime() + 2000)),
        ),
        'applied',
      );
      assert.equal((await projection(f)).code, 'clinica_2026_2');
    },
  );
  await check(
    'H4 downgrade reserves target capacity and applies only its lower fully paid cycle',
    async () => {
      const f = await seed(86_400_000),
        targetPlanId = await targetPlan('consultorio_2026');
      installPlanHttpFixture(f);
      const doctor = await sql<
        { id: string }[]
      >`INSERT INTO auth.users(id,email,created_at) VALUES(gen_random_uuid(),'synthetic-doctor@example.invalid',now()) RETURNING id::text`;
      const id = doctor[0]?.id;
      assert.ok(id);
      await sql`INSERT INTO public.profiles(id,clinic_id,nome,role,crm,ativo) VALUES(${id}::uuid,${f.clinicId}::uuid,'Synthetic doctor','doctor','SYNTHETIC',true)`;
      // Owner is administrative, so one doctor fits; the next would exhaust the downgrade.
      await sql`UPDATE public.profiles SET crm='SYNTHETIC-OWNER' WHERE id=${f.userId}::uuid`;
      const beforePosts = planPosts;
      const request = () =>
        changePlan(dbAdmin, {
          clinicId: f.clinicId,
          requestedBy: f.userId,
          contractId: f.subscription_id,
          targetPlanId,
        });
      await assert.rejects(
        request(),
        (e: unknown) =>
          e instanceof Error && 'code' in e && e.code === 'downgrade_capacity_exceeded',
      );
      assert.equal(planPosts, beforePosts);
      await sql`UPDATE public.profiles SET ativo=false WHERE id=${id}::uuid`;
      await request();
      await assert.rejects(sql`UPDATE public.profiles SET ativo=true WHERE id=${id}::uuid`, {
        code: '23514',
        constraint_name: 'gateway_pending_seat_limit',
      });
      assert.equal((await projection(f)).code, 'clinica_2026_2');
      const evidence = changedEvidence(f, 19700, 'prod_one');
      await accept(f, f.eventId, evidence);
      assert.equal(
        await dbAdmin.transaction((tx) =>
          applyAbacatePayRenewalTx(tx, evidence, f.eventId, new Date(f.end.getTime() + 2000)),
        ),
        'applied',
      );
      assert.equal((await projection(f)).code, 'consultorio_2026');
    },
  );
  await check(
    'L2 cancellation during a plan command preserves paid evidence without releasing the target quota',
    async () => {
      const f = await seed(86_400_000),
        targetPlanId = await targetPlan('clinica_2026_3');
      installPlanHttpFixture(f);
      const provider = globalThis.fetch;
      globalThis.fetch = async (target, init) => {
        if (new URL(String(target)).pathname.endsWith('/change-plan')) {
          // Interleave a cancellation after the intent committed, but before
          // the remote plan command acknowledgement returns to the caller.
          await sql`INSERT INTO billing_gateway.cancellations(account_id,external_subscription_id,subscription_id,clinic_id,
            external_customer_id,external_checkout_id,paid_period_start,paid_period_end,requested_by)
            VALUES(${f.account_id}::uuid,${f.evidence.subscriptionId},${f.subscription_id}::uuid,${f.clinicId}::uuid,
              ${f.evidence.customerId},${f.evidence.originCheckoutId},${f.anchor},${f.end},${f.userId}::uuid)`;
        }
        return provider(target, init);
      };
      await changePlan(dbAdmin, {
        clinicId: f.clinicId,
        requestedBy: f.userId,
        contractId: f.subscription_id,
        targetPlanId,
      });
      const evidence = changedEvidence(f, 54400, 'prod_three');
      await accept(f, f.eventId, evidence);
      assert.equal(
        await dbAdmin.transaction((tx) =>
          applyAbacatePayRenewalTx(tx, evidence, f.eventId, new Date(f.end.getTime() + 2000)),
        ),
        'review',
      );
      assert.equal((await projection(f)).code, 'clinica_2026_2');
      const before = await state(f);
      assert.equal(before.invoices, 2);
      assert.equal(
        await dbAdmin.transaction((tx) =>
          applyAbacatePayRenewalTx(tx, evidence, f.eventId, new Date(f.end.getTime() + 2000)),
        ),
        'review',
      );
      assert.deepEqual(await state(f), before);
      const [intent] = await sql`SELECT invoice_id IS NULL pending FROM billing_gateway.plan_changes
        WHERE clinic_id=${f.clinicId}::uuid`;
      assert.deepEqual(intent, { pending: true });
    },
  );
  await check(
    'H4 lost plan-change response retains one obligation and never overwrites it with another POST',
    async () => {
      const f = await seed(86_400_000),
        targetPlanId = await targetPlan('clinica_2026_3');
      installPlanHttpFixture(f, true);
      const before = planPosts;
      const request = () =>
        changePlan(dbAdmin, {
          clinicId: f.clinicId,
          requestedBy: f.userId,
          contractId: f.subscription_id,
          targetPlanId,
        });
      await assert.rejects(request());
      await assert.rejects(request());
      assert.equal(planPosts - before, 1);
      await assert.rejects(
        changePlan(dbAdmin, {
          clinicId: f.clinicId,
          requestedBy: f.userId,
          contractId: f.subscription_id,
          targetPlanId: await targetPlan('consultorio_2026'),
        }),
      );
      assert.equal(planPosts - before, 1);
      assert.equal((await projection(f)).code, 'clinica_2026_2');
      const evidence = changedEvidence(f, 54400, 'prod_three');
      await accept(f, f.eventId, evidence);
      assert.equal(
        await dbAdmin.transaction((tx) =>
          applyAbacatePayRenewalTx(tx, evidence, f.eventId, new Date(f.end.getTime() + 2000)),
        ),
        'applied',
      );
    },
  );
  await check(
    'H4 another tenant, stale generation and cancelled contract cannot submit a plan command',
    async () => {
      const f = await seed(86_400_000),
        other = await seed(),
        targetPlanId = await targetPlan('clinica_2026_3');
      installPlanHttpFixture(f);
      const before = planPosts;
      for (const input of [
        { requestedBy: other.userId, contractId: f.subscription_id },
        { requestedBy: f.userId, contractId: randomUUID() },
      ])
        await assert.rejects(changePlan(dbAdmin, { clinicId: f.clinicId, targetPlanId, ...input }));
      await sql`UPDATE public.subscriptions SET cancel_at_period_end=true WHERE id=${f.subscription_id}::uuid`;
      await assert.rejects(
        changePlan(dbAdmin, {
          clinicId: f.clinicId,
          targetPlanId,
          requestedBy: f.userId,
          contractId: f.subscription_id,
        }),
      );
      assert.equal(planPosts, before);
    },
  );
  await check(
    'H4 old amount, partial payment and early target payment cannot release the new plan',
    async () => {
      for (const mode of ['old', 'partial', 'early']) {
        const f = await seed(86_400_000),
          targetPlanId = await targetPlan('clinica_2026_3');
        installPlanHttpFixture(f);
        await changePlan(dbAdmin, {
          clinicId: f.clinicId,
          targetPlanId,
          requestedBy: f.userId,
          contractId: f.subscription_id,
        });
        const target = changedEvidence(f, 54400, 'prod_three');
        const evidence =
          mode === 'old'
            ? f.evidence
            : mode === 'partial'
              ? { ...target, paidAmountMinor: 54399 }
              : {
                  ...target,
                  chargeCreatedAt: f.anchor.toISOString(),
                  confirmedAt: new Date(f.anchor.getTime() + 1000).toISOString(),
                };
        await accept(f, f.eventId, evidence);
        assert.notEqual(
          await dbAdmin.transaction((tx) =>
            applyAbacatePayRenewalTx(tx, evidence, f.eventId, new Date(f.end.getTime() + 2000)),
          ),
          'applied',
        );
        assert.equal((await projection(f)).code, 'clinica_2026_2');
      }
    },
  );
  await check(
    'H4 rollback keeps both plan and pending intent before a successful payment replay',
    async () => {
      const f = await seed(86_400_000),
        targetPlanId = await targetPlan('clinica_2026_3');
      installPlanHttpFixture(f);
      await changePlan(dbAdmin, {
        clinicId: f.clinicId,
        targetPlanId,
        requestedBy: f.userId,
        contractId: f.subscription_id,
      });
      const evidence = changedEvidence(f, 54400, 'prod_three');
      await accept(f, f.eventId, evidence);
      const before = await state(f);
      await assert.rejects(
        dbAdmin.transaction(async (tx) => {
          assert.equal(
            await applyAbacatePayRenewalTx(
              tx,
              evidence,
              f.eventId,
              new Date(f.end.getTime() + 2000),
            ),
            'applied',
          );
          throw Error('Synthetic rollback');
        }),
      );
      assert.deepEqual(await state(f), before);
      assert.equal((await projection(f)).code, 'clinica_2026_2');
      assert.equal(
        await dbAdmin.transaction((tx) =>
          applyAbacatePayRenewalTx(tx, evidence, f.eventId, new Date(f.end.getTime() + 2000)),
        ),
        'applied',
      );
    },
  );
  await check(
    'L3 integrity scan observes a healthy recurrence without altering any financial state',
    async () => {
      const f = await seed(),
        before = await financialFingerprint(f);
      installHttpFixture(f);
      assert.deepEqual(await inspect(f), { scanned: 1, reviews: 0, failed: 0, deferred: false });
      assert.deepEqual(await financialFingerprint(f), before);
      const reads = fixtureHttpCalls;
      assert.equal((await inspect(f)).scanned, 0);
      assert.equal(fixtureHttpCalls, reads);
    },
  );
  await check(
    'L3 sixteen integrity workers reserve one scan and record one duplicate-recurrence incident',
    async () => {
      const f = await seed(),
        before = await financialFingerprint(f);
      installHttpFixture(f, { extraSubscription: true });
      const results = await Promise.all(Array.from({ length: 16 }, () => inspect(f)));
      assert.equal(
        results.reduce((sum, r) => sum + r.scanned, 0),
        1,
      );
      assert.equal(
        results.reduce((sum, r) => sum + r.reviews, 0),
        1,
      );
      const [audit] = await sql`SELECT count(*)::int n,min(payload->>'issue') issue
      FROM public.billing_events WHERE clinic_id=${f.clinicId}::uuid AND type='subscription.recurrence.review_required'`;
      assert.deepEqual(audit, { n: 1, issue: 'multiple_subscriptions' });
      assert.deepEqual(await financialFingerprint(f), before);
      await expireIntegrityCheck(f);
      assert.equal((await inspect(f)).reviews, 0);
      const [again] = await sql`SELECT count(*)::int n FROM public.billing_events
      WHERE clinic_id=${f.clinicId}::uuid AND type='subscription.recurrence.review_required'`;
      assert.deepEqual(again, { n: 1 });
    },
  );
  await check(
    'L4 integrity API outage is audited and resumes after backoff without granting or charging',
    async () => {
      const f = await seed(),
        before = await financialFingerprint(f);
      installHttpFixture(f, { fail: true });
      assert.equal((await inspect(f)).failed, 1);
      const [failure] = await sql`SELECT count(*)::int n FROM public.billing_events
      WHERE clinic_id=${f.clinicId}::uuid AND type='subscription.recurrence.check_failed'`;
      assert.deepEqual(failure, { n: 1 });
      const reads = fixtureHttpCalls;
      assert.equal((await inspect(f)).scanned, 0);
      assert.equal(fixtureHttpCalls, reads);
      await expireIntegrityCheck(f);
      installHttpFixture(f);
      assert.equal((await inspect(f)).failed, 0);
      assert.deepEqual(await financialFingerprint(f), before);
    },
  );
  await check(
    'L3 integrity review persistence failure rolls back observation and permits a later retry',
    async () => {
      const f = await seed(),
        before = await financialFingerprint(f);
      installHttpFixture(f, { extraSubscription: true });
      await sql.unsafe(`CREATE FUNCTION public.synthetic_integrity_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.type='subscription.recurrence.review_required' THEN RAISE EXCEPTION 'Synthetic integrity persistence failure'; END IF;
      RETURN NEW; END $$; CREATE TRIGGER synthetic_integrity_failure BEFORE INSERT ON public.billing_events
        FOR EACH ROW EXECUTE FUNCTION public.synthetic_integrity_failure();`);
      try {
        assert.equal((await inspect(f)).failed, 1);
        const [row] =
          await sql`SELECT count(*)::int n FROM public.billing_events WHERE clinic_id=${f.clinicId}::uuid
        AND type IN ('subscription.recurrence.observed','subscription.recurrence.review_required')`;
        assert.deepEqual(row, { n: 0 });
      } finally {
        await sql.unsafe(
          `DROP TRIGGER synthetic_integrity_failure ON public.billing_events; DROP FUNCTION public.synthetic_integrity_failure();`,
        );
      }
      await expireIntegrityCheck(f);
      assert.equal((await inspect(f)).reviews, 1);
      assert.deepEqual(await financialFingerprint(f), before);
    },
  );
  await check(
    'L5 unexpected cancellation signals review without revoking paid access',
    async () => {
      const f = await seed(),
        before = await financialFingerprint(f);
      installHttpFixture(f, { status: 'CANCELLED' });
      assert.equal((await inspect(f)).reviews, 1);
      const [row] = await sql`SELECT payload->>'issue' issue FROM public.billing_events
      WHERE clinic_id=${f.clinicId}::uuid AND type='subscription.recurrence.review_required'`;
      assert.deepEqual(row, { issue: 'unexpected_cancellation' });
      assert.deepEqual(await financialFingerprint(f), before);
    },
  );
  await check(
    'L5 an owned cancellation is not reported as an unexpected remote cancellation',
    async () => {
      const f = await seed();
      await sql`INSERT INTO billing_gateway.cancellations(account_id,external_subscription_id,subscription_id,clinic_id,
      external_customer_id,external_checkout_id,paid_period_start,paid_period_end,requested_by)
      VALUES(${f.account_id}::uuid,${f.evidence.subscriptionId},${f.subscription_id}::uuid,${f.clinicId}::uuid,
        ${f.evidence.customerId},${f.evidence.originCheckoutId},${f.anchor},${f.end},${f.userId}::uuid)`;
      const before = await financialFingerprint(f);
      installHttpFixture(f, { status: 'CANCELLED' });
      assert.equal((await inspect(f)).reviews, 0);
      assert.deepEqual(await financialFingerprint(f), before);
    },
  );
  await check(
    'L4 provider records for another tenant cannot be rebound by the integrity scanner',
    async () => {
      const f = await seed(),
        other = await seed(),
        before = await financialFingerprint(f),
        otherBefore = await financialFingerprint(other);
      installHttpFixture(other, { extraSubscription: true });
      assert.equal((await inspect(f)).failed, 1);
      assert.deepEqual(await financialFingerprint(f), before);
      assert.deepEqual(await financialFingerprint(other), otherBefore);
    },
  );
  await check(
    'L4 scan with insufficient time performs neither provider reads nor an audit reservation',
    async () => {
      const f = await seed(),
        reads = fixtureHttpCalls;
      assert.deepEqual(
        await inspectIntegrity(dbAdmin, {
          checkoutId: f.evidence.originCheckoutId,
          deadlineMs: Date.now() + 1000,
        }),
        { scanned: 0, reviews: 0, failed: 0, deferred: true },
      );
      assert.equal(fixtureHttpCalls, reads);
      const [row] =
        await sql`SELECT count(*)::int n FROM public.billing_events WHERE clinic_id=${f.clinicId}::uuid AND type='subscription.recurrence.checked'`;
      assert.deepEqual(row, { n: 0 });
    },
  );
  await check(
    'L3 pending recontract and old generation are inspected separately without granting a new trial',
    async () => {
      const f = await seed();
      await sql`UPDATE public.subscriptions SET cancel_at_period_end=true WHERE id=${f.subscription_id}::uuid`;
      await sql`INSERT INTO billing_gateway.cancellations(account_id,external_subscription_id,subscription_id,clinic_id,
      external_customer_id,external_checkout_id,paid_period_start,paid_period_end,requested_by,confirmed_at)
      VALUES(${f.account_id}::uuid,${f.evidence.subscriptionId},${f.subscription_id}::uuid,${f.clinicId}::uuid,
        ${f.evidence.customerId},${f.evidence.originCheckoutId},${f.anchor},${f.end},${f.userId}::uuid,now())`;
      const nextCheckout = `bill_recontract_integrity_${randomUUID().replaceAll('-', '')}`;
      await sql`INSERT INTO billing_gateway.recontracts(subscription_id,clinic_id,account_id,prior_external_subscription_id,
      prior_period_end,prior_external_customer_id,price_id,product_id,amount_minor,external_checkout_id)
      VALUES(${f.subscription_id}::uuid,${f.clinicId}::uuid,${f.account_id}::uuid,${f.evidence.subscriptionId},${f.end},
        ${f.evidence.customerId},${f.price_id}::uuid,${f.evidence.productId},${f.evidence.amountMinor},${nextCheckout})`;
      const before = await financialFingerprint(f);
      installHttpFixture(f, { emptySubscriptions: true });
      assert.deepEqual(
        await inspectIntegrity(dbAdmin, { checkoutId: nextCheckout, maxCandidates: 1 }),
        { scanned: 1, reviews: 0, failed: 0, deferred: false },
      );
      installHttpFixture(f, { status: 'CANCELLED', extraSubscription: true });
      assert.equal((await inspect(f)).reviews, 1);
      assert.deepEqual(await financialFingerprint(f), before);
    },
  );
  await check(
    'L4 bounded integrity batch signals remaining work instead of claiming every checkout is clean',
    async () => {
      const f = await seed(),
        before = await financialFingerprint(f);
      installHttpFixture(f, { fail: true });
      const result = await inspectIntegrity(dbAdmin, { maxCandidates: 1 });
      assert.equal(result.scanned, 1);
      assert.equal(result.failed, 1);
      assert.equal(result.deferred, true);
      assert.deepEqual(await financialFingerprint(f), before);
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
  await check(
    'H4 pending plan snapshots are immutable, private and deny destructive service privileges',
    async () => {
      await assert.rejects(sql`UPDATE billing_gateway.plan_changes SET amount_minor=1`, {
        code: '23514',
        constraint_name: 'gateway_plan_change_immutable',
      });
      const [row] = await sql`SELECT c.relrowsecurity AND c.relforcerowsecurity rls,
      has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') public_access,
      has_table_privilege('service_role',c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER') excess
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='billing_gateway' AND c.relname='plan_changes'`;
      assert.deepEqual(row, { rls: true, public_access: false, excess: false });
    },
  );
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
