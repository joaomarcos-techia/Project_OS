/** Synthetic Production-shaped 136 -> 160 rehearsal. No remote connection or real data. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { parseArgs } from 'node:util';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { z } from 'zod';
import { startScratchSchema } from './security/scratch-schema';
import {
  assertReleaseHistory,
  checkReleaseDatabase,
  readFrozenRelease,
} from './abacatepay-release-validation';

const { values } = parseArgs({ options: { release: { type: 'string' }, ref: { type: 'string' } } });
const root = process.cwd();
const approvedFolder = path.join(
  path.resolve(z.string().min(1).parse(values.release)),
  'drizzle/migrations',
);
const financial = z.string().min(1).parse(values.ref);
const rehearsalDirectory = await mkdtemp(path.join(root, 'dist/abacatepay-release-rehearsal-'));
const folder = path.join(rehearsalDirectory, 'release/drizzle/migrations');
await mkdir(path.dirname(folder), { recursive: true });
await cp(approvedFolder, folder, { recursive: true });
const plan = await readFrozenRelease(folder, financial);
const baseline = await mkdtemp(path.join(root, 'dist/abacatepay-release-before-'));
assert.ok(baseline.startsWith(path.join(root, 'dist') + path.sep));
await mkdir(path.join(baseline, 'drizzle/migrations'), { recursive: true });
for (const entry of plan.migrations.slice(0, 136))
  await copyFile(
    path.join(folder, entry.tag + '.sql'),
    path.join(baseline, 'drizzle/migrations', entry.tag + '.sql'),
  );
const port = await new Promise<number>((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      reject(new Error('No loopback port'));
      return;
    }
    server.close((error) => (error ? reject(error) : resolve(address.port)));
  });
});
let cluster;
process.chdir(baseline);
try {
  cluster = await startScratchSchema({ port });
} finally {
  process.chdir(root);
}
assert.equal(new URL(cluster.url).hostname, '127.0.0.1');
const sql = cluster.sql;
let database: (typeof import('../src/lib/db'))['dbAdmin'] | undefined;
const results: string[] = [];
const check = async (name: string, run: () => Promise<void>) => {
  await run();
  results.push(name);
};
const history = async () =>
  Array.from(
    await sql`SELECT id,hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY id`,
  );
const fingerprint = async () => {
  const [snapshot] = await sql`SELECT
    (SELECT md5(string_agg((to_jsonb(s)-'billing_provider')::text,'' ORDER BY s.id)) FROM public.subscriptions s) contracts,
    (SELECT md5(string_agg(to_jsonb(p)::text,'' ORDER BY p.id)) FROM public.prices p) prices,
    (SELECT md5(string_agg(to_jsonb(l)::text,'' ORDER BY l.id)) FROM public.plans l) plans`;
  return snapshot;
};
try {
  // Reuse the central connection origin with only this newly created cluster.
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: cluster.url,
    DATABASE_URL_DEV: cluster.url,
    DATABASE_URL_RUNTIME: cluster.url,
    SUPABASE_PROJECT_ENV: 'dev',
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_release_rehearsal',
  });
  delete process.env.VERCEL_ENV;
  delete process.env.DATABASE_URL_PROD;
  const { dbAdmin: db } = await import('../src/lib/db');
  database = db;
  await sql`CREATE SCHEMA drizzle`;
  await sql`CREATE TABLE drizzle.__drizzle_migrations(id serial PRIMARY KEY,hash text NOT NULL,created_at bigint NOT NULL)`;
  for (const entry of plan.migrations.slice(0, 136))
    await sql`INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES(${entry.hash},${entry.when})`;
  for (const fixture of [
    { code: 'solo', campaign: null, cycle: 'monthly' },
    { code: 'clinica', campaign: null, cycle: 'monthly' },
    { code: 'pro', campaign: null, cycle: 'monthly' },
    { code: 'clinica', campaign: 'fundador', cycle: 'monthly' },
    { code: 'pro', campaign: null, cycle: 'annual' },
  ]) {
    const [catalog] =
      await sql`SELECT p.id plan_id,pr.id price_id FROM public.plans p JOIN public.prices pr ON pr.plan_id=p.id WHERE p.code=${fixture.code} AND pr.billing_cycle=${fixture.cycle} AND pr.campaign_code IS NOT DISTINCT FROM ${fixture.campaign} AND pr.active_until IS NULL LIMIT 1`;
    assert.ok(catalog, 'Missing approved legacy catalog fixture');
    const clinicId = randomUUID();
    const ownerId = randomUUID();
    await sql`INSERT INTO auth.users(id,email) VALUES(${ownerId},${ownerId + '@example.invalid'})`;
    await sql`INSERT INTO public.clinics(id,slug,nome,status) VALUES(${clinicId},${'rc-' + clinicId.slice(0, 8)},'Synthetic release clinic','active')`;
    await sql`INSERT INTO public.profiles(id,clinic_id,nome,role,ativo) VALUES(${ownerId},${clinicId},'Synthetic owner','owner',true)`;
    await sql`INSERT INTO public.subscriptions(clinic_id,plan_id,price_id,billing_status,trial_ends_at,asaas_subscription_id) VALUES(${clinicId},${catalog.plan_id},${catalog.price_id},'active',now()+interval '14 days',${'sub_synthetic_' + clinicId})`;
  }
  const before = await fingerprint();
  const baselineHistory = await history();
  await check('136 baseline passes exact history and critical schema preflight', async () => {
    const state = await checkReleaseDatabase(sql, plan, 'before');
    assert.equal(state.history.pending.length, 24);
  });
  const missing = path.join(folder, plan.migrations[136]!.tag + '.sql');
  await check('missing SQL is rejected before opening any migration transaction', async () => {
    await rename(missing, missing + '.held');
    try {
      await assert.rejects(readFrozenRelease(folder, financial));
    } finally {
      await rename(missing + '.held', missing);
    }
  });
  await check('changed SQL hash is rejected against approved Git bytes', async () => {
    const body = await readFile(missing);
    try {
      await writeFile(missing, Buffer.concat([body, Buffer.from('\n-- synthetic mutation\n')]));
      await assert.rejects(readFrozenRelease(folder, financial));
    } finally {
      await writeFile(missing, body);
    }
  });
  const unlisted = path.join(folder, '9999_synthetic_unlisted.sql');
  await check('unjournaled SQL cannot be silently ignored', async () => {
    await writeFile(unlisted, '-- synthetic only\n', { flag: 'wx' });
    try {
      await assert.rejects(readFrozenRelease(folder, financial));
    } finally {
      await unlink(unlisted);
    }
  });
  await check('duplicate object is rejected and the real migrator rolls back', async () => {
    await sql`CREATE TABLE public.trial_access_policies(synthetic boolean)`;
    try {
      await assert.rejects(checkReleaseDatabase(sql, plan, 'before'));
      await assert.rejects(migrate(db, { migrationsFolder: folder }));
    } finally {
      await sql`DROP TABLE public.trial_access_policies`;
    }
    assert.deepEqual(await history(), baselineHistory);
    assert.deepEqual(await fingerprint(), before);
  });
  await check('missing base dependency prevents preflight and real migration', async () => {
    await sql`ALTER TABLE public.subscriptions RENAME TO synthetic_missing_subscriptions`;
    try {
      await assert.rejects(checkReleaseDatabase(sql, plan, 'before'));
      await assert.rejects(migrate(db, { migrationsFolder: folder }));
    } finally {
      await sql`ALTER TABLE public.synthetic_missing_subscriptions RENAME TO subscriptions`;
    }
    assert.deepEqual(await history(), baselineHistory);
    assert.deepEqual(await fingerprint(), before);
  });
  const started = performance.now();
  await check(
    'real Drizzle applies exactly 0136-0159 and preserves every legacy contract field',
    async () => {
      await migrate(db, { migrationsFolder: folder });
      assert.deepEqual(await fingerprint(), before);
      assert.deepEqual((await history()).slice(0, 136), baselineHistory);
    },
  );
  const migrationMs = performance.now() - started;
  await check(
    '160 postflight validates history, forced RLS, origin triggers and period constraints',
    async () => {
      const state = await checkReleaseDatabase(sql, plan, 'after');
      assert.equal(state.history.pending.length, 0);
    },
  );
  await check('second migrator run is a no-op', async () => {
    const previous = await history();
    await migrate(db, { migrationsFolder: folder });
    assert.deepEqual(await history(), previous);
    assert.deepEqual(await fingerprint(), before);
  });
  for (const kind of ['missing', 'hash', 'order', 'duplicate'])
    await check('real history rejects ' + kind + ' without repairing it', async () => {
      const rollback = new Error('synthetic rollback only');
      await assert.rejects(
        sql.begin(async (tx) => {
          if (kind === 'missing')
            await tx`DELETE FROM drizzle.__drizzle_migrations WHERE created_at=${plan.migrations[138]!.when}`;
          if (kind === 'hash')
            await tx`UPDATE drizzle.__drizzle_migrations SET hash=${'c'.repeat(64)} WHERE created_at=${plan.migrations[138]!.when}`;
          if (kind === 'order')
            await tx`UPDATE drizzle.__drizzle_migrations SET created_at=CASE WHEN created_at=${plan.migrations[138]!.when} THEN ${plan.migrations[139]!.when}::bigint ELSE ${plan.migrations[138]!.when}::bigint END WHERE created_at IN (${plan.migrations[138]!.when},${plan.migrations[139]!.when})`;
          if (kind === 'duplicate')
            await tx`INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES(${plan.migrations[138]!.hash},${plan.migrations[138]!.when})`;
          const rows = Array.from(
            await tx`SELECT id,hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY id`,
          );
          assert.throws(() => assertReleaseHistory(plan, rows, 'after'));
          throw rollback;
        }),
        (error: unknown) => error === rollback,
      );
    });
  await check('disabled RLS fails postflight', async () => {
    await sql`ALTER TABLE billing_gateway.operations DISABLE ROW LEVEL SECURITY`;
    try {
      await assert.rejects(checkReleaseDatabase(sql, plan, 'after'));
    } finally {
      await sql`ALTER TABLE billing_gateway.operations ENABLE ROW LEVEL SECURITY`;
    }
  });
  await check('disabled origin trigger fails postflight', async () => {
    await sql`ALTER TABLE public.subscriptions DISABLE TRIGGER subscription_check_gateway_origin`;
    try {
      await assert.rejects(checkReleaseDatabase(sql, plan, 'after'));
    } finally {
      await sql`ALTER TABLE public.subscriptions ENABLE TRIGGER subscription_check_gateway_origin`;
    }
  });
  await check('last owner remains protected and TISS stays operationally disabled', async () => {
    const [owner] = await sql`SELECT id FROM public.profiles WHERE role='owner' LIMIT 1`;
    assert.ok(owner);
    await assert.rejects(sql`DELETE FROM public.profiles WHERE id=${owner.id}`);
    const [state] =
      await sql`SELECT (SELECT count(*)::int FROM public.hi_clinic_settings WHERE enabled) enabled,(SELECT count(*)::int FROM public.trial_access_policies) trial_enrollments,(SELECT count(*)::int FROM public.subscriptions WHERE billing_provider<>'asaas') migrated_legacy`;
    assert.deepEqual(state, { enabled: 0, trial_enrollments: 0, migrated_legacy: 0 });
    assert.deepEqual(await fingerprint(), before);
  });
  const final = await checkReleaseDatabase(sql, plan, 'after');
  const report = {
    observedAt: new Date().toISOString(),
    status: 'PASS',
    environment: 'loopback_synthetic',
    financial,
    migrationMs,
    baselineEntries: 136,
    finalEntries: 160,
    pendingApplied: 24,
    results,
    final,
    legacyFixtures: 5,
    realBackupRestored: false,
    approvedExportModified: false,
    baseline:
      'Real migration SQL and history-shaped metadata; synthetic contracts, not a clone of live data',
    providerCalls: 0,
    remoteWrites: 0,
    tissOperationsEnabled: 0,
  };
  await writeFile(
    path.join(root, 'dist/abacatepay-release-rehearsal-db.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report));
} finally {
  try {
    await database?.$client.end({ timeout: 5 });
  } finally {
    await cluster.stop();
  }
}
