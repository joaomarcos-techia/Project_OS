/** B3 operator only. Never runs on import; never changes the frozen release. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync } from 'node:fs';
import { lstat, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import {
  approvedPreflightEnvironment,
  readPreflightCatalog,
} from './abacatepay-preflight-transport';
import {
  assertReleaseCatalog,
  readFrozenRelease,
  type ReleasePlan,
} from './abacatepay-release-validation';

const FINANCIAL_REF = '94f6da4aeb32b1ae7da856dc9afa105120ce6dd9';
const MIGRATION_LOCK_KEY = 4242; // Same key as the legacy Production operator.
const MAX_BACKUP_AGE_MS = 4 * 60 * 60 * 1000;
// Daily managed backups: bounded operational tolerance, not a guaranteed RPO.
const MAX_MANAGED_BACKUP_AGE_MS = 26 * 60 * 60 * 1000;
const MAX_BACKUP_METADATA_AGE_MS = 30 * 60 * 1000;
const APPLY_PROCESS_TIMEOUT_MS = 15 * 60 * 1000;
const COMMIT_MARKER = 'QORO_GATE_B_APPLIED_160';
const checksum = z.string().regex(/^[a-f0-9]{64}$/u);
const reviewedBackup = z.object({
  decision: z.literal('APPROVED_FOR_B3'),
  project: z.string().regex(/^[a-z]{20}$/u),
  backupCreatedAt: z.iso.datetime({ offset: true }),
  backupFile: z.string().min(1),
  backupSha256: checksum,
  restoreEvidenceFile: z.string().min(1),
  reviewedBy: z.string().min(1).max(120),
});

export function assertB3ExecutionPlatform(
  platform: NodeJS.Platform,
  decision: string,
  allowWindowsDeferredRecovery: boolean,
  forbiddenRunner = false,
) {
  assert.equal(forbiddenRunner, false, 'Production apply is forbidden in CI/Actions');
  if (platform === 'linux') {
    assert.equal(allowWindowsDeferredRecovery, false, 'Windows opt-in on a different platform');
    return;
  }
  assert.equal(platform, 'win32', 'Unsupported B3 execution platform');
  assert.equal(
    allowWindowsDeferredRecovery,
    true,
    'Explicit Windows metadata-only opt-in required',
  );
  assert.equal(
    decision,
    'APPROVED_FOR_B3_WITH_DEFERRED_RESTORE',
    'Windows cannot read real backups',
  );
}

/** Only configuration/metadata/evidence, never a real backup on Windows. */
export function assertPrivateOperationalPath(
  file: string,
  kind: 'file' | 'directory',
  parent: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
) {
  assert.ok(path.isAbsolute(file));
  const stat = lstatSync(file);
  assert.ok(!stat.isSymbolicLink() && (kind === 'file' ? stat.isFile() : stat.isDirectory()));
  if (platform === 'linux') {
    assert.equal(stat.mode & 0o077, 0, 'Private operational path required');
    return;
  }
  assert.equal(platform, 'win32');
  assert.ok(!file.startsWith('\\\\'), 'Local operational path required');
  const environment: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'PATHEXT', 'TEMP', 'TMP'])
    if (parent[key]) environment[key] = parent[key];
  const script = `
$ErrorActionPreference='Stop'
$target=[Console]::In.ReadToEnd()
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$item=Get-Item -LiteralPath $target -Force
for($ancestor=$item;$null -ne $ancestor;) {
 if(($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'REPARSE_POINT'}
 if($ancestor -is [IO.FileInfo]){$ancestor=$ancestor.Directory}else{$ancestor=$ancestor.Parent}
}
$acl=Get-Acl -LiteralPath $target
if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'OWNER'}
$guard=if($item.PSIsContainer){$acl}else{Get-Acl -LiteralPath $item.Directory.FullName}
if(-not $guard.AreAccessRulesProtected){throw 'INHERITANCE'}
$rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])
$own=$false
foreach($rule in $rules) {
 if($rule.IdentityReference.Value -notin @($sid.Value,'S-1-5-18')){throw 'FOREIGN_PRINCIPAL'}
 if($rule.AccessControlType -ne 'Allow'){throw 'UNEXPECTED_DENY'}
 if($rule.IdentityReference.Value -eq $sid.Value -and ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl){$own=$true}
}
if(-not $own){throw 'OWNER_ACCESS'}
[Console]::Out.Write('QORO_PRIVATE_OPERATIONAL_PATH')
`;
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      env: environment,
      input: file,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15_000,
      maxBuffer: 64 << 10,
      windowsHide: true,
    },
  );
  assert.ok(
    !result.error &&
      !result.signal &&
      result.status === 0 &&
      result.stdout === 'QORO_PRIVATE_OPERATIONAL_PATH',
    'Private Windows ACL verification failed; details suppressed',
  );
}
const deferredBackupReview = z
  .object({
    decision: z.literal('APPROVED_FOR_B3_WITH_DEFERRED_RESTORE'),
    project: z.string().regex(/^[a-z]{20}$/u),
    reviewedBy: z.string().min(1).max(120),
    backupEvidenceFile: z.string().min(1),
    backupEvidenceSha256: checksum,
    recovery: z
      .object({
        status: z.literal('DEFERRED_RISK_ACCEPTED_NOT_VERIFIED'),
        acceptedBy: z.string().min(1).max(120),
        acceptedAt: z.iso.datetime({ offset: true }),
        decisionReference: z.string().min(8).max(500),
      })
      .strict(),
  })
  .strict();

