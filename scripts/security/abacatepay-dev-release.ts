/** Explicitly authorized DEV composition only. Defaults to read-only preflight. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { z } from 'zod';

const DEV_REF = 'pqhkirrszzpwezdaqrai';
const APPLY = process.argv.includes('--apply');
const expectedCommit = process.argv.find((arg) => arg.startsWith('--commit='))?.slice(9);
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const readJson = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, 'utf8'));
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const manifest = z
  .object({
    tissHead: z.string().regex(/^[a-f0-9]{40}$/),
    devProjectRef: z.literal(DEV_REF),
    expectedInitialHistoryEntries: z.literal(144),
    productionAuthorized: z.literal(false),
    financialSql: z.object({ file: z.string(), sha256: z.string() }),
    financialEntry: z.object({
      idx: z.literal(159),
      tag: z.literal('0159_saas_period_snapshot'),
      when: z.number(),
    }),
    tissDependencies: z
      .array(z.object({ tag: z.string(), idx: z.number(), when: z.number(), sha256: z.string() }))
      .length(15),
  })
  .parse(await readJson('docs/decoupling/asaas-to-abacatepay/migrations/release-manifest.json'));
const composition = z
  .object({
    frozenMatch: z.literal(true),
    source: z.object({ tissRef: z.literal(manifest.tissHead) }),
    journalProposal: z.object({
      directory: z.string().regex(/^dist\/abacatepay-tiss-release-158-[a-f0-9]{8}$/),
    }),
  })
  .parse(await readJson('dist/abacatepay-tiss-composition.json'));
const migrationsFolder = `${composition.journalProposal.directory}/drizzle/migrations`;
const journal = z
  .object({
    entries: z.array(z.object({ idx: z.number(), tag: z.string(), when: z.number() })).length(160),
  })
  .parse(await readJson(`${migrationsFolder}/meta/_journal.json`)).entries;
const historical = z
  .object({
    scalabilityFollowup: z.object({
      sharedDevFinal: z.object({
        historicalDifferenceDetails: z
          .array(z.object({ tag: z.string(), when: z.string(), appliedHash: z.string() }))
          .length(6),
      }),
    }),
  })
  .parse(
    await readJson(
      'docs/decoupling/asaas-to-abacatepay/evidencias/recuperacao-financeira-20261111.json',
    ),
  ).scalabilityFollowup.sharedDevFinal.historicalDifferenceDetails;
const expected = await Promise.all(
  journal.map(async (entry, idx) => {
    assert.equal(entry.idx, idx);
    if (idx) assert.ok(entry.when > (journal[idx - 1]?.when ?? Infinity));
    const body = (await readFile(`${migrationsFolder}/${entry.tag}.sql`, 'utf8')).replaceAll(
      '\r\n',
      '\n',
    );
    const hash = sha256(body);
    const frozen = manifest.tissDependencies.find((item) => item.idx === idx);
    if (frozen) {
      assert.equal(frozen.sha256, hash);
      assert.equal(frozen.when, entry.when);
      assert.equal(frozen.tag, entry.tag);
    }
    if (idx === 159) {
      assert.equal(hash, manifest.financialSql.sha256);
      assert.deepEqual(entry, manifest.financialEntry);
    }
    const old = historical.find((item) => item.tag === entry.tag);
    if (old) assert.equal(old.when, String(entry.when));
    return { hash: old?.appliedHash ?? hash, created_at: String(entry.when) };
  }),
);
assert.equal(
  sha256((await readFile(manifest.financialSql.file, 'utf8')).replaceAll('\r\n', '\n')),
  manifest.financialSql.sha256,
);
const tissRoot = process.env.QORO_TISS_WORKTREE;
assert.ok(tissRoot, 'Read-only TISS worktree is required');
const verifySources = () => {
  assert.equal(git(tissRoot, 'rev-parse', 'HEAD'), manifest.tissHead);
  assert.equal(
    git(tissRoot, 'status', '--porcelain', '--', 'drizzle/migrations'),
    '',
    'TISS migration files are changing: stop',
  );
  const remote = git('.', 'ls-remote', 'origin', 'refs/pull/55/head').split(/\s+/)[0];
  assert.equal(remote, manifest.tissHead, 'Remote TISS tail changed: stop');
  if (APPLY) {
    assert.match(expectedCommit ?? '', /^[a-f0-9]{40}$/);
    assert.equal(git('.', 'rev-parse', 'HEAD'), expectedCommit);
    const changes = git('.', 'diff', '--name-only', '--diff-filter=AM');
    assert.equal(changes, '', 'Commit reviewed changes before applying');
  }
};
verifySources();
const localEnvFile = process.env.QORO_LOCAL_ENV_FILE;
assert.ok(
  localEnvFile && path.isAbsolute(localEnvFile),
  'Set the existing absolute local env file path; never copy it into this worktree',
);
const local = parse(await readFile(localEnvFile));
const target = new URL(local.DATABASE_URL_DEV ?? '');
assert.equal(decodeURIComponent(target.username), `postgres.${DEV_REF}`);
assert.match(target.hostname, /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/);
if (target.port === '6543') target.port = '5432';
assert.equal(target.port, '5432');
const sql = postgres(target.toString(), {
  ssl: 'require',
  max: 1,
  prepare: false,
  connect_timeout: 15,
  onnotice: () => {},
  connection: {
    application_name: 'qoro-authorized-dev-0159',
  },
});
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  target: DEV_REF,
  mode: APPLY ? 'authorized_apply' : 'read_only_preflight',
  financialCommit: git('.', 'rev-parse', 'HEAD'),
  tissHead: manifest.tissHead,
  financialSqlSha256: manifest.financialSql.sha256,
  productionWrites: 0,
  applied: false,
};
let locked = false;
try {
  // Supavisor can ignore startup parameters. Set and verify on this session explicitly.
  await sql`SELECT set_config('lock_timeout','2s',false),set_config('statement_timeout','15s',false),set_config('idle_in_transaction_session_timeout','30s',false),set_config('application_name','qoro-authorized-dev-0159',false)`;
  const [limits] =
    await sql`SELECT current_setting('lock_timeout') lt,current_setting('statement_timeout') st`;
  assert.equal(limits?.lt, '2s');
  assert.equal(limits?.st, '15s');
  report.sessionLimits = limits;
  const history = async () =>
    Array.from(
      await sql<
        { hash: string; created_at: string }[]
      >`SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at`,
      (row) => ({ hash: row.hash, created_at: row.created_at }),
    );
  const beforeHistory = await history();
  assert.ok([144, 159, 160].includes(beforeHistory.length), 'Unexpected history length');
  assert.deepEqual(beforeHistory, expected.slice(0, beforeHistory.length), 'Exact history drift');
  const invariantCounts = async () => {
    const [row] = await sql`SELECT
      (SELECT count(*)::int FROM public.subscriptions s WHERE NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.clinic_id=s.clinic_id AND p.role='owner' AND p.ativo)) orphan_contracts,
      (SELECT count(*)::int FROM public.invoices i JOIN public.subscriptions s ON s.id=i.subscription_id WHERE i.clinic_id<>s.clinic_id) cross_tenant_invoices,
      (SELECT count(*)::int FROM (SELECT account_id,external_subscription_id,cycle_index FROM billing_gateway.recurring_access_periods GROUP BY 1,2,3 HAVING count(*)>1) d) duplicate_cycles`;
    assert.ok(row);
    assert.equal(row.cross_tenant_invoices, 0);
    assert.equal(row.duplicate_cycles, 0);
    return row;
  };
  const beforeCounts = await invariantCounts();
  const columns = await sql<{ table_schema: string; table_name: string; columns: string[] }[]>`
    SELECT table_schema,table_name,array_agg(column_name::text ORDER BY ordinal_position) columns
    FROM information_schema.columns c WHERE table_schema IN('public','auth','billing_gateway')
    AND EXISTS(SELECT 1 FROM pg_tables t WHERE t.schemaname=c.table_schema AND t.tablename=c.table_name)
    AND table_name<>'_schema_version' GROUP BY 1,2 ORDER BY 1,2`;
  const quoted = (name: string) => '"' + name.replaceAll('"', '""') + '"';
  const fingerprints = async () => {
    const queries = columns.map((table) => {
      const name = `${table.table_schema}.${table.table_name}`;
      const selected = table.columns.map(quoted).join(',');
      return `SELECT '${name.replaceAll("'", "''")}' AS relation,count(*)::int AS rows,md5(coalesce(string_agg(row_hash,'' ORDER BY row_hash),'')) AS fingerprint FROM (SELECT md5(row_to_json(existing)::text) row_hash FROM (SELECT ${selected} FROM ${quoted(table.table_schema)}.${quoted(table.table_name)}) existing) hashes`;
    });
    return Array.from(await sql.unsafe(queries.join(' UNION ALL ')));
  };
  const before = await fingerprints();
  report.before = {
    historyEntries: beforeHistory.length,
    invariants: beforeCounts,
    tableFingerprints: before,
  };
  if (APPLY && beforeHistory.length < 160) {
    const backup = z
      .object({
        status: z.literal('PASS'),
        file: z.string(),
        sha256: z.string(),
        decryptionVerified: z.literal(true),
        observedAt: z.string(),
      })
      .parse(await readJson('dist/dev-release-backup.json'));
    assert.ok(Date.now() - Date.parse(backup.observedAt) < 24 * 3600_000, 'Backup is stale');
    assert.equal(sha256(await readFile(backup.file)), backup.sha256);
    report.backup = { sha256: backup.sha256, decryptionVerified: true };
    const [lock] = await sql`SELECT pg_try_advisory_lock(718413,159) acquired`;
    assert.equal(lock?.acquired, true, 'Another cooperating DEV migrator is active');
    locked = true;
    const [activity] = await sql`SELECT
      count(*) FILTER(WHERE xact_start<now()-interval '30 seconds')::int long_transactions,
      count(*) FILTER(WHERE state='active' AND query~*'^\\s*(alter|create|drop|truncate|reindex|vacuum|grant|revoke)\\M')::int active_ddl
      FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'`;
    const [locks] = await sql`SELECT count(*)::int waiting FROM pg_locks WHERE NOT granted`;
    assert.equal(activity?.long_transactions, 0, 'Long transaction present: stop');
    assert.equal(activity?.active_ddl, 0, 'Concurrent DDL observed: stop');
    assert.equal(locks?.waiting, 0, 'Waiting locks present: stop');
    verifySources();
    assert.deepEqual(await history(), beforeHistory);
    report.activity = { ...activity, waitingLocks: locks.waiting, advisoryLock: true };
    const started = performance.now();
    await migrate(drizzle(sql), { migrationsFolder });
    report.migrationMs = performance.now() - started;
    report.applied = true;
  }
  const afterHistory = await history();
  assert.deepEqual(afterHistory, APPLY ? expected : beforeHistory, 'Postflight history mismatch');
  const after = await fingerprints();
  assert.deepEqual(after, before, 'Existing data changed; stop, do not auto-restore shared DEV');
  assert.deepEqual(await invariantCounts(), beforeCounts);
  if (afterHistory.length === 160) {
    const security = await sql`SELECT relname,relrowsecurity AND relforcerowsecurity secured,
      has_table_privilege('authenticated',oid,'SELECT') tenant_read,
      has_table_privilege('service_role',oid,'DELETE') service_delete FROM pg_class
      WHERE oid IN('billing_gateway.renewal_api_readbacks'::regclass,'billing_gateway.statement_scans'::regclass,'billing_gateway.statement_scan_items'::regclass) ORDER BY relname`;
    assert.equal(security.length, 3);
    for (const row of security) {
      assert.equal(row.secured, true);
      assert.equal(row.tenant_read, false);
      assert.equal(row.service_delete, false);
    }
    const [functionCheck] =
      await sql`SELECT position('production' IN pg_get_functiondef('billing_gateway.validate_review_replay()'::regprocedure))>0 production_namespace`;
    assert.equal(functionCheck?.production_namespace, true);
    if (APPLY) {
      await migrate(drizzle(sql), { migrationsFolder });
      assert.deepEqual(await history(), expected);
    }
    report.security = security;
    const catalog = await sql`WITH target AS (
      SELECT c.oid,n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind='r' AND ((n.nspname='public' AND c.relname LIKE 'hi\\_%' ESCAPE '\\')
        OR (n.nspname='billing_gateway' AND c.relname IN
          ('operations','recurring_payment_observations','renewal_api_readbacks','statement_scans','statement_scan_items')))
    ) SELECT nspname schema,relname relation,relrowsecurity rls,relforcerowsecurity forced_rls,
      (SELECT jsonb_agg(jsonb_build_object('name',conname,'type',contype,'validated',convalidated,
        'definition',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid=t.oid) constraints,
      (SELECT jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,
        'definition',pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=t.oid AND NOT tgisinternal) triggers,
      (SELECT jsonb_agg(jsonb_build_object('name',ci.relname,'valid',i.indisvalid,'ready',i.indisready,
        'definition',pg_get_indexdef(i.indexrelid)) ORDER BY ci.relname)
        FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid WHERE i.indrelid=t.oid) indexes
      FROM target t ORDER BY nspname,relname`;
    assert.ok(catalog.length > 20, 'Expected financial and TISS relations missing');
    for (const relation of catalog) {
      const indexes = z
        .array(z.object({ valid: z.literal(true), ready: z.literal(true) }))
        .nullable()
        .parse(relation.indexes);
      const constraints = z
        .array(z.object({ validated: z.literal(true) }))
        .nullable()
        .parse(relation.constraints);
      assert.ok(indexes && constraints, 'Expected indexes or constraints missing');
    }
    report.effectiveSchema = {
      sha256: sha256(JSON.stringify(catalog)),
      relations: catalog,
      invalidIndexes: 0,
      unvalidatedConstraints: 0,
      financial0159Verified: true,
      note: 'Catalog definitions, not row count alone. SQL source hashes and history checked separately.',
    };
    const [orphans] = await sql`SELECT
      count(*) FILTER(WHERE c.slug LIKE 'e2e-hi-%')::int owner_tiss_fixtures,
      count(*) FILTER(WHERE c.slug NOT LIKE 'e2e-hi-%')::int other_dev
      FROM public.subscriptions s JOIN public.clinics c ON c.id=s.clinic_id
      WHERE NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.clinic_id=s.clinic_id AND p.role='owner' AND p.ativo)`;
    report.orphanClassification = orphans;
    report.repeatedMigrator = APPLY ? 'no_change' : 'not_run';
  }
  report.after = {
    historyEntries: afterHistory.length,
    invariants: await invariantCounts(),
    existingTableCount: after.length,
    existingDataPreserved: true,
  };
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  // Never print a database exception: it may contain SQL values or a credential.
  report.failure =
    error instanceof assert.AssertionError
      ? error.message.split('\n')[0]
      : 'Operation failed; sensitive database details suppressed';
  process.exitCode = 1;
} finally {
  if (locked) await sql`SELECT pg_advisory_unlock(718413,159)`;
  try {
    await sql`RESET ALL`;
  } finally {
    await sql.end({ timeout: 5 });
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(
    path.join(
      'dist',
      APPLY ? 'abacatepay-dev-release-applied.json' : 'abacatepay-dev-release-preflight.json',
    ),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      status: report.status,
      mode: report.mode,
      applied: report.applied,
      failure: report.failure,
      before: report.before && beforeSummary(report.before),
      after: report.after,
      productionWrites: 0,
    }),
  );
}

function beforeSummary(value: unknown) {
  return z.object({ historyEntries: z.number(), invariants: z.unknown() }).parse(value);
}
