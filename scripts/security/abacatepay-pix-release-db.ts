/** Rehearse the composed commercial journal on a disposable loopback PostgreSQL. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { z } from 'zod';

import { startScratchSchema } from './scratch-schema';

const generated = process.env.QORO_PIX_MIGRATION_FOLDER
  ? { migrationFolder: process.env.QORO_PIX_MIGRATION_FOLDER }
  : z
      .object({ migrationFolder: z.string() })
      .parse(
        JSON.parse(
          execFileSync(
            process.execPath,
            ['node_modules/tsx/dist/cli.mjs', 'scripts/abacatepay-pix-release.ts'],
            { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
          ),
        ),
      );
const folder = path.resolve(generated.migrationFolder);
assert.ok(folder.startsWith(path.resolve('dist') + path.sep));
const journal = z
  .object({
    version: z.string(),
    dialect: z.string(),
    entries: z.array(
      z.object({
        idx: z.number().int(),
        tag: z.string(),
        when: z.number().int(),
        version: z.string(),
        breakpoints: z.boolean(),
      }),
    ),
  })
  .parse(JSON.parse(await readFile(path.join(folder, 'meta/_journal.json'), 'utf8')));
assert.equal(journal.entries.length, 169);
const prefixFolder = await mkdtemp(path.resolve('dist/abacatepay-pix-prefix-'));
assert.ok(prefixFolder.startsWith(path.resolve('dist') + path.sep));
await mkdir(path.join(prefixFolder, 'meta'));
await writeFile(
  path.join(prefixFolder, 'meta/_journal.json'),
  JSON.stringify({ ...journal, entries: journal.entries.slice(0, 160) }) + '\n',
);
for (const entry of journal.entries.slice(0, 160))
  await copyFile(
    path.join(folder, `${entry.tag}.sql`),
    path.join(prefixFolder, `${entry.tag}.sql`),
  );
const cluster = await startScratchSchema({ port: 55453 });
const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');
try {
  await cluster.sql`CREATE SCHEMA drizzle`;
  await cluster.sql`CREATE TABLE drizzle.__drizzle_migrations(id serial PRIMARY KEY,hash text NOT NULL,created_at bigint NOT NULL)`;
  // This journal is synthetic test scaffolding: the schema loader already ran
  // the exact 0000-0142 SQL; the real migrator will execute 0143-0168 below.
  for (const entry of journal.entries.slice(0, 143)) {
    const body = await readFile(path.join(folder, `${entry.tag}.sql`));
    await cluster.sql`INSERT INTO drizzle.__drizzle_migrations(hash,created_at)
      VALUES(${sha256(body)},${entry.when})`;
  }
  const before = await cluster.sql`SELECT count(*)::int n FROM drizzle.__drizzle_migrations`;
  assert.equal(before[0]?.n, 143);
  const database = drizzle(cluster.sql);
  await migrate(database, { migrationsFolder: prefixFolder });
  const [productionBaseline] =
    await cluster.sql`SELECT count(*)::int n FROM drizzle.__drizzle_migrations`;
  assert.equal(productionBaseline?.n, 160);
  const [pixBefore] =
    await cluster.sql`SELECT to_regclass('billing_gateway.pix_replacement_intents') IS NOT NULL present`;
  assert.equal(pixBefore?.present, false);
  const started = performance.now();
  await migrate(database, { migrationsFolder: folder });
  const migrationMs = Math.round(performance.now() - started);
  const [after] = await cluster.sql`SELECT count(*)::int n,max(created_at)::text last
    FROM drizzle.__drizzle_migrations`;
  assert.equal(after?.n, 169);
  assert.equal(after.last, String(journal.entries[168]!.when));
  const [security] = await cluster.sql`SELECT
    c.relrowsecurity AND c.relforcerowsecurity secured,
    has_table_privilege('authenticated',c.oid,'SELECT') authenticated_read,
    has_table_privilege('service_role',c.oid,'DELETE') service_delete,
    (SELECT count(*)::int FROM pg_constraint WHERE conrelid=c.oid AND contype='f' AND convalidated) foreign_keys,
    (SELECT count(*)::int FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal AND tgenabled IN ('O','A')) triggers,
    EXISTS(SELECT 1 FROM pg_index i JOIN pg_class ix ON ix.oid=i.indexrelid
      WHERE i.indrelid=c.oid AND ix.relname='gateway_one_open_pix_replacement_intent'
        AND i.indisunique AND i.indisvalid AND i.indpred IS NOT NULL) unique_open
    FROM pg_class c WHERE c.oid='billing_gateway.pix_replacement_intents'::regclass`;
  assert.deepEqual(security, {
    secured: true,
    authenticated_read: false,
    service_delete: false,
    foreign_keys: 4,
    triggers: 1,
    unique_open: true,
  });
  const clinicId = randomUUID();
  const ownerId = randomUUID();
  const accountId = randomUUID();
  const generationId = randomUUID();
  const [catalog] = await cluster.sql<
    { from_id: string; to_id: string; to_plan_id: string }[]
  >`SELECT initial.id::text from_id,destination.id::text to_id,destination.plan_id::text to_plan_id
    FROM public.prices initial JOIN public.plans p1 ON p1.id=initial.plan_id
    CROSS JOIN public.prices destination JOIN public.plans p2 ON p2.id=destination.plan_id
    WHERE p1.code='consultorio_2026' AND p2.code='clinica_2026_2'
      AND initial.billing_cycle='monthly' AND destination.billing_cycle='monthly'
      AND initial.active_until IS NULL AND destination.active_until IS NULL
      AND initial.campaign_code IS NULL AND destination.campaign_code IS NULL LIMIT 1`;
  assert.ok(catalog);
  await cluster.sql`INSERT INTO auth.users(id,email) VALUES(${ownerId}::uuid,${`${ownerId}@example.invalid`})`;
  await cluster.sql`INSERT INTO public.clinics(id,slug,nome,status)
    VALUES(${clinicId}::uuid,${`pix-${clinicId.slice(0, 8)}`},'Synthetic Pix clinic','active')`;
  await cluster.sql`INSERT INTO public.profiles(id,clinic_id,nome,role,ativo,invite_accepted_at)
    VALUES(${ownerId}::uuid,${clinicId}::uuid,'Synthetic owner','owner',true,now())`;
  const [subscription] = await cluster.sql<{ id: string }[]>`INSERT INTO public.subscriptions
    (clinic_id,plan_id,price_id,billing_status,trial_ends_at,billing_provider)
    VALUES(${clinicId}::uuid,(SELECT plan_id FROM public.prices WHERE id=${catalog.from_id}::uuid),
      ${catalog.from_id}::uuid,'active',now()+interval '14 days','abacatepay') RETURNING id::text`;
  assert.ok(subscription);
  await cluster.sql`INSERT INTO billing_gateway.accounts(id,provider,environment,external_account_id)
    VALUES(${accountId}::uuid,'abacatepay','sandbox','store_synthetic_pix')`;
  await cluster.sql`INSERT INTO billing_gateway.bindings(subscription_id,clinic_id,account_id)
    VALUES(${subscription.id}::uuid,${clinicId}::uuid,${accountId}::uuid)`;
  const insertIntent = () => cluster.sql<
    { id: string }[]
  >`INSERT INTO billing_gateway.pix_replacement_intents
    (account_id,subscription_id,clinic_id,generation_id,prior_external_subscription_id,
      prior_period_end,from_price_id,to_price_id,to_plan_id,target_amount_minor,requested_by)
    VALUES(${accountId}::uuid,${subscription.id}::uuid,${clinicId}::uuid,${generationId}::uuid,
      'subs_synthetic_pix',now()+interval '30 days',${catalog.from_id}::uuid,${catalog.to_id}::uuid,
      ${catalog.to_plan_id}::uuid,39700,${ownerId}::uuid) RETURNING id::text`;
  const concurrent = await Promise.allSettled([insertIntent(), insertIntent()]);
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = concurrent.find((result) => result.status === 'rejected');
  assert.ok(rejected && rejected.status === 'rejected');
  assert.ok(rejected.reason instanceof Error && 'code' in rejected.reason);
  assert.equal(rejected.reason.code, '23505');
  const inserted = concurrent.find((result) => result.status === 'fulfilled');
  assert.ok(inserted && inserted.status === 'fulfilled');
  const intentId = inserted.value[0]?.id;
  assert.ok(intentId);
  await assert.rejects(
    cluster.sql`UPDATE billing_gateway.pix_replacement_intents SET target_amount_minor=1
      WHERE id=${intentId}::uuid`,
    (error: unknown) => error instanceof Error && 'code' in error && error.code === '23514',
  );
  await cluster.sql`UPDATE billing_gateway.pix_replacement_intents
    SET state='cancelled',state_changed_at=now() WHERE id=${intentId}::uuid`;
  await assert.rejects(
    cluster.sql`UPDATE billing_gateway.pix_replacement_intents SET state='requested',state_changed_at=NULL
      WHERE id=${intentId}::uuid`,
    (error: unknown) => error instanceof Error && 'code' in error && error.code === '23514',
  );
  const reopened = await insertIntent();
  assert.equal(reopened.length, 1);

  // Exercise the real domain functions against the migrated schema. The
  // payment evidence below is deliberately synthetic and never sent to a
  // provider; this is not a claim of an external Sandbox payment.
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: cluster.url,
    DATABASE_URL_DEV: cluster.url,
    DATABASE_URL_RUNTIME: cluster.url,
    SUPABASE_PROJECT_ENV: 'dev',
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_pix',
    SAAS_SIGNUP_PROVIDER: 'abacatepay_sandbox',
    ABACATEPAY_STORE_ID: 'store_synthetic_pix',
    ABACATEPAY_API_KEY: 'synthetic-loopback-fixture-only',
    ABACATEPAY_SANDBOX_PROBE_PRODUCT_ID: 'prod_probe',
    ABACATEPAY_SANDBOX_PLAN_PRODUCTS: '{"consultorio_2026":"prod_synthetic"}',
    APP_BASE_URL: 'https://qoro.example',
    LOGIN_HASH_PEPPER: 'synthetic-pix-local-hash-pepper-only',
    CRYPTO_SECRET_BACKEND: 'env',
    CRYPTO_MASTER_KEY_V1: Buffer.alloc(32, 7).toString('base64'),
    CRYPTO_LOOKUP_SALT: Buffer.alloc(32, 9).toString('base64'),
    LOG_LEVEL: 'error',
  });
  delete process.env.VERCEL_ENV;
  delete process.env.DATABASE_URL_PROD;
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error('Network forbidden in synthetic Pix proof');
  };
  try {
    const { dbAdmin } = await import('../../src/lib/db');
    const { applyInitialAbacatePayPaymentTx } =
      await import('../../src/contexts/billing/internal/abacatepay-processing');
    const {
      requestPixReplacementIntent,
      cancelPixReplacementIntent,
      getPixReplacementIntentOverview,
      PixReplacementIntentError,
    } = await import('../../src/contexts/billing/internal/abacatepay-pix-replacement-intent');
    type PaymentEvidence =
      import('../../src/lib/payments/abacatepay/initial-payment').InitialPaymentEvidence;
    await cluster.sql`UPDATE public.plans SET ativo=true WHERE code IN ('consultorio_2026','clinica_2026_2')`;
    const paidClinicId = randomUUID();
    const paidOwnerId = randomUUID();
    await cluster.sql`INSERT INTO auth.users(id,email)
      VALUES(${paidOwnerId}::uuid,${`${paidOwnerId}@example.invalid`})`;
    await cluster.sql`INSERT INTO public.clinics(id,slug,nome,status)
      VALUES(${paidClinicId}::uuid,${`pix-domain-${paidClinicId.slice(0, 8)}`},'Synthetic Pix domain clinic','active')`;
    await cluster.sql`INSERT INTO public.profiles(id,clinic_id,nome,role,ativo,invite_accepted_at)
      VALUES(${paidOwnerId}::uuid,${paidClinicId}::uuid,'Synthetic Pix owner','owner',true,now())`;
    const [paidSubscription] = await cluster.sql<{ id: string; price_id: string }[]>`
      INSERT INTO public.subscriptions(clinic_id,plan_id,price_id,billing_status,trial_ends_at,
        billing_provider,enforce_trial_deadline)
      SELECT ${paidClinicId}::uuid,p.id,pr.id,'trial',u.created_at+interval '14 days',
        'abacatepay',true
      FROM auth.users u JOIN public.plans p ON p.code='consultorio_2026'
      JOIN public.prices pr ON pr.plan_id=p.id AND pr.active_until IS NULL
        AND pr.campaign_code IS NULL AND pr.billing_cycle='monthly'
      WHERE u.id=${paidOwnerId}::uuid RETURNING id::text,price_id::text`;
    assert.ok(paidSubscription);
    await cluster.sql`INSERT INTO billing_gateway.trial_claims
      (auth_user_id,email_hash,clinic_id,auth_created_at,trial_ends_at)
      SELECT id,encode(sha256(email::bytea),'hex'),${paidClinicId}::uuid,created_at,
        created_at+interval '14 days'
      FROM auth.users WHERE id=${paidOwnerId}::uuid`;
    const paidCheckoutId = `bill_${randomUUID().replaceAll('-', '')}`;
    await cluster.sql`INSERT INTO billing_gateway.bindings
      (subscription_id,clinic_id,account_id,external_checkout_id)
      VALUES(${paidSubscription.id}::uuid,${paidClinicId}::uuid,${accountId}::uuid,${paidCheckoutId})`;
    await cluster.sql`INSERT INTO billing_gateway.checkout_intents
      (subscription_id,clinic_id,account_id,price_id,product_id,amount_minor)
      VALUES(${paidSubscription.id}::uuid,${paidClinicId}::uuid,${accountId}::uuid,
        ${paidSubscription.price_id}::uuid,'prod_synthetic',19700)`;
    const payment: PaymentEvidence = {
      account: { provider: 'abacatepay', environment: 'sandbox', accountId: 'store_synthetic_pix' },
      subscriptionId: `subs_${randomUUID().replaceAll('-', '')}`,
      customerId: `cust_${randomUUID().replaceAll('-', '')}`,
      checkoutId: paidCheckoutId,
      amountMinor: 19700,
      paidAmountMinor: 19700,
      currency: 'BRL',
      state: 'paid',
      method: 'pix',
      rawStatus: 'PAID',
      settlement: 'unknown',
      subscriptionCreatedAt: new Date().toISOString(),
      recurrence: 'running',
    };
    assert.equal(
      await dbAdmin.transaction((tx) => applyInitialAbacatePayPaymentTx(tx, payment)),
      'applied',
    );
    assert.equal(
      await dbAdmin.transaction((tx) => applyInitialAbacatePayPaymentTx(tx, payment)),
      'duplicate',
    );
    type FinancialSnapshot = {
      plan_id: string;
      price_id: string;
      invoices: number;
      checkout_operations: number;
      paid_checkouts: number;
      released: boolean;
      period_start: string;
      period_end: string;
      external_subscription_id: string;
      cancel_at_period_end: boolean;
    };
    const [beforeIntent] = await cluster.sql<
      FinancialSnapshot[]
    >`SELECT s.plan_id::text,s.price_id::text,
      (SELECT count(*)::int FROM public.invoices WHERE subscription_id=s.id) invoices,
      (SELECT count(*)::int FROM billing_gateway.operations WHERE subscription_id=s.id AND kind='create_checkout') checkout_operations,
      (SELECT count(*)::int FROM billing_gateway.paid_checkouts WHERE subscription_id=s.id) paid_checkouts,
      t.released_at IS NOT NULL released,s.current_period_start::text period_start,
      s.current_period_end::text period_end,b.external_subscription_id,s.cancel_at_period_end
      FROM public.subscriptions s JOIN public.trial_access_policies t ON t.subscription_id=s.id
      JOIN billing_gateway.bindings b ON b.subscription_id=s.id
      WHERE s.id=${paidSubscription.id}::uuid`;
    assert.ok(beforeIntent?.released);
    const input = {
      clinicId: paidClinicId,
      requestedBy: paidOwnerId,
      contractId: paidSubscription.id,
      targetPlanId: catalog.to_plan_id,
    };
    const requested = await requestPixReplacementIntent(dbAdmin, input);
    assert.equal(requested.state, 'requested');
    assert.deepEqual(await requestPixReplacementIntent(dbAdmin, input), requested);
    const pending = await getPixReplacementIntentOverview(dbAdmin, paidClinicId);
    assert.equal(pending?.pending?.id, requested.intentId);
    assert.equal(pending?.pending?.amountMinor, 39700);
    await assert.rejects(
      requestPixReplacementIntent(dbAdmin, { ...input, requestedBy: ownerId }),
      (error: unknown) =>
        error instanceof PixReplacementIntentError && error.code === 'not_eligible',
    );
    await assert.rejects(
      cancelPixReplacementIntent(dbAdmin, {
        clinicId: paidClinicId,
        requestedBy: ownerId,
        contractId: paidSubscription.id,
        intentId: requested.intentId,
      }),
      (error: unknown) =>
        error instanceof PixReplacementIntentError && error.code === 'not_eligible',
    );
    const cancellation = {
      clinicId: paidClinicId,
      requestedBy: paidOwnerId,
      contractId: paidSubscription.id,
      intentId: requested.intentId,
    };
    assert.deepEqual(await cancelPixReplacementIntent(dbAdmin, cancellation), {
      state: 'cancelled',
    });
    assert.deepEqual(await cancelPixReplacementIntent(dbAdmin, cancellation), {
      state: 'cancelled',
    });
    assert.deepEqual(await getPixReplacementIntentOverview(dbAdmin, paidClinicId), {
      available: true,
      pending: null,
    });
    const [afterIntent] = await cluster.sql<FinancialSnapshot[]>`
      SELECT s.plan_id::text,s.price_id::text,
      (SELECT count(*)::int FROM public.invoices WHERE subscription_id=s.id) invoices,
      (SELECT count(*)::int FROM billing_gateway.operations WHERE subscription_id=s.id AND kind='create_checkout') checkout_operations,
      (SELECT count(*)::int FROM billing_gateway.paid_checkouts WHERE subscription_id=s.id) paid_checkouts,
      t.released_at IS NOT NULL released,s.current_period_start::text period_start,
      s.current_period_end::text period_end,b.external_subscription_id,s.cancel_at_period_end
      FROM public.subscriptions s JOIN public.trial_access_policies t ON t.subscription_id=s.id
      JOIN billing_gateway.bindings b ON b.subscription_id=s.id
      WHERE s.id=${paidSubscription.id}::uuid`;
    assert.deepEqual(afterIntent, beforeIntent);
    const audit = await cluster.sql<{ type: string; n: number }[]>`
      SELECT type,count(*)::int n FROM public.billing_events
      WHERE clinic_id=${paidClinicId}::uuid AND type IN
        ('subscription.pix_replacement.requested','subscription.pix_replacement.cancelled')
      GROUP BY type ORDER BY type`;
    assert.deepEqual(
      [...audit],
      [
        { type: 'subscription.pix_replacement.cancelled', n: 1 },
        { type: 'subscription.pix_replacement.requested', n: 1 },
      ],
    );
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
  await migrate(database, { migrationsFolder: folder });
  const [repeated] = await cluster.sql`SELECT count(*)::int n FROM drizzle.__drizzle_migrations`;
  assert.equal(repeated?.n, 169);
  process.stdout.write(
    JSON.stringify({
      status: 'PASS',
      postgres: 'real_disposable_loopback',
      migrations: 169,
      upgradeFromProductionBaseline: 160,
      pixMigration: journal.entries[168]!.tag,
      migrationMs,
      rlsForced: true,
      foreignKeys: 4,
      trigger: true,
      uniqueOpenIntentIndex: true,
      concurrentOpenRequests: 'one_insert_one_unique_violation',
      immutableSnapshot: true,
      terminalRequestCannotReopen: true,
      newRequestAfterCancellation: true,
      repeatNoOp: true,
      pixDomainTransaction: true,
      pixRequestIdempotent: true,
      pixCancellationIdempotent: true,
      pixAuditOncePerTransition: true,
      crossTenantActorDenied: true,
      noFinancialMutationFromIntent: true,
      externalPayment: 'NOT RUN - synthetic evidence only',
      productionWrites: 0,
      devWrites: 0,
    }) + '\n',
  );
} finally {
  await cluster.stop();
  await rm(prefixFolder, { recursive: true, force: true });
}
