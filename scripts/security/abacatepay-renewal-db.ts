/** Real migrations/application/receiver; synthetic identities and provider HTTP, loopback DB only. */
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

import { readMigrations, startScratchSchema } from './scratch-schema';
import { loadTissProofInputs } from './abacatepay-tiss-input';

const tissProof = process.env.QORO_TISS_REF ? await loadTissProofInputs() : null;
const cluster = await startScratchSchema({ port: 55492 });
assert.equal(new URL(cluster.url).hostname, '127.0.0.1');
const sql = cluster.sql;
const operational = process.env.QORO_ABACATEPAY_OPERATIONAL === '1';
const { startOperationalRedis, startOperationalDatabaseProxy } =
  await import('./abacatepay-operational-infra');
const operationalRedis = operational ? await startOperationalRedis() : undefined;
const operationalDatabase = operational
  ? await startOperationalDatabaseProxy(cluster.url)
  : undefined;
const applicationUrl = operationalDatabase?.url ?? cluster.url;
try {
  if (tissProof) {
    await sql.begin(async (tx) => {
      for (const migration of tissProof.sources) await tx.unsafe(migration.body);
    });
  }
} catch (error) {
  await cluster.stop();
  await operationalRedis?.stop();
  await operationalDatabase?.stop();
  throw error;
}
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: applicationUrl,
  DATABASE_URL_DEV: applicationUrl,
  DATABASE_URL_RUNTIME: applicationUrl,
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
    '{"clinica_2026_2":"prod_synthetic","clinica_2026_3":"prod_three","clinica_2026_4":"prod_four","clinica_2026_5":"prod_five","consultorio_2026":"prod_one"}',
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
delete process.env.ABACATEPAY_API_KEY_PROD;
if (operationalRedis)
  Object.assign(process.env, {
    VERCEL_ENV: 'preview',
    ABACATEPAY_ENVIRONMENT: 'sandbox',
    UPSTASH_REDIS_REST_URL: operationalRedis.url,
    UPSTASH_REDIS_REST_TOKEN: operationalRedis.token,
  });
const originalFetch = globalThis.fetch;
let networkCalls = 0,
  fixtureHttpCalls = 0,
  closurePosts = 0;
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
const { reconcileAbacatePayMissingRenewal: recoverRenewal } =
  await import('../../src/contexts/billing/internal/abacatepay-renewal-recovery');
const { closeConsumedAbacatePayCheckout: closeCheckout } =
  await import('../../src/contexts/billing/internal/abacatepay-checkout-closure');
const { recordAbacatePayRecurringPaymentTx } =
  await import('../../src/contexts/billing/internal/abacatepay-recurring-observations');
const { reconcileAbacatePayInbox, reconcileAbacatePayInboxTick } =
  await import('../../src/contexts/billing/internal/abacatepay-processing');
const { createPostgresGatewayInbox } = await import('../../src/lib/payments/saas/postgres-store');
const { POST: webhook } = await import('../../src/app/api/webhooks/abacatepay/route');
const { requestAbacatePayPlanChange: changePlan } =
  await import('../../src/contexts/billing/internal/abacatepay-plan-changes');
const { assertClinicCanWriteTx } = await import('../../src/lib/tenant-access');
const { reconcileAbacatePayIntegrity: inspectIntegrity } =
  await import('../../src/contexts/billing/internal/abacatepay-integrity');
const { observeAbacatePayRenewals: watchRenewals } =
  await import('../../src/contexts/billing/internal/abacatepay-renewal-watch');
const { listAbacatePayReviews: listReviews, authorizeAbacatePayReplayTx: authorizeReplay } =
  await import('../../src/contexts/billing/internal/abacatepay-review');
const { getAbacatePayOperations } =
  await import('../../src/app/(admin)/admin/_lib/repositories/abacatepay-operations.repo');