export function validateDeferredBackupReview(input: unknown, project: string, now: number) {
  const review = deferredBackupReview.parse(input);
  assert.equal(review.project, project, 'Backup project differs');
  assert.ok(Number.isFinite(now) && Date.parse(review.recovery.acceptedAt) <= now);
  assert.ok(path.isAbsolute(review.backupEvidenceFile));
  return review;
}

export function validateManagedBackupEvidence(input: unknown, project: string, now: number) {
  const proof = z
    .object({
      status: z.literal('MANAGED_BACKUP_METADATA_VERIFIED'),
      source: z.literal('AUTHENTICATED_SUPABASE_ADMIN_METADATA'),
      project: z.string(),
      observedAt: z.iso.datetime({ offset: true }),
      latestBackupStatus: z.literal('COMPLETED'),
      backup: z
        .object({
          id: z.string().min(1),
          type: z.literal('physical'),
          status: z.literal('COMPLETED'),
          createdAt: z.iso.datetime({ offset: true }),
        })
        .strict(),
      downloads: z.literal(0),
      restoreVerified: z.literal(false),
    })
    .strict()
    .parse(input);
  assert.equal(proof.project, project, 'Backup evidence project differs');
  for (const [date, maxAge] of [
    [proof.observedAt, MAX_BACKUP_METADATA_AGE_MS],
    [proof.backup.createdAt, MAX_MANAGED_BACKUP_AGE_MS],
  ] as const) {
    const age = now - Date.parse(date);
    assert.ok(Number.isFinite(age) && age >= 0 && age <= maxAge, 'Current healthy backup required');
  }
  assert.ok(Date.parse(proof.backup.createdAt) <= Date.parse(proof.observedAt));
  return proof;
}

export function validateBackupReview(input: unknown, project: string, now: number) {
  const proof = reviewedBackup.parse(input);
  assert.equal(proof.project, project, 'Backup project differs');
  const age = now - Date.parse(proof.backupCreatedAt);
  assert.ok(age >= 0 && age <= MAX_BACKUP_AGE_MS, 'Fresh reviewed backup required');
  assert.ok(path.isAbsolute(proof.backupFile) && path.isAbsolute(proof.restoreEvidenceFile));
  return proof;
}

export function buildAtomicReleaseSql(plan: ReleasePlan, bodies: string[]): string {
  assert.equal(plan.migrations.length, 160);
  assert.equal(bodies.length, 24);
  for (const [index, migration] of plan.migrations.entries()) {
    assert.equal(migration.idx, index);
    assert.match(migration.hash, /^[a-f0-9]{64}$/u);
    assert.ok(migration.acceptedHashes.every((value) => /^[a-f0-9]{64}$/u.test(value)));
    if (index) assert.ok(migration.when > plan.migrations[index - 1]!.when);
  }
  const expected = JSON.stringify(
    plan.migrations.slice(0, 136).map((item) => ({
      created_at: String(item.when),
      hashes: item.acceptedHashes,
    })),
  ).replaceAll("'", "''");
  const steps = plan.migrations.slice(136).map((item, index) => {
    const body = bodies[index]!.replaceAll('\r\n', '\n');
    assert.equal(createHash('sha256').update(body).digest('hex'), item.hash, 'SQL input changed');
    return `${body}\nINSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('${item.hash}',${item.when});`;
  });
  return `\\set ON_ERROR_STOP on
\\set VERBOSITY sqlstate
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='2s';
SET LOCAL idle_in_transaction_session_timeout='60s';
DO $gate_b_prefix$ BEGIN
  IF NOT pg_try_advisory_xact_lock(${MIGRATION_LOCK_KEY}) THEN RAISE EXCEPTION 'migration lock unavailable'; END IF;
  IF EXISTS (
    SELECT 1 FROM (SELECT row_number() OVER(ORDER BY id) position,id,hash,created_at::text created_at
      FROM drizzle.__drizzle_migrations) h
    FULL JOIN jsonb_array_elements('${expected}'::jsonb) WITH ORDINALITY e(value,position)
      ON h.position=e.position
    WHERE h.id IS NULL OR e.value IS NULL OR h.created_at<>e.value->>'created_at'
      OR NOT (e.value->'hashes' ? h.hash)
  ) THEN RAISE EXCEPTION 'migration prefix differs'; END IF;
END $gate_b_prefix$;
CREATE TEMP TABLE qoro_gate_b_legacy_snapshot(name text PRIMARY KEY,fingerprint text) ON COMMIT DROP;
DO $gate_b_before$ DECLARE name text; fingerprint text; BEGIN
  FOREACH name IN ARRAY ARRAY['subscriptions','plans','prices'] LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t)-''billing_provider'' ORDER BY id),''[]''::jsonb)::text) FROM public.%I t',name) INTO fingerprint;
    INSERT INTO qoro_gate_b_legacy_snapshot VALUES(name,fingerprint);
  END LOOP;
END $gate_b_before$;
${steps.join('\n')}
DO $gate_b_after$ DECLARE prior record; actual text; BEGIN
  FOR prior IN SELECT * FROM qoro_gate_b_legacy_snapshot LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t)-''billing_provider'' ORDER BY id),''[]''::jsonb)::text) FROM public.%I t',prior.name) INTO actual;
    IF actual IS DISTINCT FROM prior.fingerprint THEN RAISE EXCEPTION 'legacy fingerprint changed'; END IF;
  END LOOP;
END $gate_b_after$;
COMMIT;
\\echo ${COMMIT_MARKER}
`;
}

