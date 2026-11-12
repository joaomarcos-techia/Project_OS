/** Executes the generated read-only release checks only against a fresh loopback DB. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { startScratchSchema } from './scratch-schema';
import { loadTissProofInputs } from './abacatepay-tiss-input';

execFileSync(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', 'scripts/security/abacatepay-tiss-composition.ts'],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
const proof = await loadTissProofInputs();
const cluster = await startScratchSchema({ port: 55494 });
assert.equal(new URL(cluster.url).hostname, '127.0.0.1');
try {
  // Scratch applies SQL directly. A history-shaped fixture lets the exact
  // read-only queries execute; it does not assert a remotely applied journal.
  await cluster.sql`CREATE SCHEMA drizzle`;
  await cluster.sql`CREATE TABLE drizzle.__drizzle_migrations(hash text NOT NULL,created_at bigint NOT NULL)`;
  const session = await cluster.sql.reserve();
  try {
    await session.unsafe(await readFile('dist/abacatepay-tiss-preflight.sql', 'utf8'));
  } finally {
    session.release();
  }
  await cluster.sql.begin(async (tx) => {
    for (const source of proof.sources) await tx.unsafe(source.body);
    await tx.unsafe(
      await readFile(
        'docs/decoupling/asaas-to-abacatepay/migrations/saas_period_snapshot.candidate.sql',
        'utf8',
      ),
    );
  });
  const postSession = await cluster.sql.reserve();
  try {
    await postSession.unsafe(await readFile('dist/abacatepay-tiss-postflight.sql', 'utf8'));
  } finally {
    postSession.release();
  }
  const [security] = await cluster.sql`SELECT relrowsecurity AND relforcerowsecurity secured,
    has_table_privilege('authenticated','billing_gateway.renewal_api_readbacks','SELECT') tenant_read,
    has_table_privilege('service_role','billing_gateway.renewal_api_readbacks','DELETE') service_delete
    FROM pg_class WHERE oid='billing_gateway.renewal_api_readbacks'::regclass`;
  assert.deepEqual(security, { secured: true, tenant_read: false, service_delete: false });
  const report = {
    observedAt: new Date().toISOString(),
    status: 'PASS',
    environment: 'loopback_synthetic',
    tissHead: proof.head,
    checks: [
      'exact generated preflight SQL executes',
      'pinned combined schema applies atomically',
      'exact generated postflight SQL executes',
      'RLS forced and sensitive grants refused',
    ],
    journalWrites: 0,
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
