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
await writeFile('dist/abacatepay-tiss-composition.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
