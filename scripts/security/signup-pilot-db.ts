/** Owned loopback PostgreSQL only. No gateway, email or shared database operations. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { startScratchSchema } from './scratch-schema';

const cluster = await startScratchSchema({ port: 55493 });
const sql = cluster.sql;
assert.equal(new URL(cluster.url).hostname, '127.0.0.1');
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: cluster.url,
  DATABASE_URL_DEV: cluster.url,
  DATABASE_URL_RUNTIME: cluster.url,
  SUPABASE_PROJECT_ENV: 'dev',
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_pilot',
  SIGNUP_ENABLED: 'false',
  SIGNUP_AUTH_ENABLED: 'true',
  SIGNUP_IDENTITY_ENABLED: 'true',
  SAAS_SIGNUP_PROVIDER: 'asaas',
  ABACATEPAY_PILOT_PROVISIONING_ENABLED: 'true',
  ABACATEPAY_STORE_ID: 'store_synthetic',
  ABACATEPAY_API_KEY: 'synthetic-only',
  ABACATEPAY_SANDBOX_PROBE_PRODUCT_ID: 'prod_probe',
  ABACATEPAY_NEW_CHECKOUTS_ENABLED: 'false',
  MAGIC_TOKEN_SECRET: randomBytes(32).toString('hex'),
  LOGIN_HASH_PEPPER: randomBytes(32).toString('hex'),
  CRYPTO_SECRET_BACKEND: 'env',
  CRYPTO_MASTER_KEY_V1: Buffer.alloc(32, 7).toString('base64'),
  CRYPTO_LOOKUP_SALT: Buffer.alloc(32, 9).toString('base64'),
  LOG_LEVEL: 'error',
});
delete process.env.VERCEL_ENV;
delete process.env.DATABASE_URL_PROD;
let networkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  networkCalls++;
  throw new Error('External network forbidden in pilot SQL proof');
};
const { dbAdmin } = await import('../../src/lib/db');
const { sql: statement } = await import('drizzle-orm');
const { hashEmail } = await import('../../src/lib/auth/email-hash');
const { issuePilotInviteTx, pilotIdentityCondition } =
  await import('../../src/contexts/onboarding/internal/signup-pilot-repository');
const { provisionPilotSignupTx } =
  await import('../../src/contexts/onboarding/internal/signup-pilot');
const { createPendingSignupAppMetadata, markSignupPasswordSet } =
  await import('../../src/contexts/onboarding/internal/signup-auth-binding');
const { hashToken } = await import('../../src/contexts/onboarding/internal/token');
const { applyInitialAbacatePayPaymentTx } =
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
let failure: unknown;
try {
  await sql`UPDATE public.plans SET ativo=true WHERE code='consultorio_2026'`;
  const adminId = randomUUID(),
    userId = randomUUID(),
    raw = randomBytes(32).toString('hex'),
    ref = randomBytes(32).toString('hex');
  const identity = {
    ownerName: 'Synthetic pilot owner',
    clinicName: 'Synthetic pilot clinic',
    email: `pilot-${randomUUID()}@example.invalid`,
  };
  await sql`INSERT INTO auth.users(id,email) VALUES(${adminId}::uuid,'synthetic-admin@example.invalid')`;
  const issue = () =>
    dbAdmin.transaction((tx) =>
      issuePilotInviteTx(tx, { identity, createdBy: adminId, tokenHash: hashToken(raw) }),
    );
  for (const scenario of [
    'existing Auth email',
    'existing clinic name',
    'pending conventional invite',
  ] as const) {
    await check(
      `authorization refuses ${scenario} without adopting or duplicating it`,
      async () => {
        const rollback = new Error('owned_fixture_rollback');
        await assert.rejects(
          dbAdmin.transaction(async (tx) => {
            if (scenario === 'existing Auth email')
              await tx.execute(
                statement`INSERT INTO auth.users(id,email) VALUES(${randomUUID()}::uuid,${identity.email})`,
              );
            else if (scenario === 'existing clinic name')
              await tx.execute(
                statement`INSERT INTO public.clinics(id,slug,nome) VALUES(${randomUUID()}::uuid,${'synthetic-' + randomUUID()},${identity.clinicName})`,
              );
            else
              await tx.execute(
                statement`INSERT INTO public.clinic_invites(token_hash,created_by,email,expires_at,plan_snapshot,metadata) VALUES(${randomBytes(32).toString('hex')},${adminId}::uuid,${identity.email},now()+interval '1 hour','{}'::jsonb,'{}'::jsonb)`,
              );
            await assert.rejects(
              issuePilotInviteTx(tx, { identity, createdBy: adminId, tokenHash: hashToken(raw) }),
              /conflict/,
            );
            throw rollback;
          }),
          (error) => error === rollback,
        );
      },
    );
  }
  let inviteId = '';
  await check('twelve concurrent authorizations persist one invitation', async () => {
    const rows = await Promise.all(Array.from({ length: 12 }, issue));
    assert.equal(new Set(rows.map((r) => r.id)).size, 1);
    assert.equal(rows.filter((r) => r.created).length, 1);
    inviteId = rows[0]!.id;
  });
  await check('repeat authorization does not generate another invitation', async () =>
    assert.deepEqual(await issue(), { id: inviteId, created: false, reissued: true }),
  );
  await check(
    'lost response rotates only the unclaimed link without a second reservation',
    async () => {
      const replacement = 'd'.repeat(64);
      const renewed = await dbAdmin.transaction((tx) =>
        issuePilotInviteTx(tx, {
          identity,
          createdBy: adminId,
          tokenHash: hashToken(replacement),
        }),
      );
      assert.equal(renewed.id, inviteId);
      const [row] =
        await sql`SELECT count(*)::int n FROM clinic_invites WHERE token_hash=${hashToken(raw)}`;
      assert.equal(row?.n, 0);
      await issue();
    },
  );
  await check('another beneficiary cannot enter the single pilot cohort', async () => {
    await assert.rejects(
      dbAdmin.transaction((tx) =>
        issuePilotInviteTx(tx, {
          identity: { ...identity, email: 'other@example.invalid' },
          createdBy: adminId,
          tokenHash: 'c'.repeat(64),
        }),
      ),
      /conflict/,
    );
  });
  await sql`UPDATE public.clinic_invites SET status='started',metadata=jsonb_set(metadata,'{signupRef}',to_jsonb(${ref}::text)) WHERE id=${inviteId}::uuid`;
  await check(
    'reissuing never invalidates the link of an account already in progress',
    async () => {
      assert.deepEqual(
        await dbAdmin.transaction((tx) =>
          issuePilotInviteTx(tx, {
            identity,
            createdBy: adminId,
            tokenHash: hashToken('e'.repeat(64)),
          }),
        ),
        { id: inviteId, created: false },
      );
      const [row] =
        await sql`SELECT count(*)::int n FROM clinic_invites WHERE token_hash=${hashToken(raw)}`;
      assert.equal(row?.n, 1);
    },
  );
  const [price] = await sql<
    { id: string; price_id: string }[]
  >`SELECT p.id::text,pr.id::text price_id FROM plans p JOIN prices pr ON pr.plan_id=p.id
    WHERE p.code='consultorio_2026' AND pr.billing_cycle='monthly' AND pr.campaign_code IS NULL AND pr.active_until IS NULL`;
  assert(price);
  const createdAt = new Date(Date.now() - 86_400_000).toISOString();
  await sql`INSERT INTO auth.users(id,email,email_confirmed_at,created_at) VALUES(${userId}::uuid,${identity.email},now(),${createdAt})`;
  await sql`INSERT INTO public.signup_sessions(token_hash,status,idle_expires_at,absolute_expires_at,consumed_at,auth_user_id,
    owner_name,clinic_name,email_hash,accepted_at,answered_at,professionals_band,weekly_appointments_band,current_tooling,discovery_source,selected_plan_id)
    VALUES(${ref},'email_verified',now()+interval '40 minutes',now()+interval '50 minutes',now(),${userId}::uuid,
      ${identity.ownerName},${identity.clinicName},${hashEmail(identity.email)},now(),now(),'1','ate_20','nada_papel','outro',${price.id}::uuid)`;
  const pending = createPendingSignupAppMetadata(ref, true);
  const user = {
    id: userId,
    email: identity.email,
    email_confirmed_at: new Date().toISOString(),
    created_at: createdAt,
    app_metadata: markSignupPasswordSet({ app_metadata: pending }, ref),
  };
  const run = () => dbAdmin.transaction((tx) => provisionPilotSignupTx(tx, raw, user));
  await check('wrong email cannot claim the approved reservation', async () => {
    await assert.rejects(
      dbAdmin.transaction((tx) =>
        provisionPilotSignupTx(tx, raw, { ...user, email: 'other@example.invalid' }),
      ),
      /forbidden/,
    );
  });
  await check('unconfirmed email cannot provision a tenant', async () => {
    await assert.rejects(
      dbAdmin.transaction((tx) =>
        provisionPilotSignupTx(tx, raw, { ...user, email_confirmed_at: '' }),
      ),
      /forbidden/,
    );
  });
  await check('missing trusted password binding cannot provision', async () => {
    await assert.rejects(
      dbAdmin.transaction((tx) => provisionPilotSignupTx(tx, raw, { ...user, app_metadata: {} })),
      /forbidden/,
    );
  });
  await check('unknown invitation is denied without changes', async () => {
    await assert.rejects(
      dbAdmin.transaction((tx) => provisionPilotSignupTx(tx, 'e'.repeat(64), user)),
      /forbidden/,
    );
  });
  await check('expiry rejects provisioning', async () => {
    await sql`UPDATE clinic_invites SET expires_at=now()-interval '1 second' WHERE id=${inviteId}::uuid`;
    await assert.rejects(run(), /expired/);
    await sql`UPDATE clinic_invites SET expires_at=now()+interval '1 hour' WHERE id=${inviteId}::uuid`;
  });
  await check('tampered selected plan is refused before tenant creation', async () => {
    await sql`UPDATE signup_sessions SET selected_plan_id=(SELECT id FROM plans WHERE code='clinica_2026_2') WHERE token_hash=${ref}`;
    await assert.rejects(run(), /forbidden/);
    await sql`UPDATE signup_sessions SET selected_plan_id=${price.id}::uuid WHERE token_hash=${ref}`;
  });
  await check('actual SQL identity predicate rejects a foreign address', async () => {
    const [condition] = await dbAdmin.execute<{ allowed: boolean }>(
      (await import('drizzle-orm'))
        .sql`SELECT ${pilotIdentityCondition(ref, { email: 'other@example.invalid' })} allowed`,
    );
    assert.equal(condition?.allowed, false);
  });
  await check('failure after tenant creation rolls back the entire reservation', async () => {
    await assert.rejects(
      dbAdmin.transaction(async (tx) => {
        await provisionPilotSignupTx(tx, raw, user);
        throw new Error('synthetic interruption');
      }),
      /synthetic interruption/,
    );
    const [state] =
      await sql`SELECT status,provisioned_clinic_id FROM clinic_invites WHERE id=${inviteId}::uuid`;
    assert.equal(state?.status, 'started');
    assert.equal(state?.provisioned_clinic_id, null);
    const [count] = await sql`SELECT count(*)::int n FROM profiles WHERE id=${userId}::uuid`;
    assert.equal(count?.n, 0);
  });
  await check('twelve concurrent retries create one owner, clinic, trial and binding', async () => {
    const outputs = await Promise.all(Array.from({ length: 12 }, run));
    assert(outputs.every((r) => r.state === 'provisioned'));
  });
  const [contract] = await sql<
    { clinic_id: string; subscription_id: string; account_id: string; price_id: string }[]
  >`
    SELECT s.clinic_id::text,s.id::text subscription_id,b.account_id::text,s.price_id::text FROM subscriptions s
    JOIN billing_gateway.bindings b ON b.subscription_id=s.id JOIN profiles p ON p.clinic_id=s.clinic_id WHERE p.id=${userId}::uuid`;
  assert(contract);
  await check('one complete unpaid Consultorio contract and no external checkout', async () => {
    const [row] =
      await sql`SELECT count(*)::int n,max(sl.doctors)::int doctors,max(sl.staff)::int staff,max(pr.amount)::text amount,
      bool_and(s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL AND s.billing_status='trial') unpaid
      FROM subscriptions s JOIN plan_seat_limits sl ON sl.plan_id=s.plan_id JOIN prices pr ON pr.id=s.price_id WHERE s.clinic_id=${contract.clinic_id}::uuid`;
    assert.deepEqual(row, { n: 1, doctors: 1, staff: 3, amount: '197.00', unpaid: true });
    const [paid] =
      await sql`SELECT count(*)::int n FROM invoices WHERE clinic_id=${contract.clinic_id}::uuid`;
    assert.equal(paid?.n, 0);
    assert.equal(networkCalls, 0);
  });
  await check('completed invite cannot bootstrap a second beneficiary', async () => {
    const { assertLivePilot, parsePilot } =
      await import('../../src/contexts/onboarding/internal/signup-pilot-repository');
    const { clinicInvites } = await import('../../src/contexts/onboarding/schema');
    const [row] = await dbAdmin.select().from(clinicInvites);
    assert(row);
    assert.throws(() => assertLivePilot(parsePilot(row)), /forbidden/);
  });
  const checkoutId = `bill_${randomUUID().replaceAll('-', '')}`;
  await sql`UPDATE billing_gateway.bindings SET external_checkout_id=${checkoutId} WHERE subscription_id=${contract.subscription_id}::uuid`;
  await sql`INSERT INTO billing_gateway.checkout_intents(subscription_id,clinic_id,account_id,price_id,product_id,amount_minor)
    VALUES(${contract.subscription_id}::uuid,${contract.clinic_id}::uuid,${contract.account_id}::uuid,${contract.price_id}::uuid,'prod_synthetic',19700)`;
  const evidence: Evidence = {
    account: { provider: 'abacatepay', environment: 'sandbox', accountId: 'store_synthetic' },
    subscriptionId: `subs_${randomUUID().replaceAll('-', '')}`,
    customerId: `cust_${randomUUID().replaceAll('-', '')}`,
    checkoutId,
    amountMinor: 19700,
    paidAmountMinor: 19700,
    currency: 'BRL',
    state: 'paid',
    rawStatus: 'PAID',
    settlement: 'unknown',
    subscriptionCreatedAt: new Date(Date.now() - 60_000).toISOString(),
    recurrence: 'running',
  };
  await check('unconfirmed payment cannot grant paid entitlements', async () => {
    assert.equal(
      await dbAdmin.transaction((tx) =>
        applyInitialAbacatePayPaymentTx(tx, {
          ...evidence,
          state: 'pending',
          paidAmountMinor: null,
        }),
      ),
      'review',
    );
    const [r] =
      await sql`SELECT released_at FROM trial_access_policies WHERE clinic_id=${contract.clinic_id}::uuid`;
    assert.equal(r?.released_at, null);
  });
  await check(
    'confirmed synthetic payment releases trial with one invoice under concurrent replay',
    async () => {
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          dbAdmin.transaction((tx) => applyInitialAbacatePayPaymentTx(tx, evidence)),
        ),
      );
      assert.equal(results.filter((r) => r === 'applied').length, 1);
      const [r] =
        await sql`SELECT (SELECT count(*)::int FROM invoices WHERE clinic_id=${contract.clinic_id}::uuid AND status='paid') paid,
      released_at IS NOT NULL released FROM trial_access_policies WHERE clinic_id=${contract.clinic_id}::uuid`;
      assert.deepEqual(r, { paid: 1, released: true });
    },
  );
  await check('private grant and gateway tables remain denied to anonymous', async () => {
    await assert.rejects(
      sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE anon`;
        await tx`SELECT * FROM clinic_invites`;
      }),
      /permission denied/,
    );
  });
  assert.equal(networkCalls, 0);
} catch (error) {
  failure = error;
  console.error(error instanceof Error ? error.message : 'Synthetic proof failed');
} finally {
  globalThis.fetch = originalFetch;
  await mkdir('dist', { recursive: true });
  await writeFile(
    'dist/signup-pilot-db.json',
    JSON.stringify(
      {
        status: failure ? 'FAIL' : 'PASS',
        checks: results,
        networkCalls,
        scope:
          'owned loopback PostgreSQL with synthetic Auth rows and synthetic financial evidence; no external payment or login proof',
        productionWrites: 0,
      },
      null,
      2,
    ),
  );
  await dbAdmin.$client.end({ timeout: 2 });
  await cluster.stop();
}
if (failure) throw new Error('Pilot SQL proof failed; see sanitized report');
console.log(JSON.stringify({ status: 'PASS', checks: results.length, networkCalls: 0 }));