type Evidence = import('../../src/lib/payments/saas/recurring-payment').RecurringPaymentEvidence;
let account: import('../../src/lib/payments/saas/contracts').BillingAccount = {
  provider: 'abacatepay',
  environment: 'sandbox',
  accountId: 'store_synthetic',
};
let inbox = createPostgresGatewayInbox(account, dbAdmin);
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
async function seed(endOffsetMs = -120_000, planCode = 'clinica_2026_2', paid = true) {
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
  if (paid) {
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
  }
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
const applicationTimings: { connectionAdmissionMs: number; transactionMs: number }[] = [];
const apply = async (f: Fixture, evidence = f.evidence, eventId = f.eventId) => {
  const started = performance.now();
  let admitted = started;
  const result = await dbAdmin.transaction((tx) => {
    admitted = performance.now();
    return applyAbacatePayRenewalTx(tx, evidence, eventId);
  });
  if (process.env.QORO_ABACATEPAY_SCALE === '1')
    applicationTimings.push({
      connectionAdmissionMs: admitted - started,
      transactionMs: performance.now() - admitted,
    });
  return result;
};
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
    providerPeriod?: { start: string; end: string };
    amountMinor?: number;
    subscription?: Record<string, unknown>;
    emptyStatements?: boolean;
    extraStatement?: boolean;
    beforeStatement?: () => Promise<void>;
    close?: 'success' | 'timeout' | 'subscription_changed';
    deletedCheckout?: boolean;
  } = {},
) {
  let closed = options.deletedCheckout ?? false;
  globalThis.fetch = async (target, init) => {
    fixtureHttpCalls++;
    const url = new URL(target instanceof Request ? target.url : String(target));
    assert.equal(url.origin, 'https://api.abacatepay.com');
    if (init?.method === 'POST') {
      assert.ok(options.close);
      assert.equal(url.pathname, '/v2/subscriptions/checkouts/delete');
      assert.equal(url.searchParams.get('id'), f.evidence.originCheckoutId);
      closurePosts++;
      closed = true;
      if (options.close === 'timeout') throw new Error('Synthetic closure timeout');
      return Response.json({
        success: true,
        data: {
          id: f.evidence.originCheckoutId,
          devMode: f.evidence.account.environment === 'sandbox',
        },
      });
    }
    assert.equal(init?.method, 'GET');
    if (options.fail) return new Response('{}', { status: 503 });
    const subscription = {
      id: f.evidence.subscriptionId,
      checkoutId: f.evidence.originCheckoutId,
      customerId: f.evidence.customerId,
      amount: options.amountMinor ?? 39700,
      status:
        closed && options.close === 'subscription_changed'
          ? 'CANCELLED'
          : (options.status ?? 'ACTIVE'),
      method: 'CARD',
      devMode: f.evidence.account.environment === 'sandbox',
      trialEndsAt: null,
      createdAt: f.anchor.toISOString(),
      ...(options.providerPeriod
        ? {
            currentPeriodStart: options.providerPeriod.start,
            currentPeriodEnd: options.providerPeriod.end,
          }
        : {}),
      ...options.subscription,
    };
    let data: unknown;
    switch (url.pathname) {
      case '/v2/stores/get':
        data = { id: 'store_synthetic' };
        break;
      case '/v2/products/get':
        data = {
          id: url.searchParams.get('id') ?? 'prod_synthetic',
          externalId: 'local-renewal',
          price: options.amountMinor ?? 39700,
          currency: 'BRL',
          devMode: f.evidence.account.environment === 'sandbox',
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
        if (closed) return new Response('{}', { status: 404 });
        data = {
          id: url.searchParams.get('id') ?? f.evidence.checkoutId,
          frequency: 'SUBSCRIPTION',
          customerId: f.evidence.customerId,
          amount: 39700,
          paidAmount: 39700,
          status: 'PAID',
          devMode: f.evidence.account.environment === 'sandbox',
          items: [{ id: 'prod_synthetic', quantity: 1 }],
          createdAt: f.evidence.chargeCreatedAt,
        };
        break;
      case '/v2/bank-statement/list':
        await options.beforeStatement?.();
        // The official date filters use inclusive Brazilian calendar days. A
        // monthly scan must not receive this fixture's November item in December.
        if (
          options.emptyStatements ||
          (() => {
            const day = new Date(Date.parse(f.evidence.confirmedAt) - 3 * 3600_000)
              .toISOString()
              .slice(0, 10);
            const start = url.searchParams.get('startDate'),
              end = url.searchParams.get('endDate');
            return (start !== null && day < start) || (end !== null && day > end);
          })()
        )
          return Response.json({
            success: true,
            data: [],
            pagination: { hasMore: false, next: null },
          });
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
                  amount: options.amountMinor ?? 39700,
                  kind: 'CARD_APPROVED',
                  method: 'CARD',
                  category: 'transaction',
                  balanceEffect: 'none',
                },
                ...(options.refundMinor
                  ? [{ amount: options.refundMinor, category: 'refund', balanceEffect: 'debit' }]
                  : []),
                ...(options.reversal
                  ? [
                      {
                        amount: options.amountMinor ?? 39700,
                        category: 'reversal',
                        balanceEffect: 'credit',
                      },
                    ]
                  : []),
              ],
            },
            ...(options.extraStatement
              ? [
                  {
                    id: 'tran_extra',
                    currency: 'BRL',
                    createdAt: f.evidence.confirmedAt,
                    checkoutId: f.evidence.checkoutId,
                    paymentIntentId: 'char_extra',
                    customer: { publicId: f.evidence.customerId },
                    movements: [
                      {
                        amount: options.amountMinor ?? 39700,
                        kind: 'CARD_APPROVED',
                        method: 'CARD',
                        category: 'transaction',
                        balanceEffect: 'none',
                      },
                    ],
                  },
                ]
              : []),
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
function installPlanHttpFixture(
  f: Fixture,
  loseResponse = false,
  currentAmountMinor = f.evidence.amountMinor,
) {
  globalThis.fetch = async (target, init) => {
    fixtureHttpCalls++;
    const url = new URL(String(target));
    assert.equal(url.origin, 'https://api.abacatepay.com');
    const prices: Record<string, number> = {
      prod_probe: 100,
      prod_synthetic: 39700,
      prod_one: 19700,
      prod_three: 54400,
      prod_four: 69100,
      prod_five: 83800,
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
        amount: currentAmountMinor,
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
if (operational) {
  assert.ok(operationalRedis && operationalDatabase);
  try {
    await sql`UPDATE public.plans SET ativo=true WHERE code IN ('clinica_2026_2','clinica_2026_3','clinica_2026_4','clinica_2026_5','consultorio_2026')`;
    const candidate = await readFile(
      'docs/decoupling/asaas-to-abacatepay/migrations/saas_period_snapshot.candidate.sql',
      'utf8',
    );
    await sql.begin((tx) => tx.unsafe(candidate));
    const { runAbacatePayOperationalProof } = await import('./abacatepay-operational-proof');
    await runAbacatePayOperationalProof({
      sql,
      seed,
      notification,
      webhook,
      worker: reconcileAbacatePayInbox,
      originalFetch,
      redis: operationalRedis,
      databaseProxy: operationalDatabase,
      handlerFor(f) {
        const previous = globalThis.fetch;
        installHttpFixture(f);
        const handler = globalThis.fetch;
        globalThis.fetch = previous;
        return handler;
      },
    });
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await operationalDatabase.stop();
    await operationalRedis.stop();
    await cluster.stop();
  }
  process.exit(0);
}
if (process.env.QORO_ABACATEPAY_SCALE === '1') {
  try {
    await sql`UPDATE public.plans SET ativo=true WHERE code IN ('clinica_2026_2','clinica_2026_3','clinica_2026_4','clinica_2026_5','consultorio_2026')`;
    const candidate = await readFile(
      'docs/decoupling/asaas-to-abacatepay/migrations/saas_period_snapshot.candidate.sql',
      'utf8',
    );
    await sql.begin((tx) => tx.unsafe(candidate));
    const { runAbacatePayScaleProof } = await import('./abacatepay-scale-proof');
    await runAbacatePayScaleProof({
      sql,
      seed,
      accept,
      apply,
      applicationTimings,
      explainBinding: async () => {
        const { sql: query } = await import('drizzle-orm');
        const { abacatePayRenewalBindingRows } =
          await import('../../src/contexts/billing/internal/abacatepay-renewal-source');
        return dbAdmin.execute(query`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
          SELECT b.subscription_id FROM billing_gateway.event_inbox e
          JOIN billing_gateway.accounts a ON a.id=e.account_id
          JOIN ${abacatePayRenewalBindingRows()} bound ON true
          JOIN billing_gateway.bindings b ON b.account_id=a.id AND b.subscription_id=bound.subscription_id AND b.clinic_id=bound.clinic_id
          WHERE e.event_id=(SELECT event_id FROM billing_gateway.event_inbox ORDER BY received_at LIMIT 1)
            AND a.external_account_id=${account.accountId}`);
      },
    });
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await cluster.stop();
  }
  process.exit(0);
}
try {
  await sql`UPDATE public.plans SET ativo=true WHERE code IN ('clinica_2026_2','clinica_2026_3','clinica_2026_4','clinica_2026_5','consultorio_2026')`;
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
      const beforeRetryReads = fixtureHttpCalls;
      assert.deepEqual(await reconcileAbacatePayInbox({ eventId: f.eventId }), {
        applied: 0,
        review: 0,
        scanned: 0,
        retry: true,
      });
      assert.equal(fixtureHttpCalls, beforeRetryReads);
      await sql`UPDATE billing_gateway.event_inbox SET processed_at=now()-interval '1 day'
        WHERE event_id=${f.eventId} AND state='received'`;
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
    'support-confirmed checkout.lost records bound review once without a subscription reference or access change',
    async () => {
      const f = await seed();
      await accept(f);
      assert.equal(await apply(f), 'applied');
      const before = await financialFingerprint(f),
        eventId = `log_lost_support_${randomUUID()}`;
      await inbox.accept(
        {
          eventId,
          eventType: 'checkout.lost',
          subscriptionId: null,
          paymentId: null,
          customerId: f.evidence.customerId,
          checkoutId: f.evidence.checkoutId,
        },
        createHash('sha256').update(eventId).digest('hex'),
      );
      installHttpFixture(f);
      assert.equal((await reconcileAbacatePayInbox({ eventId })).review, 1);
      const [audit] = await sql`SELECT count(*)::int n,min(payload->>'eventType') event_type,
        min(payload->>'accessEffect') effect FROM public.billing_events
        WHERE clinic_id=${f.clinicId}::uuid AND type='subscription.financial.notification_checked' AND payload->>'eventId'=${eventId}`;
      assert.deepEqual(audit, {
        n: 1,
        event_type: 'checkout.lost',
        effect: 'keep_paid_period_human_review',
      });
      const reads = fixtureHttpCalls;
      await reconcileAbacatePayInbox({ eventId });
      assert.equal(fixtureHttpCalls, reads);
      assert.deepEqual(await financialFingerprint(f), before);
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
      await sql`UPDATE billing_gateway.event_inbox SET processed_at=now()-interval '1 day'
        WHERE event_id=${eventId} AND state='received'`;
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
        await sql`UPDATE billing_gateway.event_inbox SET processed_at=now()-interval '1 day'
          WHERE event_id=${eventId} AND state='received'`;
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
  const operatorId = randomUUID();
  await sql`INSERT INTO auth.users(id,email) VALUES(${operatorId}::uuid,${`${operatorId}@example.invalid`})`;
  await sql`INSERT INTO public.profiles(id,clinic_id,nome,role,ativo) VALUES(${operatorId}::uuid,NULL,'Synthetic operator','super_admin',true)`;
  async function reviewFixture() {
    const f = await seed();
    await accept(f);
    await sql`UPDATE billing_gateway.event_inbox SET state='review',attempts=10,outcome_code='synthetic_readback_failure'
      WHERE account_id=${f.account_id}::uuid AND event_id=${f.eventId}`;
    return f;
  }
  async function approvalInput(f: Fixture) {
    const row = (await listReviews(dbAdmin)).find((r) => r.event_id === f.eventId);
    assert.ok(row);
    return {
      accountId: row.account_id,
      eventId: row.event_id,
      clinicId: row.clinic_id,
      snapshot: row.snapshot,
      reason: 'provider_recovered',
      evidenceReference: 'INC-20261110-DB',
    };
  }
  const queue = (input: unknown, actor = operatorId) =>
    dbAdmin.transaction((tx) => authorizeReplay(tx, input, actor));
  for (const condition of ['inactive', 'soft_deleted'] as const) {
    await check(
      `OPS revoked ${condition} operator cannot authorize a financial replay`,
      async () => {
        const f = await reviewFixture(),
          revokedId = randomUUID(),
          before = await financialFingerprint(f);
        await sql`INSERT INTO auth.users(id,email) VALUES(${revokedId}::uuid,${`${revokedId}@example.invalid`})`;
        await sql`INSERT INTO public.profiles(id,clinic_id,nome,role,ativo,deleted_at)
        VALUES(${revokedId}::uuid,NULL,'Synthetic revoked operator','super_admin',
          ${condition !== 'inactive'},${condition === 'soft_deleted' ? new Date() : null})`;
        await assert.rejects(queue(await approvalInput(f), revokedId), (error) => {
          assert.ok(
            error instanceof Error && typeof error.cause === 'object' && error.cause !== null,
          );
          assert.ok('code' in error.cause && error.cause.code === '23514');
          assert.ok(
            'constraint_name' in error.cause &&
              error.cause.constraint_name === 'gateway_review_actor_binding',
          );
          return true;
        });
        assert.deepEqual(await financialFingerprint(f), before);
        const [row] = await sql`SELECT state,attempts,
        (SELECT count(*)::int FROM billing_gateway.review_replays WHERE event_id=${f.eventId}) approvals
        FROM billing_gateway.event_inbox WHERE event_id=${f.eventId}`;
        assert.deepEqual(row, { state: 'review', attempts: 10, approvals: 0 });
      },
    );
  }
  await check(
    'OPS-001 one audited replay preserves all financial fields and cumulative attempts',
    async () => {
      const f = await reviewFixture(),
        before = await financialFingerprint(f);
      await queue(await approvalInput(f));
      assert.deepEqual(await financialFingerprint(f), before);
      const [row] =
        await sql`SELECT state,attempts,(SELECT count(*)::int FROM billing_gateway.review_replays
      WHERE account_id=${f.account_id}::uuid AND event_id=${f.eventId}) approvals FROM billing_gateway.event_inbox
      WHERE account_id=${f.account_id}::uuid AND event_id=${f.eventId}`;
      assert.equal(row?.state, 'received');
      assert.equal(row?.attempts, 10);
      assert.equal(row?.approvals, 1);
      installHttpFixture(f, { fail: true });
      const first = await reconcileAbacatePayInbox({ eventId: f.eventId });
      assert.equal(first.review, 1);
      assert.equal(first.retry, false);
      const calls = fixtureHttpCalls;
      assert.equal((await reconcileAbacatePayInbox({ eventId: f.eventId })).scanned, 0);
      assert.equal(fixtureHttpCalls, calls);
    },
  );
  await check(
    'OPS-002 review recovery verifies the same remote payment and grants exactly one cycle',
    async () => {
      const f = await reviewFixture();
      await queue(await approvalInput(f));
      installHttpFixture(f);
      assert.equal((await reconcileAbacatePayInbox({ eventId: f.eventId })).applied, 1);
      const after = await state(f);
      assert.equal(after.cycles, 1);
      assert.equal(after.invoices, 2);
      assert.equal((await reconcileAbacatePayInbox({ eventId: f.eventId })).scanned, 0);
      assert.deepEqual(await state(f), after);
    },
  );
  await check(
    'OPS-003 concurrent operators authorize only once from the same snapshot',
    async () => {
      const f = await reviewFixture(),
        input = await approvalInput(f),
        before = await financialFingerprint(f);
      const result = await Promise.allSettled(Array.from({ length: 8 }, () => queue(input)));
      assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
      assert.deepEqual(await financialFingerprint(f), before);
    },
  );
  await check('OPS-004 clinic owners cannot authorize a platform financial replay', async () => {
    const f = await reviewFixture();
    await assert.rejects(queue(await approvalInput(f), f.userId), (error) => {
      assert.ok(error instanceof Error && typeof error.cause === 'object' && error.cause !== null);
      assert.ok('code' in error.cause && error.cause.code === '23514');
      assert.ok(
        'constraint_name' in error.cause &&
          error.cause.constraint_name === 'gateway_review_actor_binding',
      );
      return true;
    });
    const [row] =
      await sql`SELECT count(*)::int count FROM billing_gateway.review_replays WHERE event_id=${f.eventId}`;
    assert.equal(row?.count, 0);
  });
  await check(
    'OPS-005 stale snapshots and cross-tenant requests never queue an event',
    async () => {
      const f = await reviewFixture(),
        other = await seed(),
        input = await approvalInput(f);
      await assert.rejects(queue({ ...input, clinicId: other.clinicId }));
      await assert.rejects(queue({ ...input, snapshot: 'a'.repeat(64) }));
      assert.equal(
        (await listReviews(dbAdmin)).find((r) => r.event_id === f.eventId)?.attempts,
        10,
      );
    },
  );
  await check('OPS-006 applied/processing events cannot be manually reopened', async () => {
    for (const state of ['applied', 'processing']) {
      const f = await reviewFixture(),
        input = await approvalInput(f);
      await sql`UPDATE billing_gateway.event_inbox SET state=${state},lease_token=${state === 'processing' ? randomUUID() : null}::uuid,
        lease_until=${state === 'processing' ? new Date(Date.now() + 60000) : null} WHERE account_id=${f.account_id}::uuid AND event_id=${f.eventId}`;
      await assert.rejects(queue(input));
    }
  });
  await check(
    'OPS-007 three manual attempts per day are enforced without financial override',
    async () => {
      const f = await reviewFixture();
      installHttpFixture(f, { fail: true });
      for (let i = 0; i < 3; i++) {
        await queue(await approvalInput(f));
        assert.equal((await reconcileAbacatePayInbox({ eventId: f.eventId })).review, 1);
      }
      await assert.rejects(queue(await approvalInput(f)), /replay_limit/);
      const [row] =
        await sql`SELECT attempts FROM billing_gateway.event_inbox WHERE event_id=${f.eventId}`;
      assert.equal(row?.attempts, 13);
    },
  );
  await check(
    'OPS-008 private replay evidence denies anon, authenticated and service mutation',
    async () => {
      for (const role of ['anon', 'authenticated', 'qoro_runtime', 'service_role']) {
        await assert.rejects(
          sql.begin(async (tx) => {
            await tx.unsafe(`SET LOCAL ROLE ${role}`);
            await tx`DELETE FROM billing_gateway.review_replays WHERE false`;
          }),
          { code: '42501' },
        );
      }
      await assert.rejects(
        sql.begin(async (tx) => {
          await tx`SET LOCAL ROLE service_role`;
          await tx`UPDATE billing_gateway.review_replays SET reason='provider_recovered' WHERE false`;
        }),
        { code: '42501' },
      );
      for (const role of ['anon', 'authenticated', 'qoro_runtime']) {
        await assert.rejects(
          sql.begin(async (tx) => {
            await tx.unsafe(`SET LOCAL ROLE ${role}`);
            await tx`SELECT * FROM billing_gateway.review_replays`;
          }),
          { code: '42501' },
        );
      }
    },
  );
  await check(
    'OPS-009 no duplicate renewal incident under parallel scans and no access changes',
    async () => {
      const f = await seed(),
        before = await financialFingerprint(f);
      const calls = fixtureHttpCalls;
      await Promise.all(Array.from({ length: 8 }, () => watchRenewals(dbAdmin)));
      const [count] =
        await sql`SELECT count(*)::int count FROM public.billing_events WHERE clinic_id=${f.clinicId}::uuid
      AND type='subscription.renewal_watch.observed' AND payload->>'state'='due'`;
      assert.equal(count?.count, 1);
      assert.deepEqual(await financialFingerprint(f), before);
      assert.equal(fixtureHttpCalls, calls);
    },
  );
  await check(
    'OPS-010 a verified renewal resolves the incident without replaying financial effects',
    async () => {
      const f = await seed();
      await watchRenewals(dbAdmin);
      await accept(f);
      await apply(f);
      await watchRenewals(dbAdmin);
      const [row] =
        await sql`SELECT payload->>'state' state FROM public.billing_events WHERE clinic_id=${f.clinicId}::uuid
      AND type='subscription.renewal_watch.observed' ORDER BY created_at DESC,id DESC LIMIT 1`;
      assert.equal(row?.state, 'resolved');
      assert.equal((await state(f)).cycles, 1);
    },
  );
  await check(
    'OPS-011 cancelled contracts and future periods never report an expected renewal',
    async () => {
      const cancelled = await seed(),
        future = await seed(86_400_000);
      await sql`UPDATE public.subscriptions SET cancel_at_period_end=true WHERE id=${cancelled.subscription_id}::uuid`;
      await watchRenewals(dbAdmin);
      const [row] =
        await sql`SELECT count(*)::int count FROM public.billing_events WHERE clinic_id IN (${cancelled.clinicId}::uuid,${future.clinicId}::uuid)
      AND type='subscription.renewal_watch.observed' AND payload->>'state'='due'`;
      assert.equal(row?.count, 0);
    },
  );
  await check(
    'OPS-012 trial without paid evidence and Asaas legacy are outside the monitor',
    async () => {
      const f = await seed(-120_000, 'clinica_2026_2', false),
        before = await financialFingerprint(f);
      const clinicId = randomUUID(),
        ownerId = randomUUID();
      await sql`INSERT INTO auth.users(id,email) VALUES(${ownerId}::uuid,${`${ownerId}@example.invalid`})`;
      await sql`INSERT INTO public.clinics(id,slug,nome,status) VALUES(${clinicId}::uuid,${`legacy-watch-${clinicId.slice(0, 8)}`},'Synthetic legacy watch','active')`;
      await sql`INSERT INTO public.profiles(id,clinic_id,nome,role,ativo) VALUES(${ownerId}::uuid,${clinicId}::uuid,'Synthetic legacy owner','owner',true)`;
      await sql`INSERT INTO public.subscriptions(clinic_id,plan_id,price_id,billing_status,trial_ends_at,billing_provider,asaas_subscription_id,
        current_period_start,current_period_end) SELECT ${clinicId}::uuid,plan_id,price_id,'active',trial_ends_at,'asaas','sub_synthetic_legacy_watch',
        now()-interval '32 days',now()-interval '2 days' FROM public.subscriptions WHERE id=${f.subscription_id}::uuid`;
      await watchRenewals(dbAdmin);
      const [row] =
        await sql`SELECT count(*)::int count FROM public.billing_events WHERE clinic_id IN (${f.clinicId}::uuid,${clinicId}::uuid)
      AND type='subscription.renewal_watch.observed'`;
      assert.equal(row?.count, 0);
      assert.deepEqual(await financialFingerprint(f), before);
    },
  );
  await check(
    'OPS-013 a failed audit transaction rolls back the authorization and queue atomically',
    async () => {
      const f = await reviewFixture(),
        input = await approvalInput(f),
        before = await financialFingerprint(f);
      await assert.rejects(
        dbAdmin.transaction(async (tx) => {
          await authorizeReplay(tx, input, operatorId);
          throw new Error('Synthetic audit failure after approval');
        }),
        /Synthetic audit failure/,
      );
      assert.deepEqual(await financialFingerprint(f), before);
      const [row] =
        await sql`SELECT state,(SELECT count(*)::int FROM billing_gateway.review_replays WHERE event_id=${f.eventId}) approvals
      FROM billing_gateway.event_inbox WHERE event_id=${f.eventId}`;
      assert.equal(row?.state, 'review');
      assert.equal(row?.approvals, 0);
    },
  );
  await check(
    'OPS-014 two manually retried event IDs for one payment never grant two cycles',
    async () => {
      const f = await reviewFixture();
      await queue(await approvalInput(f));
      installHttpFixture(f);
      assert.equal((await reconcileAbacatePayInbox({ eventId: f.eventId })).applied, 1);
      const duplicateId = `log_duplicate_${randomUUID().replaceAll('-', '')}`;
      await accept(f, duplicateId);
      await sql`UPDATE billing_gateway.event_inbox SET state='review',attempts=10 WHERE event_id=${duplicateId}`;
      await queue(await approvalInput({ ...f, eventId: duplicateId }));
      await reconcileAbacatePayInbox({ eventId: duplicateId });
      assert.equal((await state(f)).cycles, 1);
      assert.equal((await state(f)).invoices, 2);
    },
  );
  await check(
    'OPS-015 operator repository exposes quarantined references without an authorization path',
    async () => {
      const eventId = `log_quarantine_${randomUUID().replaceAll('-', '')}`;
      await inbox.accept(
        {
          eventId,
          eventType: 'subscription.renewed',
          subscriptionId: 'subs_unmatched_operator',
          customerId: 'cust_unmatched_operator',
          checkoutId: 'bill_unmatched_operator',
          paymentId: 'char_unmatched_operator',
        },
        createHash('sha256').update(eventId).digest('hex'),
      );
      await sql`UPDATE billing_gateway.event_inbox SET state='review',outcome_code='unmatched_fixture' WHERE event_id=${eventId}`;
      const operations = await getAbacatePayOperations();
      assert.ok(operations);
      assert.ok(operations.quarantined.some((row) => row.event_id === eventId));
      assert.ok(!operations.reviews.some((row) => row.event_id === eventId));
      assert.ok(operations.backlog.reviews > 0);
    },
  );
  for (const [doctors, code, amountMinor, productId] of [
    [3, 'clinica_2026_3', 54400, 'prod_three'],
    [4, 'clinica_2026_4', 69100, 'prod_four'],
    [5, 'clinica_2026_5', 83800, 'prod_five'],
  ] as const) {
    await check(
      `MATRIX-${doctors} exact catalog amount, concurrent upgrade, paid quota and downgrade`,
      async () => {
        const f = await seed(86_400_000),
          targetPlanId = await targetPlan(code);
        const [catalog] = await sql`SELECT pr.amount::text,l.doctors,l.staff FROM public.prices pr
          JOIN public.plan_seat_limits l ON l.plan_id=pr.plan_id
          WHERE pr.plan_id=${targetPlanId}::uuid AND pr.billing_cycle='monthly' AND pr.campaign_code IS NULL`;
        assert.deepEqual(catalog, { amount: `${amountMinor / 100}.00`, doctors, staff: 3 });
        // An owner with CRM consumes one doctor seat, not an administrative seat.
        await sql`UPDATE public.profiles SET crm='SYNTHETIC-OWNER' WHERE id=${f.userId}::uuid`;
        const doctorIds: string[] = [];
        for (let index = 0; index < doctors; index++) {
          const id = randomUUID();
          await sql`INSERT INTO auth.users(id,email,created_at) VALUES(${id}::uuid,${`${id}@example.invalid`},now())`;
          await sql`INSERT INTO public.profiles(id,clinic_id,nome,role,crm,ativo)
            VALUES(${id}::uuid,${f.clinicId}::uuid,'Synthetic matrix doctor','doctor',${`SYNTHETIC-${index}`},${index === 0})`;
          doctorIds.push(id);
        }
        const thirdDoctor = doctorIds[1];
        assert.ok(thirdDoctor);
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
        const requests = await Promise.allSettled(Array.from({ length: 8 }, request));
        assert.ok(requests.some((result) => result.status === 'fulfilled'));
        await request();
        assert.equal(planPosts - beforePosts, 1);
        assert.deepEqual(await projection(f), before);
        assert.deepEqual(await state(f), financial);
        await assert.rejects(
          sql`UPDATE public.profiles SET ativo=true WHERE id=${thirdDoctor}::uuid`,
          {
            code: '23514',
            constraint_name: 'offer_2026_seat_limit',
          },
        );
        const evidence = changedEvidence(f, amountMinor, productId);
        await accept(f, f.eventId, evidence);
        const outcomes = await Promise.all(
          Array.from({ length: 8 }, () =>
            dbAdmin.transaction((tx) =>
              applyAbacatePayRenewalTx(tx, evidence, f.eventId, new Date(f.end.getTime() + 2000)),
            ),
          ),
        );
        assert.equal(outcomes.filter((result) => result === 'applied').length, 1);
        assert.equal(outcomes.filter((result) => result === 'duplicate').length, 7);
        assert.equal((await projection(f)).code, code);
        const [invoice] = await sql`SELECT i.total_amount::text FROM public.invoices i
          JOIN billing_gateway.plan_changes c ON c.invoice_id=i.id WHERE c.subscription_id=${f.subscription_id}::uuid`;
        assert.equal(invoice?.total_amount, `${amountMinor / 100}.00`);
        assert.equal((await state(f)).invoices, 2);
        // Fill every newly paid doctor seat; an additional seat remains forbidden.
        for (const id of doctorIds.slice(1, doctors - 1))
          await sql`UPDATE public.profiles SET ativo=true WHERE id=${id}::uuid`;
        const overflow = doctorIds[doctors - 1];
        assert.ok(overflow);
        await assert.rejects(
          sql`UPDATE public.profiles SET ativo=true WHERE id=${overflow}::uuid`,
          {
            code: '23514',
            constraint_name: 'offer_2026_seat_limit',
          },
        );
        const [count] =
          await sql`SELECT count(*)::int n FROM public.profiles WHERE clinic_id=${f.clinicId}::uuid
          AND ativo AND (role='doctor' OR (role IN ('owner','gestor') AND nullif(btrim(crm),'') IS NOT NULL))`;
        assert.equal(count?.n, doctors);
        // Administrative seats stay at three; paying for doctors does not buy staff logins.
        for (let index = 0; index < 4; index++) {
          const id = randomUUID();
          await sql`INSERT INTO auth.users(id,email,created_at) VALUES(${id}::uuid,${`${id}@example.invalid`},now())`;
          const insert = () => sql`INSERT INTO public.profiles(id,clinic_id,nome,role,ativo)
            VALUES(${id}::uuid,${f.clinicId}::uuid,'Synthetic matrix staff','attendant',true)`;
          if (index < 3) await insert();
          else
            await assert.rejects(insert(), {
              code: '23514',
              constraint_name: 'offer_2026_seat_limit',
            });
        }
        // The original paid checkout keeps its original price after an upgrade.
        installPlanHttpFixture(f, false, amountMinor);
        const basePlanId = await targetPlan('clinica_2026_2');
        const downgrade = () =>
          changePlan(dbAdmin, {
            clinicId: f.clinicId,
            requestedBy: f.userId,
            contractId: f.subscription_id,
            targetPlanId: basePlanId,
          });
        await assert.rejects(
          downgrade(),
          (error: unknown) =>
            error instanceof Error &&
            'code' in error &&
            error.code === 'downgrade_capacity_exceeded',
        );
        for (const id of doctorIds.slice(1, doctors - 1))
          await sql`UPDATE public.profiles SET ativo=false WHERE id=${id}::uuid`;
        await downgrade();
        assert.equal((await projection(f)).code, code);
        await assert.rejects(
          sql`UPDATE public.profiles SET ativo=true WHERE id=${thirdDoctor}::uuid`,
          {
            code: '23514',
            constraint_name: 'gateway_pending_seat_limit',
          },
        );
        const next = month(f.end, 1),
          suffix = randomUUID().replaceAll('-', ''),
          downEventId = `log_matrix_down_${suffix}`;
        const downEvidence: Evidence = {
          ...evidence,
          amountMinor: 39700,
          paidAmountMinor: 39700,
          productId: 'prod_synthetic',
          paymentId: `char_down_${suffix}`,
          checkoutId: `bill_down_${suffix}`,
          statementId: `tran_down_${suffix}`,
          chargeCreatedAt: next.toISOString(),
          confirmedAt: new Date(next.getTime() + 1000).toISOString(),
        };
        await accept(f, downEventId, downEvidence);
        assert.equal(
          await dbAdmin.transaction((tx) =>
            applyAbacatePayRenewalTx(
              tx,
              downEvidence,
              downEventId,
              new Date(next.getTime() + 2000),
            ),
          ),
          'applied',
        );
        assert.equal((await projection(f)).code, 'clinica_2026_2');
        assert.equal((await state(f)).invoices, 3);
      },
    );
    for (const mode of ['old_amount', 'partial', 'overpaid', 'wrong_product', 'early'] as const) {
      await check(`MATRIX-${doctors} ${mode} cannot release a higher quota`, async () => {
        const f = await seed(86_400_000);
        installPlanHttpFixture(f);
        await changePlan(dbAdmin, {
          clinicId: f.clinicId,
          requestedBy: f.userId,
          contractId: f.subscription_id,
          targetPlanId: await targetPlan(code),
        });
        const target = changedEvidence(f, amountMinor, productId);
        const evidence =
          mode === 'old_amount'
            ? f.evidence
            : mode === 'partial'
              ? { ...target, paidAmountMinor: amountMinor - 1 }
              : mode === 'overpaid'
                ? { ...target, paidAmountMinor: amountMinor + 1 }
                : mode === 'wrong_product'
                  ? { ...target, productId: 'prod_unrelated' }
                  : {
                      ...target,
                      chargeCreatedAt: f.anchor.toISOString(),
                      confirmedAt: new Date(f.anchor.getTime() + 1000).toISOString(),
                    };
        const before = await state(f);
        await accept(f, f.eventId, evidence);
        assert.notEqual(
          await dbAdmin.transaction((tx) =>
            applyAbacatePayRenewalTx(tx, evidence, f.eventId, new Date(f.end.getTime() + 2000)),
          ),
          'applied',
        );
        const after = await state(f);
        assert.equal((await projection(f)).code, 'clinica_2026_2');
        assert.equal(after.current_period_start, before.current_period_start);
        assert.equal(after.current_period_end, before.current_period_end);
        const [intent] =
          await sql`SELECT invoice_id IS NULL pending FROM billing_gateway.plan_changes
          WHERE subscription_id=${f.subscription_id}::uuid`;
        assert.equal(intent?.pending, true);
      });
    }
  }
  await check(
    'MATRIX unknown, legacy and current plan are refused without provider commands',
    async () => {
      const f = await seed(86_400_000);
      installPlanHttpFixture(f);
      const before = planPosts;
      for (const targetPlanId of [
        randomUUID(),
        await targetPlan('solo'),
        await targetPlan('clinica_2026_2'),
      ])
        await assert.rejects(
          changePlan(dbAdmin, {
            clinicId: f.clinicId,
            requestedBy: f.userId,
            contractId: f.subscription_id,
            targetPlanId,
          }),
          (error: unknown) =>
            error instanceof Error && 'code' in error && error.code === 'not_eligible',
        );
      assert.equal(planPosts, before);
      const [pending] =
        await sql`SELECT count(*)::int n FROM billing_gateway.plan_changes WHERE subscription_id=${f.subscription_id}::uuid`;
      assert.equal(pending?.n, 0);
    },
  );
  await check(
    'PERIOD missing webhook is detected independently by authenticated provider period with no fabricated event or entitlement',
    async () => {
      const f = await seed(),
        before = await financialFingerprint(f);
      installHttpFixture(f, {
        providerPeriod: {
          start: f.end.toISOString().slice(0, 10),
          end: new Date(f.end.getTime() + 31 * 86400000).toISOString().slice(0, 10),
        },
      });
      assert.equal((await inspect(f)).reviews, 1);
      assert.deepEqual(await financialFingerprint(f), before);
      const [issue] =
        await sql`SELECT payload->>'issue' issue FROM public.billing_events WHERE clinic_id=${f.clinicId}::uuid AND type='subscription.recurrence.review_required'`;
      assert.equal(issue?.issue, 'provider_period_ahead');
      const [inboxCount] =
        await sql`SELECT count(*)::int n FROM billing_gateway.event_inbox WHERE external_subscription_id=${f.evidence.subscriptionId}`;
      assert.equal(inboxCount?.n, 0);
    },
  );
  await check(
    'PERIOD schema N/N-1 keeps shared-checkout renewal in review before candidate DDL',
    async () => {
      const f = await seed(),
        before = await state(f);
      const evidence = {
        ...f.evidence,
        checkoutId: f.evidence.originCheckoutId,
        chargeCreatedAt: f.end.toISOString(),
        providerPeriodStart: f.end.toISOString().slice(0, 10),
        providerPeriodEnd: new Date(f.end.getTime() + 31 * 86400000).toISOString().slice(0, 10),
      };
      await accept(f, f.eventId, evidence);
      assert.equal(await apply(f, evidence), 'review');
      assert.deepEqual(await state(f), before);
    },
  );
  await check(
    'RECOVERY schema N/N-1 starts no API recovery or closure command before candidate DDL',
    async () => {
      const f = await seed(),
        before = await state(f),
        calls = fixtureHttpCalls,
        posts = closurePosts;
      const result = await recoverRenewal(dbAdmin, { subscriptionId: f.subscription_id });
      assert.equal(result.scanned, 0);
      assert.equal(result.applied, 0);
      await assert.rejects(
        closeCheckout(dbAdmin, {
          subscriptionId: f.subscription_id,
          checkoutId: f.evidence.originCheckoutId,
        }),
        { code: 'unavailable' },
      );
      assert.equal(fixtureHttpCalls, calls);
      assert.equal(closurePosts, posts);
      assert.deepEqual(await state(f), before);
    },
  );
  const candidateSql = await readFile(
    new URL(
      '../../docs/decoupling/asaas-to-abacatepay/migrations/saas_period_snapshot.candidate.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await check(
    'PERIOD candidate DDL preserves all existing subscriptions and invoices and private RLS',
    async () => {
      const snapshot = async () => sql`SELECT
      (SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text,'')) FROM public.subscriptions s) subscriptions,
      (SELECT md5(coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id)::text,'')) FROM public.invoices i) invoices,
      (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text,'')) FROM public.prices p) prices`;
      const before = await snapshot();
      await sql.begin((tx) => tx.unsafe(candidateSql));
      assert.deepEqual(await snapshot(), before);
      const [rls] = await sql`SELECT relrowsecurity,relforcerowsecurity FROM pg_class
      WHERE oid='billing_gateway.recurring_payment_observations'::regclass`;
      assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
    },
  );
  await check(
    'PERIOD two original-checkout renewals have distinct payment ledgers and one effect per cycle',
    async () => {
      const f = await seed();
      for (let cycle = 1; cycle <= 2; cycle++) {
        const iso = f.anchor.toISOString();
        const start = new Date(addCalendarMonths(iso.slice(0, 10), cycle) + iso.slice(10));
        const end = new Date(addCalendarMonths(iso.slice(0, 10), cycle + 1) + iso.slice(10));
        const evidence = {
          ...f.evidence,
          checkoutId: f.evidence.originCheckoutId,
          paymentId: 'char_same_' + cycle + '_' + f.userId.replaceAll('-', ''),
          statementId: 'tran_same_' + cycle + '_' + f.userId.replaceAll('-', ''),
          chargeCreatedAt: start.toISOString(),
          confirmedAt: new Date(start.getTime() + 1000).toISOString(),
          providerPeriodStart: start.toISOString().slice(0, 10),
          providerPeriodEnd: end.toISOString().slice(0, 10),
        };
        const eventId = 'log_same_' + cycle + '_' + f.userId.replaceAll('-', '');
        await accept(f, eventId, evidence);
        const applyOne = () =>
          dbAdmin.transaction((tx) =>
            applyAbacatePayRenewalTx(tx, evidence, eventId, new Date(start.getTime() + 2000)),
          );
        const outcomes = await Promise.all(Array.from({ length: 6 }, applyOne));
        assert.equal(outcomes.filter((x) => x === 'applied').length, 1);
        assert.ok(outcomes.every((x) => x === 'applied' || x === 'duplicate'));
      }
      const result = await state(f);
      assert.equal(result.invoices, 3);
      assert.equal(result.cycles, 2);
      assert.equal(result.observations, 2);
    },
  );
  await check('PERIOD database refuses shared checkout without paid-period evidence', async () => {
    const f = await seed();
    await accept(f);
    assert.equal(
      await apply(f, { ...f.evidence, checkoutId: f.evidence.originCheckoutId }),
      'review',
    );
    assert.equal((await state(f)).observations, 0);
  });
  await check(
    'PERIOD late original-checkout payment preserves the original anniversary calendar',
    async () => {
      const f = await seed(),
        iso = f.anchor.toISOString();
      const end = new Date(addCalendarMonths(iso.slice(0, 10), 2) + iso.slice(10));
      const paidAt = new Date(f.end.getTime() + 7 * 86400000);
      const evidence = {
        ...f.evidence,
        checkoutId: f.evidence.originCheckoutId,
        chargeCreatedAt: paidAt.toISOString(),
        confirmedAt: paidAt.toISOString(),
        providerPeriodStart: f.end.toISOString().slice(0, 10),
        providerPeriodEnd: end.toISOString().slice(0, 10),
      };
      await accept(f, f.eventId, evidence);
      assert.equal(
        await dbAdmin.transaction((tx) =>
          applyAbacatePayRenewalTx(tx, evidence, f.eventId, new Date(paidAt.getTime() + 1000)),
        ),
        'applied',
      );
      const [row] =
        await sql`SELECT current_period_start,current_period_end FROM public.subscriptions WHERE id=${f.subscription_id}::uuid`;
      assert.equal(row?.current_period_start.getTime(), f.end.getTime());
      assert.equal(row?.current_period_end.getTime(), end.getTime());
    },
  );
  await check(
    'PERIOD a distinct-checkout proof cannot smuggle unaudited provider-period metadata',
    async () => {
      const f = await seed();
      await accept(f);
      const before = await state(f);
      assert.equal(
        await apply(f, {
          ...f.evidence,
          providerPeriodStart: f.end.toISOString().slice(0, 10),
          providerPeriodEnd: new Date(f.end.getTime() + 31 * 86400000).toISOString().slice(0, 10),
        }),
        'review',
      );
      assert.deepEqual(await state(f), before);
    },
  );
  async function recoveryFixture(
    options: Parameters<typeof installHttpFixture>[1] = {},
    endOffsetMs = -120_000,
  ) {
    const f = await seed(endOffsetMs);
    f.evidence = {
      ...f.evidence,
      checkoutId: f.evidence.originCheckoutId,
      chargeCreatedAt: f.evidence.confirmedAt,
      providerPeriodStart: f.end.toISOString().slice(0, 10),
      providerPeriodEnd: month(f.anchor, 2).toISOString().slice(0, 10),
    };
    installHttpFixture(f, {
      providerPeriod: providerDates(f),
      ...options,
    });
    // Each recovery fixture installs a different synthetic provider dataset.
    // Advance only the cache-refresh clock; never edit a financial state.
    await sql`UPDATE billing_gateway.statement_scans SET completed_at=now()-interval '61 seconds' WHERE state='complete'`;
    return f;
  }
  function providerDates(f: Fixture) {
    const start = f.evidence.providerPeriodStart,
      end = f.evidence.providerPeriodEnd;
    assert.ok(start && end);
    return { start, end };
  }
  const recover = (f: Fixture) => recoverRenewal(dbAdmin, { subscriptionId: f.subscription_id });
  async function sourceCount(f: Fixture) {
    const [row] =
      await sql`SELECT count(*)::int n FROM billing_gateway.renewal_api_readbacks WHERE subscription_id=${f.subscription_id}::uuid`;
    return row?.n;
  }
  await check(
    'RECOVERY no webhook creates one paid invoice and entitlement from immutable API provenance',
    async () => {
      const f = await recoveryFixture(),
        before = await financialFingerprint(f);
      assert.equal((await recover(f)).applied, 1);
      const s = await state(f);
      assert.equal(s.invoices, 2);
      assert.equal(s.cycles, 1);
      assert.equal(s.observations, 1);
      assert.equal(await sourceCount(f), 1);
      const [source] =
        await sql`SELECT source_event_id IS NULL no_event,source_readback_id IS NOT NULL api_origin
      FROM billing_gateway.recurring_payment_observations WHERE subscription_id=${f.subscription_id}::uuid`;
      assert.deepEqual(source, { no_event: true, api_origin: true });
      const [inbox] =
        await sql`SELECT count(*)::int n FROM billing_gateway.event_inbox WHERE external_subscription_id=${f.evidence.subscriptionId}`;
      assert.equal(inbox?.n, 0);
      assert.equal((await financialFingerprint(f)).commands, before.commands);
      assert.equal((await financialFingerprint(f)).profiles, before.profiles);
    },
  );
  await check('RECOVERY concurrent workers commit one payment, invoice and cycle', async () => {
    const f = await recoveryFixture();
    const results = await Promise.all(Array.from({ length: 8 }, () => recover(f)));
    assert.equal(
      results.reduce((n, r) => n + r.applied, 0),
      1,
    );
    assert.equal(
      results.reduce((n, r) => n + r.failed, 0),
      0,
    );
    assert.equal((await state(f)).invoices, 2);
    assert.equal((await state(f)).cycles, 1);
    assert.equal(await sourceCount(f), 1);
  });
  await check(
    'RECOVERY reaches the 10,000th statement across persisted batches and activates once',
    async () => {
      const f = await recoveryFixture(),
        previousFetch = globalThis.fetch;
      const items = Array.from({ length: 10_000 }, (_, index) => {
        const target = index === 9999;
        return {
          id: target ? f.evidence.statementId : `tran_bulk_${index}`,
          currency: 'BRL',
          createdAt: new Date(Date.parse(f.evidence.confirmedAt) + (9999 - index)).toISOString(),
          checkoutId: target ? f.evidence.originCheckoutId : `bill_bulk_${index}`,
          paymentIntentId: target ? f.evidence.paymentId : `char_bulk_${index}`,
          customer: { publicId: target ? f.evidence.customerId : 'cust_unrelated' },
          movements: [
            {
              amount: 39700,
              kind: 'CARD_APPROVED',
              method: 'CARD',
              category: 'transaction',
              balanceEffect: 'credit',
            },
          ],
        };
      });
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (!url.pathname.endsWith('/bank-statement/list')) return previousFetch(input, init);
        fixtureHttpCalls++;
        const day = new Date(Date.parse(f.evidence.confirmedAt) - 3 * 3600_000)
          .toISOString()
          .slice(0, 10);
        const start = url.searchParams.get('startDate'),
          end = url.searchParams.get('endDate');
        const filtered = start && end && day >= start && day <= end ? items : [];
        const cursor = url.searchParams.get('after');
        const offset = cursor === null ? 0 : filtered.findIndex((item) => item.id === cursor) + 1;
        assert.ok(cursor === null || offset > 0);
        const data = filtered.slice(offset, offset + 100),
          more = offset + data.length < filtered.length;
        return Response.json({
          success: true,
          data,
          pagination: { hasMore: more, next: more ? data.at(-1)?.id : null },
        });
      };
      try {
        const before = await state(f);
        assert.equal((await recover(f)).deferred, true);
        assert.deepEqual(await state(f), before);
        const { advanceAbacatePayStatementScans } =
          await import('../../src/contexts/billing/internal/abacatepay-statement-scan');
        const { createAbacatePayTransport } =
          await import('../../src/lib/payments/abacatepay/transport');
        const request = createAbacatePayTransport({
          apiKey: 'synthetic-only',
          storeId: account.accountId,
          timeoutMs: 1500,
        });
        for (let batch = 0; batch < 30; batch++) {
          const step = await advanceAbacatePayStatementScans(dbAdmin, account, request, {
            maxPages: 10,
          });
          assert.equal(step.failed, 0);
          const [remaining] =
            await sql`SELECT count(*)::int n FROM billing_gateway.statement_scans WHERE state='pending'`;
          if (remaining?.n === 0) break;
        }
        assert.equal((await recover(f)).applied, 1);
        assert.equal((await state(f)).invoices, 2);
        assert.equal((await state(f)).cycles, 1);
        assert.equal(await sourceCount(f), 1);
        assert.equal((await recover(f)).applied, 0);
      } finally {
        globalThis.fetch = previousFetch;
      }
    },
  );
  await check(
    'RECOVERY late and duplicated authenticated webhooks do not undo recovered rights or add invoices',
    async () => {
      const f = await recoveryFixture();
      assert.equal((await recover(f)).applied, 1);
      const before = await state(f);
      for (let i = 0; i < 2; i++) {
        const eventId = 'log_after_recovery_' + i + '_' + f.userId.replaceAll('-', '');
        await accept(f, eventId, f.evidence);
        assert.equal((await reconcileAbacatePayInbox({ eventId })).review, 0);
        assert.deepEqual(await state(f), before);
      }
    },
  );
  await check(
    'RECOVERY a received observation without invoice is completed without a fabricated event',
    async () => {
      const f = await recoveryFixture();
      await accept(f);
      assert.equal(
        await dbAdmin.transaction((tx) =>
          recordAbacatePayRecurringPaymentTx(tx, f.evidence, f.eventId),
        ),
        'recorded',
      );
      assert.equal((await state(f)).invoices, 1);
      assert.equal((await recover(f)).applied, 1);
      assert.equal((await state(f)).invoices, 2);
      assert.equal((await state(f)).observations, 1);
    },
  );
  await check(
    'RECOVERY a paid ledger repairs only its stale local period without another invoice/payment',
    async () => {
      const f = await recoveryFixture();
      assert.equal((await recover(f)).applied, 1);
      const before = await state(f);
      await sql`UPDATE public.subscriptions SET current_period_start=${f.anchor},current_period_end=${f.end},billing_status='past_due',dunning_stage=1 WHERE id=${f.subscription_id}::uuid`;
      assert.equal((await recover(f)).applied, 1);
      const after = await state(f);
      assert.equal(after.current_period_end, before.current_period_end);
      assert.equal(after.invoices, 2);
      assert.equal(after.cycles, 1);
      assert.equal(after.billing_status, 'active');
      assert.equal((await recover(f)).applied, 0);
      const [attempts] =
        await sql`SELECT count(*)::int n FROM public.payment_attempts p JOIN public.invoices i ON i.id=p.invoice_id WHERE i.subscription_id=${f.subscription_id}::uuid`;
      assert.equal(attempts?.n, 1);
    },
  );
  for (const phase of ['invoice', 'period'] as const) {
    await check(
      `RECOVERY ${phase} persistence failure rolls back provenance, invoice and rights; retry succeeds`,
      async () => {
        const f = await recoveryFixture(),
          before = await state(f);
        const table = phase === 'invoice' ? 'public.invoices' : 'public.subscriptions';
        await sql.unsafe(`CREATE FUNCTION public.synthetic_recovery_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Synthetic recovery persistence failure'; END $$;
        CREATE TRIGGER synthetic_recovery_failure BEFORE ${phase === 'invoice' ? 'INSERT' : 'UPDATE'} ON ${table}
        FOR EACH ROW EXECUTE FUNCTION public.synthetic_recovery_failure();`);
        try {
          assert.equal((await recover(f)).failed, 1);
          assert.deepEqual(await state(f), before);
          assert.equal(await sourceCount(f), 0);
        } finally {
          await sql.unsafe(
            `DROP TRIGGER synthetic_recovery_failure ON ${table}; DROP FUNCTION public.synthetic_recovery_failure();`,
          );
        }
        assert.equal((await recover(f)).applied, 1);
        assert.equal((await state(f)).invoices, 2);
      },
    );
  }
  await check(
    'RECOVERY quota-change failure rolls back payment, provenance and pending plan; retry grants exactly three seats',
    async () => {
      const f = await recoveryFixture();
      // Synthetic intent requested during the preceding paid period. The real
      // scheduling command is covered by MATRIX; an expired period correctly
      // rejects a new command, so do not weaken that guard to prepare recovery.
      const targetPlanId = await targetPlan('clinica_2026_3');
      await sql`INSERT INTO billing_gateway.plan_changes(account_id,subscription_id,clinic_id,
        external_subscription_id,generation_id,from_price_id,to_price_id,to_plan_id,product_id,
        amount_minor,effective_not_before,requested_by,requested_at,external_change_id)
        SELECT ${f.account_id}::uuid,${f.subscription_id}::uuid,${f.clinicId}::uuid,
          ${f.evidence.subscriptionId},${f.subscription_id}::uuid,s.price_id,p.id,${targetPlanId}::uuid,
          'prod_three',54400,${f.end},${f.userId}::uuid,${f.anchor},${`subu_${randomUUID().replaceAll('-', '')}`}
        FROM public.subscriptions s JOIN public.prices p ON p.plan_id=${targetPlanId}::uuid
          AND p.billing_cycle='monthly' AND p.campaign_code IS NULL
        WHERE s.id=${f.subscription_id}::uuid`;
      f.evidence = changedEvidence(f, 54400, 'prod_three');
      installHttpFixture(f, { providerPeriod: providerDates(f), amountMinor: 54400 });
      const before = await state(f),
        planBefore = await projection(f),
        commandsBefore = planPosts;
      await sql.unsafe(`CREATE FUNCTION public.synthetic_quota_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Synthetic quota persistence failure'; END $$;
        CREATE TRIGGER synthetic_quota_failure BEFORE UPDATE OF plan_id ON public.subscriptions
        FOR EACH ROW WHEN (OLD.plan_id IS DISTINCT FROM NEW.plan_id)
        EXECUTE FUNCTION public.synthetic_quota_failure();`);
      try {
        assert.equal((await recover(f)).failed, 1);
        assert.deepEqual(await state(f), before);
        assert.deepEqual(await projection(f), planBefore);
        assert.equal(await sourceCount(f), 0);
        const [pending] =
          await sql`SELECT invoice_id IS NULL pending FROM billing_gateway.plan_changes
          WHERE subscription_id=${f.subscription_id}::uuid`;
        assert.equal(pending?.pending, true);
      } finally {
        await sql.unsafe(`DROP TRIGGER synthetic_quota_failure ON public.subscriptions;
          DROP FUNCTION public.synthetic_quota_failure();`);
      }
      assert.equal((await recover(f)).applied, 1);
      assert.equal((await projection(f)).code, 'clinica_2026_3');
      assert.equal((await state(f)).invoices, 2);
      assert.equal(await sourceCount(f), 1);
      assert.equal((await recover(f)).applied, 0);
      assert.equal(planPosts, commandsBefore, 'Recovery must not issue another plan command');
      const [invoice] = await sql`SELECT i.total_amount::text amount FROM public.invoices i
        JOIN billing_gateway.plan_changes p ON p.invoice_id=i.id WHERE p.subscription_id=${f.subscription_id}::uuid`;
      assert.equal(invoice?.amount, '544.00');
      for (let index = 0; index < 4; index++) {
        const id = randomUUID();
        await sql`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${`${id}@example.invalid`})`;
        const insert = () => sql`INSERT INTO public.profiles(id,clinic_id,nome,role,ativo)
          VALUES(${id}::uuid,${f.clinicId}::uuid,'Synthetic recovered doctor','doctor',true)`;
        if (index < 3) await insert();
        else
          await assert.rejects(insert(), {
            code: '23514',
            constraint_name: 'offer_2026_seat_limit',
          });
      }
    },
  );
  await check(
    'RECOVERY interruption in operational audit after financial commit never duplicates the paid cycle on retry',
    async () => {
      const f = await recoveryFixture();
      await sql.unsafe(`CREATE FUNCTION public.synthetic_observation_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.type='subscription.renewal_recovery.observed' THEN
            RAISE EXCEPTION 'Synthetic post-commit observation failure';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER synthetic_observation_audit_failure BEFORE INSERT ON public.billing_events
        FOR EACH ROW EXECUTE FUNCTION public.synthetic_observation_audit_failure();`);
      try {
        const result = await recover(f);
        assert.equal(result.applied, 1);
        assert.equal(result.failed, 1);
        assert.equal((await state(f)).invoices, 2);
        assert.equal((await state(f)).cycles, 1);
      } finally {
        await sql.unsafe(`DROP TRIGGER synthetic_observation_audit_failure ON public.billing_events;
          DROP FUNCTION public.synthetic_observation_audit_failure();`);
      }
      const paid = await state(f);
      assert.equal((await recover(f)).applied, 0);
      assert.deepEqual(await state(f), paid);
      assert.equal(await sourceCount(f), 1);
    },
  );
  await check(
    'RECOVERY an older API receipt after a newer paid cycle cannot regress the subscription or issue another invoice',
    async () => {
      const f = await recoveryFixture({}, -35 * 86_400_000),
        oldEvidence = f.evidence;
      const historical = await recover(f);
      assert.equal(historical.applied, 0);
      assert.equal(historical.historical, 1);
      const start = month(f.anchor, 2),
        end = month(f.anchor, 3),
        suffix = randomUUID().replaceAll('-', '');
      f.evidence = {
        ...oldEvidence,
        paymentId: `char_newer_${suffix}`,
        statementId: `tran_newer_${suffix}`,
        providerPeriodStart: start.toISOString().slice(0, 10),
        providerPeriodEnd: end.toISOString().slice(0, 10),
        chargeCreatedAt: start.toISOString(),
        confirmedAt: new Date(start.getTime() + 1000).toISOString(),
      };
      installHttpFixture(f, { providerPeriod: providerDates(f) });
      await sql`UPDATE billing_gateway.statement_scans SET completed_at=now()-interval '61 seconds' WHERE state='complete'`;
      assert.equal((await recover(f)).applied, 1);
      const paid = await state(f);
      assert.equal(paid.invoices, 3);
      assert.equal(paid.cycles, 2);
      f.evidence = oldEvidence;
      installHttpFixture(f, { providerPeriod: providerDates(f) });
      await sql`UPDATE billing_gateway.statement_scans SET completed_at=now()-interval '61 seconds' WHERE state='complete'`;
      assert.equal((await recover(f)).applied, 0);
      assert.deepEqual(await state(f), paid);
      assert.equal(await sourceCount(f), 2);
    },
  );
  await check(
    'RECOVERY transient provider failure and timeout preserve proof and recover with GET only',
    async () => {
      for (const timeout of [false, true]) {
        const f = await recoveryFixture(),
          before = await state(f);
        if (timeout)
          globalThis.fetch = async () => {
            fixtureHttpCalls++;
            throw new Error('Synthetic timeout');
          };
        else installHttpFixture(f, { fail: true });
        assert.equal((await recover(f)).failed, 1);
        assert.deepEqual(await state(f), before);
        assert.equal(await sourceCount(f), 0);
        installHttpFixture(f, {
          providerPeriod: providerDates(f),
        });
        assert.equal((await recover(f)).applied, 1);
      }
    },
  );
  for (const mode of [
    'no_receipt',
    'multiple_receipts',
    'wrong_customer',
    'missing_dates',
    'live_resource',
  ] as const) {
    await check(`RECOVERY ${mode} cannot fabricate a payment or grant access`, async () => {
      const options =
        mode === 'no_receipt'
          ? { emptyStatements: true }
          : mode === 'multiple_receipts'
            ? { extraStatement: true }
            : mode === 'wrong_customer'
              ? { subscription: { customerId: 'cust_unrelated' } }
              : mode === 'live_resource'
                ? { subscription: { devMode: false } }
                : { subscription: { currentPeriodStart: undefined, currentPeriodEnd: undefined } };
      const f = await recoveryFixture(options),
        before = await state(f);
      const result = await recover(f);
      assert.equal(result.applied, 0);
      assert.ok(result.pending + result.review + result.failed > 0);
      assert.deepEqual(await state(f), before);
      assert.equal(await sourceCount(f), 0);
    });
  }
  await check(
    'RECOVERY cancellation during GET records money for review without extending access',
    async () => {
      const f = await recoveryFixture();
      installHttpFixture(f, {
        providerPeriod: providerDates(f),
        beforeStatement: async () => {
          await sql`UPDATE public.subscriptions SET cancel_at_period_end=true WHERE id=${f.subscription_id}::uuid`;
        },
      });
      const before = await state(f),
        result = await recover(f);
      assert.equal(result.applied, 0);
      assert.equal(result.review, 1);
      const after = await state(f);
      assert.equal(after.current_period_end, before.current_period_end);
      assert.equal(after.invoices, 2);
    },
  );
  await check(
    'RECOVERY insufficient job budget starts no API read or payment attempt',
    async () => {
      const f = await recoveryFixture(),
        before = await financialFingerprint(f),
        calls = fixtureHttpCalls;
      const result = await recoverRenewal(dbAdmin, {
        subscriptionId: f.subscription_id,
        deadlineMs: Date.now() + 1000,
      });
      assert.equal(result.deferred, true);
      assert.equal(result.scanned, 0);
      assert.equal(fixtureHttpCalls, calls);
      assert.deepEqual(await financialFingerprint(f), before);
    },
  );
  await check('RECOVERY API provenance denies other tenants and altered evidence', async () => {
    const f = await recoveryFixture();
    assert.equal((await recover(f)).applied, 1);
    const [row] = await sql<
      { id: string }[]
    >`SELECT id::text FROM billing_gateway.renewal_api_readbacks WHERE subscription_id=${f.subscription_id}::uuid`;
    assert.ok(row);
    const before = await state(f);
    assert.equal(
      await dbAdmin.transaction((tx) =>
        applyAbacatePayRenewalTx(
          tx,
          {
            ...f.evidence,
            confirmedAt: new Date(Date.parse(f.evidence.confirmedAt) + 1000).toISOString(),
          },
          { kind: 'provider_api', id: row.id },
        ),
      ),
      'review',
    );
    const other = await recoveryFixture();
    assert.equal(
      await dbAdmin.transaction((tx) =>
        applyAbacatePayRenewalTx(tx, other.evidence, { kind: 'provider_api', id: row.id }),
      ),
      'review',
    );
    assert.deepEqual(await state(f), before);
    assert.equal((await state(other)).invoices, 1);
  });
  await check(
    'RECOVERY source snapshots are private, immutable and cannot be deleted by service_role',
    async () => {
      for (const role of ['anon', 'authenticated', 'qoro_runtime', 'service_role']) {
        await assert.rejects(
          sql.begin(async (tx) => {
            await tx.unsafe(`SET LOCAL ROLE ${role}`);
            await tx`DELETE FROM billing_gateway.renewal_api_readbacks WHERE false`;
          }),
          { code: '42501' },
        );
        if (role !== 'service_role')
          await assert.rejects(
            sql.begin(async (tx) => {
              await tx.unsafe(`SET LOCAL ROLE ${role}`);
              await tx`SELECT * FROM billing_gateway.renewal_api_readbacks`;
            }),
            { code: '42501' },
          );
      }
      await assert.rejects(
        sql.begin(async (tx) => {
          await tx`SET LOCAL ROLE service_role`;
          await tx`UPDATE billing_gateway.renewal_api_readbacks SET proof_hash=repeat('a',64) WHERE false`;
        }),
        { code: '42501' },
      );
    },
  );
  await check(
    'CLOSURE private paid generation and unchanged ledger survive one concurrent remote close',
    async () => {
      const f = await recoveryFixture();
      installHttpFixture(f, { close: 'success', providerPeriod: providerDates(f) });
      const before = await state(f),
        posts = closurePosts;
      const close = () =>
        closeCheckout(dbAdmin, {
          subscriptionId: f.subscription_id,
          checkoutId: f.evidence.originCheckoutId,
        });
      const outcomes = await Promise.allSettled(Array.from({ length: 8 }, close));
      assert.ok(outcomes.some((result) => result.status === 'fulfilled'));
      assert.equal((await close()).closed, true);
      assert.equal(closurePosts - posts, 1);
      assert.deepEqual(await state(f), before);
      const [journal] =
        await sql`SELECT state,result->>'checkoutId' checkout FROM billing_gateway.operations
      WHERE subscription_id=${f.subscription_id}::uuid AND kind='close_paid_checkout'`;
      assert.deepEqual(journal, { state: 'confirmed', checkout: f.evidence.originCheckoutId });
      assert.equal((await recover(f)).applied, 1);
      assert.equal((await state(f)).invoices, 2);
      await accept(f);
      assert.equal((await reconcileAbacatePayInbox({ eventId: f.eventId })).review, 0);
      assert.equal((await state(f)).invoices, 2);
      const initialEvent = `log_closed_initial_${randomUUID()}`;
      await accept(f, initialEvent, f.evidence, 'subscription.completed');
      assert.equal((await reconcileAbacatePayInbox({ eventId: initialEvent })).review, 0);
      assert.equal((await state(f)).invoices, 2);
      installPlanHttpFixture(f);
      const financialRead = globalThis.fetch;
      globalThis.fetch = async (target, init) => {
        assert.equal(new URL(String(target)).pathname.endsWith('/checkouts/get'), false);
        return financialRead(target, init);
      };
      const result = await changePlan(dbAdmin, {
        clinicId: f.clinicId,
        requestedBy: f.userId,
        contractId: f.subscription_id,
        targetPlanId: await targetPlan('clinica_2026_3'),
      });
      assert.equal(result.state, 'scheduled');
      assert.equal((await state(f)).invoices, 2);
    },
  );
  await check(
    'CLOSURE timeout is durable unknown and never resends; receipt recovery remains available',
    async () => {
      const f = await recoveryFixture(),
        posts = closurePosts;
      installHttpFixture(f, { close: 'timeout', providerPeriod: providerDates(f) });
      const close = () =>
        closeCheckout(dbAdmin, {
          subscriptionId: f.subscription_id,
          checkoutId: f.evidence.originCheckoutId,
        });
      for (let i = 0; i < 2; i++) await assert.rejects(close(), { code: 'operation_unknown' });
      assert.equal(closurePosts - posts, 1);
      const [operation] =
        await sql`SELECT state FROM billing_gateway.operations WHERE subscription_id=${f.subscription_id}::uuid AND kind='close_paid_checkout'`;
      assert.equal(operation?.state, 'unknown');
      assert.equal((await recover(f)).applied, 1);
    },
  );
  await check(
    'CLOSURE post-command subscription inconsistency remains unknown without a second POST',
    async () => {
      const f = await recoveryFixture(),
        before = await state(f),
        posts = closurePosts;
      installHttpFixture(f, { close: 'subscription_changed' });
      const close = () =>
        closeCheckout(dbAdmin, {
          subscriptionId: f.subscription_id,
          checkoutId: f.evidence.originCheckoutId,
        });
      for (let i = 0; i < 2; i++) await assert.rejects(close(), { code: 'operation_unknown' });
      assert.equal(closurePosts - posts, 1);
      assert.deepEqual(await state(f), before);
    },
  );
  await check(
    'CLOSURE refuses an unpaid intent, another tenant and multiple subscriptions before POST',
    async () => {
      const f = await seed(-120_000, 'clinica_2026_2', false),
        other = await recoveryFixture(),
        posts = closurePosts;
      installHttpFixture(f, { close: 'success' });
      await assert.rejects(
        closeCheckout(dbAdmin, {
          subscriptionId: f.subscription_id,
          checkoutId: f.evidence.originCheckoutId,
        }),
        { code: 'binding_mismatch' },
      );
      await assert.rejects(
        closeCheckout(dbAdmin, {
          subscriptionId: f.subscription_id,
          checkoutId: other.evidence.originCheckoutId,
        }),
        { code: 'binding_mismatch' },
      );
      installHttpFixture(other, { close: 'success', extraSubscription: true });
      await assert.rejects(
        closeCheckout(dbAdmin, {
          subscriptionId: other.subscription_id,
          checkoutId: other.evidence.originCheckoutId,
        }),
        { code: 'operation_unknown' },
      );
      assert.equal(closurePosts, posts);
    },
  );
  await check(
    'CLOSURE refund statement remains readable without the consumed checkout or access revocation',
    async () => {
      const f = await recoveryFixture();
      installHttpFixture(f, { close: 'success', refundMinor: 39700 });
      await closeCheckout(dbAdmin, {
        subscriptionId: f.subscription_id,
        checkoutId: f.evidence.originCheckoutId,
      });
      const before = await state(f),
        eventId = `log_closed_refund_${randomUUID()}`;
      await accept(f, eventId, f.evidence, 'checkout.refunded');
      const result = await reconcileAbacatePayInbox({ eventId });
      assert.equal(result.review, 1);
      assert.deepEqual(await state(f), before);
      const [proof] =
        await sql`SELECT payload->>'evidenceLevel' level,payload->>'checkoutStatus' status
      FROM public.billing_events WHERE clinic_id=${f.clinicId}::uuid AND type='subscription.financial.notification_checked'`;
      assert.deepEqual(proof, { level: 'refund_debit_verified', status: null });
    },
  );
  await check(
    'OPS minute inbox tick drains bounded oldest batches and isolates another store',
    async () => {
      const ids = Array.from({ length: 21 }, () => `log_tick_${randomUUID()}`);
      const [owned] = await sql`SELECT id FROM billing_gateway.accounts WHERE provider='abacatepay'
      AND environment='sandbox' AND external_account_id=${account.accountId}`;
      assert.ok(owned);
      await sql`INSERT INTO billing_gateway.event_inbox(account_id,event_id,event_type,payload_hash,received_at)
      SELECT ${owned.id}::uuid,value,'unsupported.synthetic',${'a'.repeat(64)},'2000-01-01'::timestamptz
      FROM jsonb_array_elements_text(${sql.json(ids)}::jsonb)`;
      const [foreign] =
        await sql`INSERT INTO billing_gateway.accounts(provider,environment,external_account_id)
      VALUES('abacatepay','sandbox',${`store_tick_${randomUUID()}`}) RETURNING id`;
      assert.ok(foreign);
      const foreignId = `log_tick_foreign_${randomUUID()}`;
      await sql`INSERT INTO billing_gateway.event_inbox(account_id,event_id,event_type,payload_hash,received_at)
      VALUES(${foreign.id}::uuid,${foreignId},'unsupported.synthetic',${'b'.repeat(64)},'1999-01-01')`;
      const before = await state(first),
        calls = fixtureHttpCalls;
      for (const ignored of [10, 20]) {
        const tick = await reconcileAbacatePayInboxTick();
        assert.equal(tick.scanned, 10);
        assert.equal(tick.deferred, true);
        const [count] = await sql`SELECT count(*)::int n FROM billing_gateway.event_inbox
        WHERE event_id IN(SELECT jsonb_array_elements_text(${sql.json(ids)}::jsonb)) AND state='ignored'`;
        assert.equal(count?.n, ignored);
      }
      const [other] = await sql`SELECT state,attempts FROM billing_gateway.event_inbox
      WHERE account_id=${foreign.id}::uuid AND event_id=${foreignId}`;
      assert.deepEqual(other, { state: 'received', attempts: 0 });
      assert.deepEqual(await state(first), before);
      assert.equal(fixtureHttpCalls, calls);
    },
  );
  const { env: runtimeEnv } = await import('../../src/lib/env');
  const savedAccount = account,
    savedInbox = inbox;
  const savedRuntime = {
    NODE_ENV: runtimeEnv.NODE_ENV,
    VERCEL_ENV: runtimeEnv.VERCEL_ENV,
    ABACATEPAY_ENVIRONMENT: runtimeEnv.ABACATEPAY_ENVIRONMENT,
    ABACATEPAY_PLAN_PRODUCTS: runtimeEnv.ABACATEPAY_PLAN_PRODUCTS,
    SAAS_SIGNUP_PROVIDER: runtimeEnv.SAAS_SIGNUP_PROVIDER,
  };
  try {
    account = { ...account, environment: 'production' };
    inbox = createPostgresGatewayInbox(account, dbAdmin);
    Object.assign(runtimeEnv, {
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
      ABACATEPAY_ENVIRONMENT: 'production',
      SAAS_SIGNUP_PROVIDER: 'abacatepay_production',
      ABACATEPAY_PLAN_PRODUCTS: runtimeEnv.ABACATEPAY_SANDBOX_PLAN_PRODUCTS,
    });
    await check(
      'LIVE synthetic trial creates a Production binding, never a Sandbox fallback',
      async () => {
        const f = await seed(-3600000, 'clinica_2026_2', false);
        const [bound] = await sql`SELECT a.environment FROM billing_gateway.bindings b
        JOIN billing_gateway.accounts a ON a.id=b.account_id WHERE b.subscription_id=${f.subscription_id}::uuid`;
        assert.equal(bound?.environment, 'production');
        const { applyInitialAbacatePayPaymentTx } =
          await import('../../src/contexts/billing/internal/abacatepay-processing');
        const payment = {
          account,
          subscriptionId: f.evidence.subscriptionId,
          customerId: f.evidence.customerId,
          checkoutId: f.evidence.originCheckoutId,
          amountMinor: 39700,
          paidAmountMinor: 39700,
          currency: 'BRL' as const,
          state: 'paid' as const,
          rawStatus: 'PAID',
          settlement: 'unknown' as const,
          subscriptionCreatedAt: new Date().toISOString(),
          recurrence: 'running' as const,
        };
        const beforePayment = await state(f);
        assert.equal(
          await dbAdmin.transaction((tx) =>
            applyInitialAbacatePayPaymentTx(tx, { ...payment, account: savedAccount }),
          ),
          'review',
        );
        assert.deepEqual(await state(f), beforePayment);
        const applications = await Promise.all(
          Array.from({ length: 8 }, () =>
            dbAdmin.transaction((tx) => applyInitialAbacatePayPaymentTx(tx, payment)),
          ),
        );
        assert.equal(applications.filter((v) => v === 'applied').length, 1);
        assert.equal((await state(f)).invoices, 1);
        assert.equal((await state(f)).billing_status, 'active');
      },
    );
    await check(
      'LIVE synthetic renewal applies once and refuses a Sandbox account for the same store',
      async () => {
        const f = await seed();
        await accept(f);
        const bad = { ...f.evidence, account: savedAccount };
        const before = await state(f);
        assert.equal(await apply(f, bad), 'review');
        assert.deepEqual(await state(f), before);
        const outcomes = await Promise.all(Array.from({ length: 8 }, () => apply(f)));
        assert.equal(outcomes.filter((result) => result === 'applied').length, 1);
        assert.equal((await state(f)).invoices, 2);
        assert.equal((await state(f)).cycles, 1);
      },
    );
    await check(
      'LIVE private review retains actor, account binding and replay authorization',
      async () => {
        const f = await reviewFixture();
        const result = await queue(await approvalInput(f));
        assert.ok(result);
        const [count] = await sql`SELECT count(*)::int n FROM billing_gateway.review_replays
        WHERE account_id=${f.account_id}::uuid AND event_id=${f.eventId}`;
        assert.equal(count?.n, 1);
        assert.equal((await state(f)).invoices, 1);
      },
    );
  } finally {
    account = savedAccount;
    inbox = savedInbox;
    Object.assign(runtimeEnv, savedRuntime);
  }
  assert.equal(networkCalls, 0);
} catch (error) {
  failure = error;
} finally {
  globalThis.fetch = originalFetch;
  await mkdir('dist', { recursive: true });
  await writeFile(
    tissProof
      ? `dist/abacatepay-renewal-tiss-${String(tissProof.lastIndex).padStart(4, '0')}-db.json`
      : 'dist/abacatepay-renewal-db.json',
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        environment: 'loopback_synthetic',
        migrations: (await readMigrations()).length,
        ...(tissProof
          ? {
              tissHead: tissProof.head,
              tissSources: tissProof.sources.map(({ idx, when, tag, sha256 }) => ({
                idx,
                when,
                tag,
                sha256,
              })),
              combinedMigrationCount: tissProof.ordered.length,
              tissSourceAccess: tissProof.sourceAccess,
            }
          : {}),
        additionalCandidateDdl:
          'saas_period_snapshot.candidate.sql; loopback only, not in migration journal',
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
