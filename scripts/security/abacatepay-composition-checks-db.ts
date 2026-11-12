/** Executes the generated read-only release checks only against a fresh loopback DB. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { startScratchSchema } from './scratch-schema';
import { loadTissProofInputs } from './abacatepay-tiss-input';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

execFileSync(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', 'scripts/security/abacatepay-tiss-composition.ts'],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
const proof = await loadTissProofInputs();
const manifest = z
  .object({
    journalProposal: z.object({
      directory: z.string().regex(/^dist\/abacatepay-tiss-release-\d{3}-[a-f0-9]{8}$/),
      entry: z.object({ idx: z.number().int(), tag: z.string() }),
    }),
  })
  .parse(JSON.parse(await readFile('dist/abacatepay-tiss-composition.json', 'utf8')));
const migrationsFolder = `${manifest.journalProposal.directory}/drizzle/migrations`;
const expectedEntries = proof.ordered.length + 1;
const pendingEntries = expectedEntries - 144;
assert.equal(manifest.journalProposal.entry.idx, proof.lastIndex + 1);
assert.equal(
  manifest.journalProposal.entry.tag,
  `${String(proof.lastIndex + 1).padStart(4, '0')}_saas_period_snapshot`,
);
const journal = z
  .object({
    entries: z.array(z.object({ idx: z.number().int(), when: z.number().int(), tag: z.string() })),
  })
  .parse(JSON.parse(await readFile(`${migrationsFolder}/meta/_journal.json`, 'utf8')));
assert.equal(journal.entries.length, expectedEntries);
for (const [index, entry] of journal.entries.entries()) {
  assert.equal(entry.idx, index);
  if (index) assert.ok(entry.when > (journal.entries[index - 1]?.when ?? Infinity));
}
const proposedSql = await readFile(
  `${migrationsFolder}/${manifest.journalProposal.entry.tag}.sql`,
  'utf8',
);
const candidateSql = await readFile(
  'docs/decoupling/asaas-to-abacatepay/migrations/saas_period_snapshot.candidate.sql',
  'utf8',
);
const hash = (s: string) => createHash('sha256').update(s.replaceAll('\r\n', '\n')).digest('hex');
assert.equal(hash(proposedSql), hash(candidateSql));
const historyFixture = z
  .object({
    scalabilityFollowup: z.object({
      sharedDevFinal: z.object({
        historicalDifferenceDetails: z
          .array(
            z.object({
              tag: z.string(),
              when: z.string(),
              appliedHash: z.string().regex(/^[a-f0-9]{64}$/),
            }),
          )
          .length(6),
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
const cluster = await startScratchSchema({ port: 55494 });
assert.equal(new URL(cluster.url).hostname, '127.0.0.1');
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: cluster.url,
  DATABASE_URL_DEV: cluster.url,
  DATABASE_URL_RUNTIME: cluster.url,
  SUPABASE_PROJECT_ENV: 'dev',
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_journal',
});
delete process.env.VERCEL_ENV;
delete process.env.DATABASE_URL_PROD;
const { dbAdmin: database } = await import('../../src/lib/db');
try {
  // Reconstruct the observed DEV baseline locally: through 0143, with exact
  // hashes/timestamps. No shared history is fabricated or changed.
  await cluster.sql`CREATE SCHEMA drizzle`;
  await cluster.sql`CREATE TABLE drizzle.__drizzle_migrations(id serial PRIMARY KEY,hash text NOT NULL,created_at bigint NOT NULL)`;
  const first = proof.sources[0];
  assert.ok(first);
  assert.equal(first.idx, 143);
  await cluster.sql.unsafe(first.body);
  for (const entry of journal.entries.filter((e) => e.idx <= 143)) {
    const body = await readFile(`${migrationsFolder}/${entry.tag}.sql`, 'utf8');
    const historic = historyFixture.find((e) => e.tag === entry.tag);
    if (historic) assert.equal(historic.when, String(entry.when));
    await cluster.sql`INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES(${historic?.appliedHash ?? hash(body)},${entry.when})`;
  }
  const historyFingerprint = async () => {
    const [row] =
      await cluster.sql`SELECT md5(string_agg(hash||created_at::text,'' ORDER BY created_at)) fingerprint
      FROM drizzle.__drizzle_migrations WHERE created_at<=${first.when}`;
    return row;
  };
  const historyBefore = await historyFingerprint();
  const fingerprint = async () => {
    const [row] = await cluster.sql`SELECT
      (SELECT md5(string_agg(row_to_json(p)::text,'' ORDER BY p.id)) FROM public.plans p) plans,
      (SELECT md5(string_agg(row_to_json(p)::text,'' ORDER BY p.id)) FROM public.prices p) prices`;
    return row;
  };
  const before = await fingerprint();
  const session = await cluster.sql.reserve();
  try {
    await session.unsafe(await readFile('dist/abacatepay-tiss-preflight.sql', 'utf8'));
  } finally {
    session.release();
  }
  const options = { migrationsFolder };
  await migrate(database, options);
  assert.deepEqual(await fingerprint(), before);
  const [history] =
    await cluster.sql`SELECT count(*)::int count,max(created_at)::text last FROM drizzle.__drizzle_migrations`;
  assert.equal(history?.count, expectedEntries);
  assert.equal(history.last, String(journal.entries.at(-1)?.when));
  await migrate(database, options);
  const [repeated] =
    await cluster.sql`SELECT count(*)::int count FROM drizzle.__drizzle_migrations`;
  assert.equal(repeated?.count, expectedEntries);
  assert.deepEqual(await fingerprint(), before);
  assert.deepEqual(await historyFingerprint(), historyBefore);
  const postSession = await cluster.sql.reserve();
  try {
    await postSession.unsafe(await readFile('dist/abacatepay-tiss-postflight.sql', 'utf8'));
  } finally {
    postSession.release();
  }
  const security = await cluster.sql`SELECT relrowsecurity AND relforcerowsecurity secured,
    has_table_privilege('authenticated',oid,'SELECT') tenant_read,
    has_table_privilege('service_role',oid,'DELETE') service_delete
    FROM pg_class WHERE oid IN('billing_gateway.renewal_api_readbacks'::regclass,
      'billing_gateway.statement_scans'::regclass,'billing_gateway.statement_scan_items'::regclass)`;
  assert.equal(security.length, 3);
  for (const row of security)
    assert.deepEqual(row, { secured: true, tenant_read: false, service_delete: false });
  const report = {
    observedAt: new Date().toISOString(),
    status: 'PASS',
    environment: 'loopback_synthetic',
    tissHead: proof.head,
    checks: [
      `review-only journal has ${expectedEntries} consecutive entries and increasing timestamps`,
      'proposed financial SQL equals the reviewed candidate hash',
      'exact generated preflight SQL executes',
      `real Drizzle upgrade from 0143 applies exactly ${pendingEntries} pending entries and preserves catalog`,
      'second real migrator run applies no entries or catalog changes',
      'all 144 baseline history entries including six historical applied hashes remain unchanged',
      'exact generated postflight SQL executes',
      'RLS forced and sensitive grants refused',
    ],
    repositoryJournalWrites: 0,
    scratchJournalEntries: expectedEntries,
    schemaSource:
      'Repository schema plus pinned TISS; history-shaped DEV baseline, not a clone of DEV data',
    remoteWrites: 0,
  };
  await writeFile(
    'dist/abacatepay-composition-checks-db.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report));
} finally {
  await cluster.stop();
}