export function applyAtomicReleaseSql(env: NodeJS.ProcessEnv, sql: string, psql = 'psql'): void {
  assert.equal(env.PGSSLMODE, 'verify-full');
  assert.ok(env.PGSSLROOTCERT);
  const result = spawnSync(psql, ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    env,
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: APPLY_PROCESS_TIMEOUT_MS,
    maxBuffer: 2 << 20,
    windowsHide: true,
  });
  if (
    result.error ||
    result.signal ||
    result.status !== 0 ||
    result.stdout.trim().split(/\r?\n/u).at(-1) !== COMMIT_MARKER
  )
    throw new Error('Apply outcome requires read-only journal verification; details suppressed');
}

async function main(parent: NodeJS.ProcessEnv) {
  let stage = 'authorization';
  let attempted = false;
  let committed = false;
  const { values } = parseArgs({
    options: {
      'authorize-production-migrations': { type: 'boolean', default: false },
      'allow-windows-deferred-recovery': { type: 'boolean', default: false },
      approval: { type: 'string' },
      project: { type: 'string' },
      release: { type: 'string' },
      'backup-review': { type: 'string' },
      evidence: { type: 'string' },
    },
    strict: true,
  });
  assert.equal(
    values['authorize-production-migrations'],
    true,
    'Explicit B3 authorization required',
  );
  const approval = z
    .string()
    .regex(/^[a-zA-Z0-9_-]{8,120}$/u)
    .parse(values.approval);
  const project = z
    .string()
    .regex(/^[a-z]{20}$/u)
    .parse(values.project);
  const connection = approvedPreflightEnvironment(
    z.string().min(1).parse(parent.DATABASE_URL_PROD),
    project,
    parent,
  );
  assert.equal(connection.PGPORT, '5432', 'Session pooler required');
  const plan = await readFrozenRelease(
    path.join(path.resolve(z.string().min(1).parse(values.release)), 'drizzle/migrations'),
    FINANCIAL_REF,
  );
  const reviewFile = path.resolve(z.string().min(1).parse(values['backup-review']));
  const reviewStat = await lstat(reviewFile);
  assert.ok(reviewStat.isFile() && !reviewStat.isSymbolicLink() && reviewStat.size <= 64 << 10);
  if (process.platform === 'win32') {
    assert.equal(values['allow-windows-deferred-recovery'], true);
    assertPrivateOperationalPath(reviewFile, 'file', parent);
  }
  const reviewInput: unknown = JSON.parse(await readFile(reviewFile, 'utf8'));
  const decision = z.object({ decision: z.string() }).parse(reviewInput).decision;
  assertB3ExecutionPlatform(
    process.platform,
    decision,
    values['allow-windows-deferred-recovery'] === true,
    Boolean(parent.CI || parent.GITHUB_ACTIONS),
  );
  let backupIdentity: {
    backupSha256: string | null;
    backupId: string | null;
    backupReviewPerformedBy: string;
    recoveryStatus: string;
    riskDecisionReference?: string;
    riskAcceptedBy?: string;
    riskAcceptedAt?: string;
  };
  if (decision === 'APPROVED_FOR_B3_WITH_DEFERRED_RESTORE') {
    const review = validateDeferredBackupReview(reviewInput, project, Date.now());
    assertPrivateOperationalPath(review.backupEvidenceFile, 'file', parent);
    assert.ok((await lstat(review.backupEvidenceFile)).size <= 64 << 10);
    const metadata = await readFile(review.backupEvidenceFile);
    assert.equal(createHash('sha256').update(metadata).digest('hex'), review.backupEvidenceSha256);
    const managed = validateManagedBackupEvidence(
      JSON.parse(metadata.toString('utf8')),
      project,
      Date.now(),
    );
    backupIdentity = {
      backupSha256: null, // Metadata is not a downloaded or verified backup checksum.
      backupId: managed.backup.id,
      backupReviewPerformedBy: review.reviewedBy,
      recoveryStatus: review.recovery.status,
      riskDecisionReference: review.recovery.decisionReference,
      riskAcceptedBy: review.recovery.acceptedBy,
      riskAcceptedAt: review.recovery.acceptedAt,
    };
  } else {
    const proof = validateBackupReview(reviewInput, project, Date.now());
    const restore = z
      .object({
        status: z.literal('LOCAL_RESTORE_COMPLETE_REQUIRES_MANIFEST_REVIEW'),
        backupSha256: checksum,
        sourceRef: z.literal(FINANCIAL_REF),
        exitCodes: z.object({ gpg: z.literal(0), psql: z.literal(0) }),
        history: z.object({ applied: z.literal(136), pending: z.array(z.unknown()).length(24) }),
        integrity: z.object({ invalidIndexes: z.literal(0), unvalidatedConstraints: z.literal(0) }),
      })
      .parse(JSON.parse(await readFile(proof.restoreEvidenceFile, 'utf8')));
    assert.equal(restore.backupSha256, proof.backupSha256);
    const file = await lstat(proof.backupFile);
    assert.ok(
      file.isFile() && !file.isSymbolicLink() && (file.mode & 0o077) === 0,
      'Private encrypted copy required',
    );
    const digest = createHash('sha256');
    for await (const bytes of createReadStream(proof.backupFile)) {
      assert.ok(Buffer.isBuffer(bytes));
      digest.update(bytes);
    }
    assert.equal(digest.digest('hex'), proof.backupSha256);
    backupIdentity = {
      backupSha256: proof.backupSha256,
      backupId: null,
      backupReviewPerformedBy: proof.reviewedBy,
      recoveryStatus: 'RESTORE_EVIDENCE_REVIEWED',
    };
  }
  const evidencePath = path.resolve(z.string().min(1).parse(values.evidence));
  if (process.platform === 'win32') {
    assertPrivateOperationalPath(path.dirname(evidencePath), 'directory', parent);
  }
  const evidence = await open(evidencePath, 'wx', 0o600); // Existing/partial attempts block replay.
  const startedAt = new Date().toISOString();
  try {
    stage = 'read_only_before';
    const snapshot = readPreflightCatalog(connection);
    const rows = z.object({ history: z.array(z.unknown()) }).parse(snapshot).history;
    if (rows.length === 160) {
      assertReleaseCatalog(plan, snapshot, 'after');
      stage = 'already_applied';
    } else {
      assertReleaseCatalog(plan, snapshot, 'before');
      const bodies = await Promise.all(
        plan.migrations
          .slice(136)
          .map((item) => readFile(path.join(plan.folder, item.tag + '.sql'), 'utf8')),
      );
      const sql = buildAtomicReleaseSql(plan, bodies);
      stage = 'apply';
      attempted = true;
      applyAtomicReleaseSql(connection, sql);
      committed = true;
      stage = 'read_only_after';
      assertReleaseCatalog(plan, readPreflightCatalog(connection), 'after');
      stage = 'applied_and_checked';
    }
  } finally {
    const result = {
      status:
        stage === 'already_applied' || stage === 'applied_and_checked'
          ? 'PASS'
          : 'STOP_REQUIRES_READBACK',
      stage,
      approval,
      financial: FINANCIAL_REF,
      executionPlatform: process.platform,
      allowWindowsDeferredRecovery: values['allow-windows-deferred-recovery'],
      startedAt,
      finishedAt: new Date().toISOString(),
      ...backupIdentity,
      applyAttempted: attempted,
      commitAcknowledged: committed,
      productionWritesPossible: attempted,
      automaticRollbackClaimed: false,
      automaticRetryAllowed: false,
      nextGateAuthorized: false,
    };
    await evidence.writeFile(JSON.stringify(result, null, 2) + '\n');
    await evidence.close();
    console.log(JSON.stringify(result));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.env).catch(() => {
    console.error(
      JSON.stringify({
        status: 'BLOCKED_B3',
        detailsSuppressed: true,
        action:
          'Stop; inspect protected evidence and current journal; no automatic retry, DOWN or financial replay',
      }),
    );
    process.exitCode = 1;
  });
}
