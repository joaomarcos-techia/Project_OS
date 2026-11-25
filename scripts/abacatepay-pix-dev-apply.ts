/** Guarded DEV-only Drizzle migration. Run without --apply for a read-only preflight. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { parse } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
// This isolated migrator must hold a session advisory lock on its own guarded DEV connection.
// eslint-disable-next-line no-restricted-imports
import postgres from 'postgres';
import { z } from 'zod';

const { values } = parseArgs({
  options: { apply: { type: 'boolean', default: false }, folder: { type: 'string' } },
  strict: true,
});
const folder = path.resolve(z.string().min(1).parse(values.folder));
assert.ok(
  folder.startsWith(path.resolve('dist') + path.sep),
  'Only a composed artifact is allowed',
);
if (process.env.SUPABASE_PROJECT_ENV === 'prod') throw new Error('Production environment refused');
const settings = parse(
  await readFile(process.env.QORO_LOCAL_ENV_FILE ?? 'C:/dev/ClinicaOS_V2/.env.local'),
);
const target = new URL(z.string().min(1).parse(settings.DATABASE_URL_DEV));
const devRef = 'pqhkirrszzpwezdaqrai';
assert.equal(decodeURIComponent(target.username), `postgres.${devRef}`);
assert.match(target.hostname, /^[a-z0-9-]+\.pooler\.supabase\.com$/);
if (target.port === '6543') target.port = '5432';
assert.equal(target.port, '5432');
const manifest = z
  .object({
    appHead: z.string().regex(/^[a-f0-9]{40}$/),
    sharedTailSql: z.string().regex(/^[a-f0-9]{40}$/),
    journalEntries: z.literal(169),
    pixHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .parse(JSON.parse(await readFile(path.join(folder, 'composition.json'), 'utf8')));
const source = z
  .object({
    sharedTailCommit: z.string(),
    pix: z.object({ tag: z.literal('0168_saas_pix_replacement_intents'), sha256: z.string() }),
  })
  .parse(
    JSON.parse(
      await readFile(
        'docs/decoupling/asaas-to-abacatepay/migrations/pix-release-manifest.json',
        'utf8',
      ),
    ),
  );
assert.equal(manifest.sharedTailSql, source.sharedTailCommit);
assert.equal(manifest.pixHash, source.pix.sha256);
const pr55 = execFileSync(
  'gh',
  ['pr', 'view', '55', '--json', 'headRefOid', '--jq', '.headRefOid'],
  {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  },
).trim();
assert.equal(pr55, manifest.sharedTailSql, 'Shared TISS branch advanced; stop for review');
const journal = z
  .object({
    entries: z.array(z.object({ idx: z.number().int(), tag: z.string(), when: z.number().int() })),
  })
  .parse(JSON.parse(await readFile(path.join(folder, 'meta/_journal.json'), 'utf8')));
assert.equal(journal.entries.length, 169);
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const historic = z
  .object({
    scalabilityFollowup: z.object({
      sharedDevFinal: z.object({
        historicalDifferenceDetails: z.array(
          z.object({ tag: z.string(), when: z.string(), appliedHash: z.string() }),
        ),
      }),
    }),
  })
  .parse(
    JSON.parse(
      await readFile(
        'docs/decoupling/asaas-to-abacatepay/evidencias/recuperacao-financeira-20261111.json',
        'utf8',
      ),
    ),
  ).scalabilityFollowup.sharedDevFinal.historicalDifferenceDetails;
const expected = await Promise.all(
  journal.entries.map(async (entry, idx) => {
    assert.equal(entry.idx, idx);
    if (idx > 0) assert.ok(entry.when > journal.entries[idx - 1]!.when);
    const body = await readFile(path.join(folder, `${entry.tag}.sql`));
    const normalized = body.toString().replaceAll('\r\n', '\n');
    const previous = historic.find(
      (item) => item.tag === entry.tag && item.when === String(entry.when),
    );
    return {
      when: String(entry.when),
      hashes: new Set(
        [
          hash(body),
          hash(normalized),
          hash(normalized.replaceAll('\n', '\r\n')),
          previous?.appliedHash,
        ].filter((value): value is string => Boolean(value)),
      ),
    };
  }),
);
assert.equal(hash(await readFile(path.join(folder, `${source.pix.tag}.sql`))), manifest.pixHash);
const sql = postgres(target.toString(), {
  max: 1,
  prepare: false,
  ssl: 'require',
  connect_timeout: 15,
  onnotice: () => undefined,
});
let stage = 'read_only_preflight';
let locked = false;
try {
  await sql`SELECT set_config('lock_timeout','2s',false),set_config('statement_timeout','15s',false)`;
  const history = async () =>
    sql<{ id: number; hash: string; created_at: string }[]>`SELECT id,hash,created_at::text
      FROM drizzle.__drizzle_migrations ORDER BY id`;
  const assertHistory = (rows: Awaited<ReturnType<typeof history>>, count: 168 | 169) => {
    assert.equal(rows.length, count, 'Unexpected journal length');
    for (const [idx, row] of rows.entries()) {
      assert.equal(row.created_at, expected[idx]!.when, `Migration time differs at ${idx}`);
      assert.ok(expected[idx]!.hashes.has(row.hash), `Migration hash differs at ${idx}`);
      if (idx > 0) assert.ok(row.id > rows[idx - 1]!.id);
    }
  };
  const before = await sql.begin(async (tx) => {
    await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    await tx`SET LOCAL statement_timeout='15s'`;
    const [mode] = await tx`SELECT current_setting('transaction_read_only') read_only`;
    assert.equal(mode?.read_only, 'on');
    const rows =
      await tx`SELECT id,hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY id`;
    assertHistory(Array.from(rows) as Awaited<ReturnType<typeof history>>, 168);
    const [schema] =
      await tx`SELECT to_regclass('billing_gateway.pix_replacement_intents') IS NOT NULL exists`;
    assert.equal(schema?.exists, false, 'Pix table exists without journal entry');
    const [counts] = await tx`SELECT
      (SELECT count(*)::int FROM public.subscriptions) subscriptions,
      (SELECT count(*)::int FROM public.invoices) invoices,
      (SELECT count(*)::int FROM public.profiles) profiles`;
    return counts;
  });
  if (!values.apply) {
    process.stdout.write(
      JSON.stringify({
        status: 'PASS',
        phase: 'DEV_READ_ONLY_PREFLIGHT',
        journalEntries: 168,
        pixPresent: false,
        databaseWrites: 0,
      }) + '\n',
    );
  } else {
    stage = 'exclusive_apply_preflight';
    const [lock] = await sql`SELECT pg_try_advisory_lock(718413,168) acquired`;
    assert.equal(lock?.acquired, true, 'Another commercial migrator is active');
    locked = true;
    const [activity] = await sql`SELECT
      count(*) FILTER(WHERE xact_start<now()-interval '30 seconds')::int long_transactions,
      count(*) FILTER(WHERE state='active' AND query~*'^\\s*(alter|create|drop|truncate|reindex|vacuum|grant|revoke)\\M')::int active_ddl
      FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'`;
    const [waiting] = await sql`SELECT count(*)::int n FROM pg_locks WHERE NOT granted`;
    assert.equal(activity?.long_transactions, 0);
    assert.equal(activity?.active_ddl, 0);
    assert.equal(waiting?.n, 0);
    assertHistory(await history(), 168);
    stage = 'drizzle_apply';
    await migrate(drizzle(sql), { migrationsFolder: folder });
    stage = 'postflight';
    assertHistory(await history(), 169);
    const [security] = await sql`SELECT c.relrowsecurity AND c.relforcerowsecurity secured,
      has_table_privilege('authenticated',c.oid,'SELECT') authenticated_read,
      has_table_privilege('service_role',c.oid,'DELETE') service_delete,
      (SELECT count(*)::int FROM billing_gateway.pix_replacement_intents) rows
      FROM pg_class c WHERE c.oid='billing_gateway.pix_replacement_intents'::regclass`;
    assert.deepEqual(security, {
      secured: true,
      authenticated_read: false,
      service_delete: false,
      rows: 0,
    });
    const [after] = await sql`SELECT
      (SELECT count(*)::int FROM public.subscriptions) subscriptions,
      (SELECT count(*)::int FROM public.invoices) invoices,
      (SELECT count(*)::int FROM public.profiles) profiles`;
    assert.deepEqual(after, before, 'Existing DEV data changed during additive migration');
    await migrate(drizzle(sql), { migrationsFolder: folder });
    assertHistory(await history(), 169);
    process.stdout.write(
      JSON.stringify({
        status: 'PASS',
        phase: 'DEV_APPLIED',
        journalEntries: 169,
        pixRows: 0,
        rlsForced: true,
        repeatedNoOp: true,
        existingCountsPreserved: true,
        productionWrites: 0,
      }) + '\n',
    );
  }
} catch {
  process.stderr.write(JSON.stringify({ status: 'FAIL', stage, details: 'suppressed' }) + '\n');
  process.exitCode = 1;
} finally {
  if (locked) await sql`SELECT pg_advisory_unlock(718413,168)`;
  await sql.end({ timeout: 5 });
}
