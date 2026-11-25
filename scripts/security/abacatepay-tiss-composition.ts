/** Review-only manifest. Never writes a journal, database, branch or another worktree. */
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { loadTissProofInputs } from './abacatepay-tiss-input';

const proof = await loadTissProofInputs();
const candidatePath =
  'docs/decoupling/asaas-to-abacatepay/migrations/saas_period_snapshot.candidate.sql';
const candidate = await readFile(candidatePath, 'utf8');
const sha256 = (text: string) =>
  createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');
// Proposed ordering only; neither the number nor timestamp is reserved. The
// current TISS journal contains future ordering timestamps, so its successor
// is not presented as a creation date. Joint review must approve the final entry.
const proposal = [151, 154, 155, 156, 158].includes(proof.lastIndex)
  ? {
      idx: proof.lastIndex + 1,
      version: '7' as const,
      breakpoints: true,
      when:
        proof.lastIndex === 151
          ? Date.parse('2026-11-12T07:42:38.000Z')
          : (proof.ordered.at(-1)?.when ?? Infinity) + 1,
      tag: `${String(proof.lastIndex + 1).padStart(4, '0')}_saas_period_snapshot`,
    }
  : null;
if (proposal) assert.ok(proposal.when > (proof.ordered.at(-1)?.when ?? Infinity));
const releaseDirectory = `dist/abacatepay-tiss-release-${proof.lastIndex}-${proof.head.slice(0, 8)}`;
// Compare an announced tail with the immutable inputs without importing or applying it.
const authorizedRoot = process.env.QORO_TISS_WORKTREE;
if (!authorizedRoot) throw new Error('Missing authorized read-only TISS worktree');
const worktreeTail = z
  .object({
    entries: z
      .array(z.object({ idx: z.number().int(), tag: z.string(), when: z.number().int() }))
      .min(1),
  })
  .parse(
    JSON.parse(
      await readFile(path.join(authorizedRoot, 'drizzle/migrations/meta/_journal.json'), 'utf8'),
    ),
  )
  .entries.at(-1);
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
  worktreeTail: {
    ...worktreeTail,
    imported: false,
    matchesPinnedTail:
      worktreeTail?.idx === proof.lastIndex && worktreeTail.tag === proof.ordered.at(-1)?.tag,
  },
  financialCandidate: {
    file: candidatePath,
    sha256: sha256(candidate),
    journalEntry: null,
    sequencePosition: 'AFTER_THE_AGREED_FROZEN_TISS_TAIL',
  },
  journalProposal: proposal
    ? {
        entry: proposal,
        state: 'REVIEW_ONLY_NOT_RESERVED',
        directory: releaseDirectory,
        timestampMeaning: 'Proposed ordering key, not creation time or shared-DEV approval',
        rule: 'Do not apply before a fresh tail/history check, joint review and specific shared-DEV approval',
      }
    : null,
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
// A frozen manifest identifies reviewed inputs; it does not execute migrations.
// Old snapshots remain reproducible as review-only packages.
const frozenPath = 'docs/decoupling/asaas-to-abacatepay/migrations/release-manifest.json';
let frozenMatch = false;
try {
  const frozen = z
    .object({
      version: z.literal(1),
      tissHead: z.string().regex(/^[a-f0-9]{40}$/),
      financialSql: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
      financialEntry: z.object({ idx: z.number().int(), tag: z.string(), when: z.number().int() }),
      productionAuthorized: z.literal(false),
    })
    .parse(JSON.parse(await readFile(frozenPath, 'utf8')));
  if (frozen.tissHead === proof.head) {
    assert.equal(frozen.financialSql.sha256, sha256(candidate), 'Frozen financial SQL changed');
    assert.deepEqual(frozen.financialEntry, {
      idx: proposal?.idx,
      tag: proposal?.tag,
      when: proposal?.when,
    });
    frozenMatch = true;
  }
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}
const releaseManifest = {
  ...manifest,
  status: frozenMatch ? 'FROZEN_FOR_AUTHORIZED_DEV_PREFLIGHT' : manifest.status,
  frozenMatch,
  frozenManifest: frozenMatch ? frozenPath : null,
  journalProposal:
    frozenMatch && manifest.journalProposal
      ? { ...manifest.journalProposal, state: 'FROZEN_REVIEWED_INPUTS_DEV_ONLY' }
      : manifest.journalProposal,
  financialCandidate: {
    ...manifest.financialCandidate,
    journalEntry: frozenMatch ? proposal : null,
  },
};
await mkdir('dist', { recursive: true });
if (proposal) {
  const directory = `${releaseDirectory}/drizzle/migrations`;
  await mkdir(`${directory}/meta`, { recursive: true });
  for (const entry of proof.financial) {
    const body = await readFile(`drizzle/migrations/${entry.tag}.sql`, 'utf8');
    await writeFile(`${directory}/${entry.tag}.sql`, body.replaceAll('\r\n', '\n'));
  }
  for (const source of proof.sources)
    await writeFile(`${directory}/${source.tag}.sql`, source.body.replaceAll('\r\n', '\n'));
  await writeFile(`${directory}/${proposal.tag}.sql`, candidate.replaceAll('\r\n', '\n'));
  await writeFile(
    `${directory}/meta/_journal.json`,
    JSON.stringify(
      { version: '7', dialect: 'postgresql', entries: [...proof.ordered, proposal] },
      null,
      2,
    ) + '\n',
  );
}
await writeFile(
  'dist/abacatepay-tiss-preflight.sql',
  `-- READ ONLY. Verify the intended environment separately before using.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;
SELECT to_regclass('public.tiss_terms') IS NOT NULL tiss_catalog_present,
  to_regclass('public.hi_guides') IS NOT NULL tiss_guides_present,
  to_regclass('billing_gateway.renewal_api_readbacks') IS NOT NULL financial_candidate_present,
  to_regclass('billing_gateway.statement_scans') IS NOT NULL scan_jobs_present,
  to_regclass('billing_gateway.statement_scan_items') IS NOT NULL scan_items_present;
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
SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class
  WHERE oid IN('billing_gateway.renewal_api_readbacks'::regclass,'billing_gateway.statement_scans'::regclass,'billing_gateway.statement_scan_items'::regclass);
SELECT c.relname,has_table_privilege('authenticated',c.oid,'SELECT') tenant_select,
  has_table_privilege('service_role',c.oid,'DELETE') service_delete
  FROM pg_class c WHERE c.oid IN('billing_gateway.statement_scans'::regclass,'billing_gateway.statement_scan_items'::regclass);
SELECT count(*) scan_inconsistent FROM billing_gateway.statement_scans
  WHERE (state='complete')<>(completed_at IS NOT NULL) OR (lease_token IS NULL)<>(lease_until IS NULL);
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
await writeFile(
  'dist/abacatepay-tiss-composition.json',
  JSON.stringify(releaseManifest, null, 2) + '\n',
);
console.log(JSON.stringify(releaseManifest));
