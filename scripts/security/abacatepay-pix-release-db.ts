/** Rehearse the composed commercial journal on a disposable loopback PostgreSQL. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
    entries: z.array(z.object({ idx: z.number().int(), tag: z.string(), when: z.number().int() })),
  })
  .parse(JSON.parse(await readFile(path.join(folder, 'meta/_journal.json'), 'utf8')));
assert.equal(journal.entries.length, 169);
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
  await migrate(database, { migrationsFolder: folder });
  const [repeated] = await cluster.sql`SELECT count(*)::int n FROM drizzle.__drizzle_migrations`;
  assert.equal(repeated?.n, 169);
  process.stdout.write(
    JSON.stringify({
      status: 'PASS',
      postgres: 'real_disposable_loopback',
      migrations: 169,
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
      productionWrites: 0,
      devWrites: 0,
    }) + '\n',
  );
} finally {
  await cluster.stop();
}
