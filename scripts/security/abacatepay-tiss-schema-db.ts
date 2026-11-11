/** Read-only TISS inputs; both SQL orders run and roll back on loopback only. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { startScratchSchema } from './scratch-schema';

const journalSchema = z.object({
  entries: z.array(
    z.object({
      idx: z.number().int(),
      when: z.number().int(),
      tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/),
    }),
  ),
});
const tissInput = process.env.QORO_TISS_WORKTREE;
assert.ok(tissInput, 'Set QORO_TISS_WORKTREE to the authorized read-only TISS checkout');
const tissRoot = await realpath(tissInput);
assert.notEqual(tissRoot.toLowerCase(), (await realpath('.')).toLowerCase());
const git = (...args: string[]) =>
  execFileSync('git', ['-C', tissRoot, ...args], { encoding: 'utf8', windowsHide: true }).trim();
const tissHead = git('rev-parse', 'HEAD'),
  tissStatus = git('status', '--porcelain');
const readJournal = async (root: string) =>
  journalSchema.parse(
    JSON.parse(await readFile(path.join(root, 'drizzle/migrations/meta/_journal.json'), 'utf8')),
  ).entries;
const financial = await readJournal('.'),
  tiss = await readJournal(tissRoot);
assert.equal(financial.at(-1)?.idx, 142);
assert.equal(
  tiss.at(-1)?.idx,
  147,
  'TISS advanced: re-coordinate before assuming any free version',
);
const additions = tiss.filter((entry) => entry.idx >= 143);
assert.deepEqual(
  additions.map((entry) => entry.idx),
  [143, 144, 145, 146, 147],
);
for (const entry of tiss.filter((entry) => entry.idx < 143)) {
  const matching = financial.find((item) => item.idx === entry.idx);
  assert.deepEqual(matching, entry, 'Common history diverged');
}
const merged = [...financial, ...additions];
for (let index = 0; index < merged.length; index++) {
  assert.equal(merged[index]?.idx, index);
  if (index) assert.ok((merged[index]?.when ?? 0) > (merged[index - 1]?.when ?? 0));
}
const source = await Promise.all(
  additions.map(async (entry) => {
    const body = await readFile(
      path.join(tissRoot, 'drizzle/migrations', `${entry.tag}.sql`),
      'utf8',
    );
    return { ...entry, body, sha256: createHash('sha256').update(body).digest('hex') };
  }),
);
const candidate = await readFile(
  'docs/decoupling/asaas-to-abacatepay/migrations/saas_period_snapshot.candidate.sql',
  'utf8',
);
const cluster = await startScratchSchema({ port: 55494 });
assert.equal(new URL(cluster.url).hostname, '127.0.0.1');
const checks: { name: string; status: 'PASS'; fingerprint?: string }[] = [];
class RollbackProof extends Error {}
type ScratchTransaction = Parameters<Parameters<typeof cluster.sql.begin>[1]>[0];
async function fingerprint(tx: ScratchTransaction, scope: 'billing' | 'tiss') {
  const rows =
    await tx`SELECT n.nspname schema,c.relname name,c.relrowsecurity rls,c.relforcerowsecurity forced,
    (SELECT jsonb_agg(pg_get_constraintdef(k.oid) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid) constraints,
    (SELECT jsonb_agg(row_to_json(p) ORDER BY p.policyname) FROM pg_policies p WHERE p.schemaname=n.nspname AND p.tablename=c.relname) policies
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r'
      AND ((${scope}='billing' AND (n.nspname='billing_gateway' OR (n.nspname='public' AND c.relname IN ('subscriptions','invoices','payment_attempts','prices','plans'))))
        OR (${scope}='tiss' AND n.nspname='public' AND (left(c.relname,3)='hi_' OR left(c.relname,5)='tiss_')))
    ORDER BY n.nspname,c.relname`;
  const catalog =
    scope === 'billing'
      ? await tx`SELECT
    (SELECT jsonb_agg(row_to_json(p) ORDER BY p.id) FROM public.plans p) plans,
    (SELECT jsonb_agg(row_to_json(p) ORDER BY p.id) FROM public.prices p) prices`
      : [];
  return createHash('sha256').update(JSON.stringify({ rows, catalog })).digest('hex');
}
let failure: unknown;
try {
  for (const order of ['financial_then_tiss', 'tiss_then_financial'] as const) {
    try {
      await cluster.sql.begin(async (tx) => {
        if (order === 'financial_then_tiss') await tx.unsafe(candidate);
        else for (const migration of source) await tx.unsafe(migration.body);
        const scope = order === 'financial_then_tiss' ? 'billing' : 'tiss';
        const before = await fingerprint(tx, scope);
        if (order === 'financial_then_tiss')
          for (const migration of source) await tx.unsafe(migration.body);
        else await tx.unsafe(candidate);
        assert.equal(await fingerprint(tx, scope), before, 'Unrelated schema/catalog changed');
        const [row] =
          await tx`SELECT to_regclass('billing_gateway.renewal_api_readbacks') IS NOT NULL recovery,
          to_regclass('public.hi_guides') IS NOT NULL guides,
          (SELECT relforcerowsecurity FROM pg_class WHERE oid='billing_gateway.renewal_api_readbacks'::regclass) forced_rls,
          has_table_privilege('service_role','billing_gateway.renewal_api_readbacks','DELETE') service_delete`;
        assert.deepEqual(row, {
          recovery: true,
          guides: true,
          forced_rls: true,
          service_delete: false,
        });
        checks.push({ name: order, status: 'PASS', fingerprint: before });
        throw new RollbackProof();
      });
    } catch (error) {
      if (!(error instanceof RollbackProof)) throw error;
    }
    const [rolledBack] =
      await cluster.sql`SELECT to_regclass('billing_gateway.renewal_api_readbacks') IS NULL recovery,
      to_regclass('public.hi_guides') IS NULL guides`;
    assert.deepEqual(rolledBack, { recovery: true, guides: true });
    checks.push({ name: `${order}_rollback`, status: 'PASS' });
  }
  assert.equal(git('rev-parse', 'HEAD'), tissHead);
  assert.equal(git('status', '--porcelain'), tissStatus);
  checks.push({ name: 'common_journal_identity_order_and_readonly_tiss_inputs', status: 'PASS' });
} catch (error) {
  failure = error;
} finally {
  await mkdir('dist', { recursive: true });
  await writeFile(
    'dist/abacatepay-tiss-schema-db.json',
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        environment: 'loopback_synthetic_schema_only',
        status: failure ? 'FAIL' : 'PASS',
        tissHead,
        financialBase: execFileSync('git', ['rev-parse', 'HEAD'], {
          encoding: 'utf8',
          windowsHide: true,
        }).trim(),
        tissSources: source.map(({ idx, when, tag, sha256 }) => ({ idx, when, tag, sha256 })),
        candidateSha256: createHash('sha256').update(candidate).digest('hex'),
        checks,
        remoteWrites: 0,
        otherWorktreeWrites: 0,
        billingDataCoverage:
          'Existing dedicated renewal harness; this proof checks SQL order and schema/catalog preservation only',
      },
      null,
      2,
    ),
  );
  await cluster.stop();
}
if (failure) throw failure;
console.log(
  JSON.stringify({
    status: 'PASS',
    checks: checks.length,
    remoteWrites: 0,
    otherWorktreeWrites: 0,
  }),
);
