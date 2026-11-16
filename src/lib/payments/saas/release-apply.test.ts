import { createHash } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ spawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mocks.spawnSync, execFileSync: vi.fn() }));
import {
  applyAtomicReleaseSql,
  buildAtomicReleaseSql,
  validateBackupReview,
  validateDeferredBackupReview,
  validateManagedBackupEvidence,
} from '../../../../scripts/abacatepay-release-apply';
import type { ReleasePlan } from '../../../../scripts/abacatepay-release-validation';
const bodies = Array.from(
  { length: 24 },
  (_, n) => `CREATE TABLE public.synthetic_${n}(id integer);`,
);
const plan: ReleasePlan = {
  financial: 'a'.repeat(40),
  folder: 'synthetic-only',
  migrations: Array.from({ length: 160 }, (_, idx) => {
    const hash =
      idx < 136
        ? 'a'.repeat(64)
        : createHash('sha256')
            .update(bodies[idx - 136]!)
            .digest('hex');
    return {
      idx,
      tag: String(idx).padStart(4, '0') + '_synthetic',
      when: 1000 + idx,
      hash,
      acceptedHashes: [hash],
    };
  }),
};
afterEach(() => vi.clearAllMocks());
describe('future B3 operator, not authorization to execute', () => {
  it('uses a single bounded transaction and lock, exact prefix, ordered SQL/journal and legacy fingerprints', () => {
    const sql = buildAtomicReleaseSql(plan, bodies);
    expect(sql).toContain('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE');
    expect(sql).toContain('pg_try_advisory_xact_lock(4242)');
    expect(sql).toContain("SET LOCAL statement_timeout='60s'");
    expect(sql).toContain("SET LOCAL lock_timeout='2s'");
    expect(sql).toContain('migration prefix differs');
    expect(sql.match(/INSERT INTO drizzle\.__drizzle_migrations/gu)).toHaveLength(24);
    expect(sql).toContain('legacy fingerprint changed');
    expect(sql.indexOf(bodies[0]!)).toBeLessThan(sql.indexOf(bodies[23]!));
    expect(sql.indexOf('COMMIT;')).toBeGreaterThan(sql.indexOf(bodies[23]!));
    expect(sql).not.toContain('0160_');
    expect(sql).not.toContain('0161_');
    expect(sql).not.toContain('0162_');
  });
  it('refuses changed SQL or a different history, not just a matching count', () => {
    expect(() => buildAtomicReleaseSql(plan, ['SELECT 1;', ...bodies.slice(1)])).toThrow();
    expect(() => buildAtomicReleaseSql(plan, bodies.slice(1))).toThrow();
    const wrong = structuredClone(plan);
    wrong.migrations[150]!.idx = 151;
    expect(() => buildAtomicReleaseSql(wrong, bodies)).toThrow();
  });
  const now = Date.parse('2026-11-15T12:00:00Z');
  const review = {
    decision: 'APPROVED_FOR_B3',
    project: 'abcdefghijklmnopqrst',
    backupCreatedAt: '2026-11-15T11:00:00Z',
    backupFile: path.resolve('synthetic.gpg'),
    backupSha256: 'a'.repeat(64),
    restoreEvidenceFile: path.resolve('synthetic-restore.json'),
    reviewedBy: 'synthetic-operator',
  };
  it('requires an explicit reviewed backup for the same project and recent snapshot', () => {
    expect(validateBackupReview(review, review.project, now).backupSha256).toBe(
      review.backupSha256,
    );
    expect(() => validateBackupReview(review, 'z'.repeat(20), now)).toThrow();
    expect(() =>
      validateBackupReview({ ...review, decision: 'PENDING' }, review.project, now),
    ).toThrow();
    expect(() =>
      validateBackupReview(
        { ...review, backupCreatedAt: '2026-11-14T01:00:00Z' },
        review.project,
        now,
      ),
    ).toThrow();
    expect(() =>
      validateBackupReview(
        { ...review, backupCreatedAt: '2026-11-15T13:00:00Z' },
        review.project,
        now,
      ),
    ).toThrow();
  });
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: '/synthetic/ca.pem',
    PGPASSWORD: 'never-in-argv',
  };
  it('requires an explicit risk decision and separate current managed-backup evidence when restore is deferred', () => {
    const deferred = {
      decision: 'APPROVED_FOR_B3_WITH_DEFERRED_RESTORE',
      project: review.project,
      reviewedBy: 'synthetic-operator',
      backupEvidenceFile: path.resolve('metadata.json'),
      backupEvidenceSha256: 'b'.repeat(64),
      recovery: {
        status: 'DEFERRED_RISK_ACCEPTED_NOT_VERIFIED',
        acceptedBy: 'synthetic-owner',
        acceptedAt: '2026-11-15T10:00:00Z',
        decisionReference: 'synthetic-decision-001',
      },
    };
    expect(validateDeferredBackupReview(deferred, review.project, now).recovery.status).toBe(
      'DEFERRED_RISK_ACCEPTED_NOT_VERIFIED',
    );
    expect(() => validateBackupReview(deferred, review.project, now)).toThrow();
    expect(() =>
      validateDeferredBackupReview(
        { ...deferred, recovery: { ...deferred.recovery, status: 'PASS' } },
        review.project,
        now,
      ),
    ).toThrow();
    expect(() => validateDeferredBackupReview(deferred, 'z'.repeat(20), now)).toThrow();
    expect(() =>
      validateDeferredBackupReview(
        { ...deferred, recovery: { ...deferred.recovery, acceptedAt: '2026-11-16T10:00:00Z' } },
        review.project,
        now,
      ),
    ).toThrow();
    const evidence = {
      status: 'MANAGED_BACKUP_METADATA_VERIFIED',
      source: 'AUTHENTICATED_SUPABASE_ADMIN_METADATA',
      project: review.project,
      observedAt: '2026-11-15T11:50:00Z',
      latestBackupStatus: 'COMPLETED',
      backup: {
        id: 'synthetic-backup-1',
        type: 'physical',
        status: 'COMPLETED',
        createdAt: '2026-11-14T12:00:00Z',
      },
      downloads: 0,
      restoreVerified: false,
    };
    expect(validateManagedBackupEvidence(evidence, review.project, now).restoreVerified).toBe(
      false,
    );
    for (const changed of [
      { ...evidence, project: 'z'.repeat(20) },
      { ...evidence, observedAt: '2026-11-15T11:00:00Z' },
      { ...evidence, observedAt: '2026-11-15T13:00:00Z' },
      { ...evidence, latestBackupStatus: 'FAILED' },
      { ...evidence, backup: { ...evidence.backup, status: 'FAILED' } },
      { ...evidence, backup: { ...evidence.backup, createdAt: '2026-11-14T09:00:00Z' } },
      { ...evidence, restoreVerified: true },
    ])
      expect(() => validateManagedBackupEvidence(changed, review.project, now)).toThrow();
  });
  it('requires zero exit and the final commit acknowledgement, without logging SQL or credentials', () => {
    mocks.spawnSync.mockReturnValue({
      status: 0,
      signal: null,
      stdout: 'QORO_GATE_B_APPLIED_160\n',
    });
    expect(() => applyAtomicReleaseSql(env, 'synthetic SQL')).not.toThrow();
    const [, args, options] = mocks.spawnSync.mock.calls[0]!;
    expect(JSON.stringify(args)).not.toContain('never-in-argv');
    expect(options).toMatchObject({ env, input: 'synthetic SQL', timeout: 900000 });
    expect(() =>
      applyAtomicReleaseSql({ ...env, PGSSLMODE: 'require' }, 'synthetic SQL'),
    ).toThrow();
  });
  it.each([
    { status: 3, signal: null, stdout: 'must-not-leak' },
    { status: null, signal: 'SIGTERM', stdout: '' },
    { status: 0, signal: null, stdout: 'incomplete' },
  ])('does not turn a partial or ambiguous attempt into success or automatic retry', (result) => {
    mocks.spawnSync.mockReturnValue(result);
    expect(() => applyAtomicReleaseSql(env, 'synthetic SQL')).toThrow(
      /read-only journal verification/u,
    );
  });
});
