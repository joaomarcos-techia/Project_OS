/** Actual application transactions, real migrations, synthetic gateway, loopback only. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';

import type { PaymentProvider, ProviderPayment } from '../../src/lib/payments/asaas';
import { readMigrations, startScratchSchema } from './scratch-schema';

assert.equal(process.platform, 'linux', 'Run on an isolated runner, never on the notebook');
const variant = z.enum(['main-136', 'main-160', 'candidate-160']).parse(process.argv[2]);
const expected = variant === 'main-136' ? 136 : 160;
const migrations = await readMigrations();
assert.equal(migrations.length, expected);
const journal = z
  .object({ entries: z.array(z.object({ tag: z.string(), when: z.number() })) })
  .parse(JSON.parse(await readFile('drizzle/migrations/meta/_journal.json', 'utf8')));
assert.equal(journal.entries.length, expected);
const cluster = await startScratchSchema({ port: 55471 });
const sql = cluster.sql;
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: cluster.url,
  DATABASE_URL_DEV: cluster.url,
  DATABASE_URL_RUNTIME: cluster.url,
  SUPABASE_PROJECT_ENV: 'dev',
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_cancel',
  CRYPTO_SECRET_BACKEND: 'env',
  CRYPTO_MASTER_KEY_V1: Buffer.alloc(32, 7).toString('base64'),
  CRYPTO_LOOKUP_SALT: Buffer.alloc(32, 9).toString('base64'),
  LOG_LEVEL: 'error',
  ABACATEPAY_STORE_ID: 'store_synthetic',
  ABACATEPAY_ENVIRONMENT: 'production',
  VERCEL_ENV: 'preview',
});
delete process.env.DATABASE_URL_PROD;
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls++;
  throw new Error('External network forbidden');
};
const results: { name: string; status: 'PASS' | 'FAIL' }[] = [];
let failure: unknown;
try {
  // Match the Supabase managed SELECT baseline, not a new application grant.
  await sql`GRANT SELECT ON public.clinics, public.subscriptions, public.profiles TO authenticated`;
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations
    (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint NOT NULL)`;
  for (const [index, migration] of migrations.entries()) {
    const entry = journal.entries[index];
    assert.equal(migration.file, entry?.tag + '.sql');
    await sql`INSERT INTO drizzle.__drizzle_migrations(hash,created_at)
      VALUES(${createHash('sha256').update(migration.body.replaceAll('\r\n', '\n')).digest('hex')},${entry!.when})`;
  }
  const { withTenant } = await import('../../src/lib/db/tenant');
  const { getSubscriptionCancellationContext, requestSubscriptionCancellation } =
    await import('../../src/contexts/billing/internal/plan-changes');
  const { removeSubscriptionCharges } =
    await import('../../src/contexts/billing/internal/cancellation-charges');
  const end = new Date('2027-01-15T00:00:00Z');
  const now = new Date('2026-11-16T12:00:00Z');
  async function check(name: string, run: () => Promise<void>) {
    try {
      await run();
      results.push({ name, status: 'PASS' });
    } catch (error) {
      results.push({ name, status: 'FAIL' });
      throw error;
    }
  }
  async function seed(trial = false) {
    const clinicId = randomUUID(),
      userId = randomUUID(),
      subscriptionId = randomUUID();
    await sql`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${userId}::uuid,${userId + '@example.invalid'},now())`;
    await sql`INSERT INTO public.clinics(id,slug,nome,status) VALUES(${clinicId}::uuid,${'cancel-' + clinicId.slice(0, 16)},'Synthetic cancellation','active')`;
    await sql`INSERT INTO public.profiles(id,clinic_id,nome,role,ativo) VALUES(${userId}::uuid,${clinicId}::uuid,'Synthetic owner','owner',true)`;
    const [price] = await sql<
      { id: string; plan_id: string }[]
    >`SELECT pr.id,pr.plan_id FROM public.prices pr
      JOIN public.plans p ON p.id=pr.plan_id WHERE p.code='clinica_2026_2'
      AND pr.billing_cycle='monthly' AND pr.active_until IS NULL AND pr.campaign_code IS NULL LIMIT 1`;
    assert.ok(price);
    const providerId = trial ? null : 'sub_synthetic_' + subscriptionId;
    await sql`INSERT INTO public.subscriptions(id,clinic_id,plan_id,price_id,billing_status,
      asaas_subscription_id,current_period_start,current_period_end,trial_ends_at)
      VALUES(${subscriptionId}::uuid,${clinicId}::uuid,${price.plan_id}::uuid,${price.id}::uuid,
      ${trial ? 'trial' : 'active'},${providerId},${now},${trial ? null : end},${trial ? end : null})`;
    const paidId = 'pay_paid_' + subscriptionId,
      openId = 'pay_open_' + subscriptionId;
    if (!trial) {
      await sql`INSERT INTO public.invoices(clinic_id,subscription_id,total_amount,status,due_date,paid_at,asaas_payment_id)
        VALUES(${clinicId}::uuid,${subscriptionId}::uuid,397,'paid','2026-11-15',now(),${paidId}),
        (${clinicId}::uuid,${subscriptionId}::uuid,397,'open','2027-01-15',NULL,${openId})`;
    }
    return { clinicId, userId, subscriptionId, providerId, paidId, openId };
  }
  function gateway(identity: Awaited<ReturnType<typeof seed>>) {
    const calls: string[] = [];
    let paused = false,
      removed = false,
      failPause = false,
      loseDeleteAck = false;
    const payment = (id: string): ProviderPayment => ({
      paymentId: id,
      status: id === identity.paidId ? 'CONFIRMED' : 'PENDING',
      value: 397,
      dueDate: '2027-01-15',
      invoiceUrl: null,
      subscriptionId: identity.providerId,
      billingType: 'CREDIT_CARD',
      externalReference: null,
      checkoutSessionId: null,
      deleted: id === identity.openId && removed,
    });
    const provider: Pick<
      PaymentProvider,
      'updateSubscription' | 'listUnpaidSubscriptionPayments' | 'getPayment' | 'cancelPayment'
    > = {
      async updateSubscription(id, input) {
        assert.equal(id, identity.providerId);
        assert.equal(input.status, 'INACTIVE');
        calls.push('pause');
        if (failPause) throw new Error('Synthetic timeout before acknowledgement');
        paused = true;
      },
      async listUnpaidSubscriptionPayments(id) {
        assert.equal(id, identity.providerId);
        return removed ? [] : [payment(identity.openId)];
      },
      async getPayment(id) {
        assert.ok(id === identity.openId || id === identity.paidId);
        return payment(id);
      },
      async cancelPayment(id) {
        assert.equal(id, identity.openId);
        assert.equal(paused, true);
        calls.push('delete');
        removed = true;
        if (loseDeleteAck) {
          loseDeleteAck = false;
          throw new Error('Synthetic lost response after removal');
        }
        return { deleted: true };
      },
    };
    return {
      provider,
      calls,
      setPauseFailure(value: boolean) {
        failPause = value;
      },
      loseDeleteResponse() {
        loseDeleteAck = true;
      },
    };
  }
  const a = await seed(),
    untouched = await seed();
  const untouchedBefore =
    await sql`SELECT to_jsonb(s) state FROM public.subscriptions s WHERE id=${untouched.subscriptionId}::uuid`;
  const remote = gateway(a);
  const context = await getSubscriptionCancellationContext(a.clinicId, now);
  await check('server selects the original Asaas obligation', async () => {
    assert.equal(context.asaasSubscriptionId, a.providerId);
    assert.deepEqual(context.extraPaymentIds, [a.openId]);
    assert.equal(context.effectiveAt.toISOString(), end.toISOString());
  });
  await check('network failure does not falsely persist cancellation', async () => {
    remote.setPauseFailure(true);
    assert.equal((await removeSubscriptionCharges(remote.provider, context)).ok, false);
    const [row] =
      await sql`SELECT cancel_at_period_end FROM public.subscriptions WHERE id=${a.subscriptionId}::uuid`;
    assert.equal(row?.cancel_at_period_end, false);
    remote.setPauseFailure(false);
  });
  await check('lost deletion acknowledgement is verified by authoritative reread', async () => {
    remote.loseDeleteResponse();
    const result = await removeSubscriptionCharges(remote.provider, context);
    assert.equal(result.ok, true);
    assert.deepEqual(result.removedPaymentIds, [a.openId]);
  });
  const input = {
    clinicId: a.clinicId,
    requestedBy: a.userId,
    idempotencyKey: randomUUID(),
    request: { ip: null, origin: null, requestId: 'synthetic-cancellation' },
    now,
    removedPaymentIds: [a.openId],
    paidPaymentIds: [],
  };
  await check(
    'database failure rolls back local intent; retry remains safe after provider pause',
    async () => {
      await assert.rejects(
        withTenant(a.clinicId, async (tx) => {
          await requestSubscriptionCancellation(tx, input);
          throw new Error('Synthetic SQL transaction failure');
        }),
      );
      const [row] =
        await sql`SELECT cancel_at_period_end FROM public.subscriptions WHERE id=${a.subscriptionId}::uuid`;
      assert.equal(row?.cancel_at_period_end, false);
      assert.equal((await removeSubscriptionCharges(remote.provider, context)).ok, true);
      await withTenant(a.clinicId, (tx) => requestSubscriptionCancellation(tx, input));
    },
  );
  await check('paid period, paid invoice, profile and history remain intact', async () => {
    const [row] = await sql`SELECT s.billing_status,s.cancel_at_period_end,s.current_period_end,
      (SELECT ativo FROM public.profiles WHERE id=${a.userId}::uuid) ativo,
      (SELECT status FROM public.invoices WHERE asaas_payment_id=${a.paidId}) paid_status,
      (SELECT status FROM public.invoices WHERE asaas_payment_id=${a.openId}) open_status,
      (SELECT count(*)::int FROM public.billing_events WHERE clinic_id=${a.clinicId}::uuid
        AND type='subscription.cancellation.requested') audit
      FROM public.subscriptions s WHERE s.id=${a.subscriptionId}::uuid`;
    assert.equal(row?.billing_status, 'active');
    assert.equal(row?.cancel_at_period_end, true);
    assert.equal(row?.current_period_end.toISOString(), end.toISOString());
    assert.equal(row?.ativo, true);
    assert.equal(row?.paid_status, 'paid');
    assert.equal(row?.open_status, 'cancelled');
    assert.equal(row?.audit, 1);
  });
  await check('second cancellation cannot duplicate intent or invoice', async () => {
    await assert.rejects(getSubscriptionCancellationContext(a.clinicId, now), {
      code: 'cancellation_already_scheduled',
    });
    await assert.rejects(
      withTenant(a.clinicId, (tx) => requestSubscriptionCancellation(tx, input)),
      { code: 'cancellation_already_scheduled' },
    );
    const [row] =
      await sql`SELECT count(*)::int count FROM public.invoices WHERE clinic_id=${a.clinicId}::uuid`;
    assert.equal(row?.count, 2);
  });
  await check(
    'actual RLS rejects cancelling a different clinic through another tenant',
    async () => {
      await assert.rejects(
        withTenant(untouched.clinicId, (tx) =>
          requestSubscriptionCancellation(tx, { ...input, idempotencyKey: randomUUID() }),
        ),
        { code: 'subscription_not_found' },
      );
      assert.deepEqual(
        await sql`SELECT to_jsonb(s) state FROM public.subscriptions s WHERE id=${untouched.subscriptionId}::uuid`,
        untouchedBefore,
      );
    },
  );
  await check(
    'a trial without recurring obligation calls neither payment nor recurrence endpoint',
    async () => {
      const trial = await seed(true),
        fake = gateway(trial);
      const pending = await getSubscriptionCancellationContext(trial.clinicId, now);
      assert.equal(pending.asaasSubscriptionId, null);
      const result = await removeSubscriptionCharges(fake.provider, pending);
      assert.equal(result.ok, true);
      assert.deepEqual(fake.calls, []);
      await withTenant(trial.clinicId, (tx) =>
        requestSubscriptionCancellation(tx, {
          ...input,
          clinicId: trial.clinicId,
          requestedBy: trial.userId,
          idempotencyKey: randomUUID(),
          removedPaymentIds: [],
        }),
      );
    },
  );
  if (expected === 160) {
    await check(
      'migrated contracts retain Asaas origin; no new binding or second subscription',
      async () => {
        const [row] =
          await sql`SELECT billing_provider,(SELECT count(*)::int FROM billing_gateway.bindings) bindings
        FROM public.subscriptions WHERE id=${a.subscriptionId}::uuid`;
        assert.equal(row?.billing_provider, 'asaas');
        assert.equal(row?.bindings, 0);
        await assert.rejects(
          sql`UPDATE public.subscriptions SET billing_provider='unknown' WHERE id=${a.subscriptionId}::uuid`,
        );
      },
    );
  }
  if (variant === 'candidate-160') {
    await check(
      'legacy subscription screen survives disarmed AbacatePay with real SQL',
      async () => {
        const { getDeferredSubscriptionOverview } =
          await import('../../src/contexts/billing/internal/deferred-checkout');
        assert.equal(await getDeferredSubscriptionOverview(a.clinicId), null);
      },
    );
  }
  assert.equal(networkCalls, 0);
} catch (error) {
  failure = error;
} finally {
  globalThis.fetch = originalFetch;
  await cluster.stop();
  await mkdir('dist', { recursive: true });
  await writeFile(
    `dist/cancellation-${variant}.json`,
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        variant,
        status: failure ? 'FAIL' : 'PASS',
        migrations: expected,
        journalEntries: journal.entries.length,
        results,
        networkCalls,
        provider: 'contractual synthetic; no real provider cancellation',
        cleanupComplete: true,
        productionWrites: 0,
      },
      null,
      2,
    ) + '\n',
  );
}
if (failure) throw failure;
console.info(JSON.stringify({ variant, status: 'PASS', checks: results.length, networkCalls }));
