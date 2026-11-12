/** Review-only manifest. Never writes a journal, database, branch or another worktree. */
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadTissProofInputs } from './abacatepay-tiss-input';

const proof = await loadTissProofInputs();
const candidatePath =
  'docs/decoupling/asaas-to-abacatepay/migrations/saas_period_snapshot.candidate.sql';
const candidate = await readFile(candidatePath, 'utf8');
const sha256 = (text: string) =>
  createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');
// Compare an announced tail with the immutable inputs without importing or applying it.
const authorizedRoot = process.env.QORO_TISS_WORKTREE;
if (!authorizedRoot) throw new Error('Missing authorized read-only TISS worktree');
let draft: { file: string; sha256: string; state: string } | null = null;
try {
  const file = path.join(authorizedRoot, 'drizzle/migrations/0151_hi_premium_gate.sql');
  const first = await readFile(file, 'utf8');
  const second = await readFile(file, 'utf8');
  const committed = proof.sources.find((source) => source.tag === '0151_hi_premium_gate');
  draft = {
    file: '0151_hi_premium_gate.sql',
    sha256: sha256(first),
    state:
      sha256(first) !== sha256(second)
        ? 'CHANGING_NOT_APPLIED'
        : committed && committed.sha256 === sha256(first)
          ? 'PINNED_COMMIT_NOT_APPLIED_BY_THIS_MANIFEST'
          : 'WORKTREE_DIFFERS_FROM_PINNED_INPUT_NOT_APPLIED',
  };
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}
const manifest = {
  observedAt: new Date().toISOString(),
  status: 'PREPARED_NOT_APPLICABLE_TO_SHARED_DATABASE',
  source: {
    tissRef: proof.head,
    financialBaseEntries: proof.financial.length,
    orderedSnapshotEntries: proof.ordered.length,
    access: proof.sourceAccess,
  },
  tiss: proof.sources.map(({ tag, idx, when, sha256 }) => ({ tag, idx, when, sha256 })),
  draft,
  financialCandidate: {
    file: candidatePath,
    sha256: sha256(candidate),
    journalEntry: null,
    sequencePosition: 'AFTER_THE_AGREED_FROZEN_TISS_TAIL',
  },
  integrationContract: {
    sql: 'public.qoro_premium_denial(uuid,text)',
    tenantScope: 'app.current_clinic must equal the authorized clinic',
    features: ['patient_charges', 'ai_agents', 'health_insurance'],
    paidAccess:
      'Verified invoice release, contracted rights, existing grace and fresh period; no grant from checkout state',
    moduleRelease: 'Commercial permission does not enable an unapproved operational module',
    compatibility: 'App gate may further restrict; never broaden a denial from the shared SQL gate',
  },
  applicationStages: [
    'Freeze and review the TISS tail including its premium gate; recompute all source hashes',
    'Agree the journal position and timestamp after that tail; never backfill an older timestamp',
    'Run disposable composition, trial, RLS, concurrency and recovery proofs on those exact inputs',
    'Obtain specific shared-DEV SQL approval for the final reviewed hashes and execute a fresh preflight',
    'Apply only the approved sequence atomically with lock and statement limits; run postflight',
  ],
  sharedDevBaseline: {
    expectedLastTissTag: '0143_tiss_catalog',
    verifyAgainst: 'Fresh authenticated history read, not migration count alone',
    sequence: proof.sources
      .filter((source) => source.idx > 143)
      .map(({ tag, idx, when, sha256 }) => ({ tag, idx, when, sha256 })),
    financialFinalStep: {
      file: candidatePath,
      sha256: sha256(candidate),
      version: 'UNASSIGNED_UNTIL_TAIL_FREEZE',
    },
  },
  lockBudget: {
    lockTimeout: '2 seconds',
    statementTimeout: '15 seconds per candidate statement',
    impact:
      'ALTER TABLE obtains AccessExclusiveLock; new CHECK validates existing observations. No estimate for shared data without preflight size/long-transaction measurements.',
    stop: 'Any timeout or changed history/hash: rollback transaction, no automatic retry or DOWN',
  },
  readOnlyChecks: ['dist/abacatepay-tiss-preflight.sql', 'dist/abacatepay-tiss-postflight.sql'],
  interruption: [
    'Any source/history hash drift',
    'Uncommitted tail',
    'Lock timeout',
    'Contract or tenant invariants fail',
  ],
  recovery:
    'Rollback the failed local transaction. Shared rollout needs its approved backup and forward-fix plan; no ledger deletion or invented down migration.',
  journalWrites: 0,
  databaseWrites: 0,
  otherWorktreeWrites: 0,
};
await mkdir('dist', { recursive: true });
await writeFile(
  'dist/abacatepay-tiss-preflight.sql',
  `-- READ ONLY. Verify the intended environment separately before using.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;
SELECT to_regclass('public.tiss_terms') IS NOT NULL tiss_catalog_present,
  to_regclass('public.hi_guides') IS NOT NULL tiss_guides_present,
  to_regclass('billing_gateway.renewal_api_readbacks') IS NOT NULL financial_candidate_present;
SELECT relname,pg_total_relation_size(oid) bytes FROM pg_class
  WHERE oid IN ('public.subscriptions'::regclass,'public.invoices'::regclass,
    'billing_gateway.operations'::regclass,'billing_gateway.recurring_payment_observations'::regclass);
SELECT count(*) transactions_older_than_30s FROM pg_stat_activity
  WHERE datname=current_database() AND xact_start<now()-interval '30 seconds';
SELECT mode,count(*) FROM pg_locks WHERE NOT granted GROUP BY mode;
SELECT count(*) contracts_without_active_owner FROM public.subscriptions s WHERE NOT EXISTS(
  SELECT 1 FROM public.profiles p WHERE p.clinic_id=s.clinic_id AND p.role='owner' AND p.ativo);
SELECT count(*) invoice_tenant_mismatch FROM public.invoices i
  JOIN public.subscriptions s ON s.id=i.subscription_id WHERE i.clinic_id<>s.clinic_id;
COMMIT;
`,
);
await writeFile(
  'dist/abacatepay-tiss-postflight.sql',
  `-- READ ONLY. Compare against the preflight and approved journal hashes.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;
SELECT relrowsecurity,relforcerowsecurity FROM pg_class
  WHERE oid='billing_gateway.renewal_api_readbacks'::regclass;
SELECT has_table_privilege('authenticated','billing_gateway.renewal_api_readbacks','SELECT') tenant_select,
  has_table_privilege('service_role','billing_gateway.renewal_api_readbacks','DELETE') service_delete,
  has_table_privilege('service_role','billing_gateway.renewal_api_readbacks','INSERT') service_insert;
SELECT count(*) duplicate_cycles FROM (SELECT account_id,external_subscription_id,cycle_index
  FROM billing_gateway.recurring_access_periods GROUP BY 1,2,3 HAVING count(*)>1) d;
SELECT count(*) invoice_tenant_mismatch FROM public.invoices i
  JOIN public.subscriptions s ON s.id=i.subscription_id WHERE i.clinic_id<>s.clinic_id;
SELECT count(*) contracts_without_active_owner FROM public.subscriptions s WHERE NOT EXISTS(
  SELECT 1 FROM public.profiles p WHERE p.clinic_id=s.clinic_id AND p.role='owner' AND p.ativo);
COMMIT;
`,
);
await writeFile('dist/abacatepay-tiss-composition.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
