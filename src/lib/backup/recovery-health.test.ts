import { describe, expect, it } from 'vitest';
import {
  evaluateRecoveryHealth,
  parseRecoveryCopies,
  RECOVERY_POLICY,
  type RecoveryCopy,
} from './recovery-health';
const now = Date.parse('2026-10-29T12:00:00Z');
const date = new Date(now - 3600000).toISOString();
function copies(): RecoveryCopy[] {
  return ['database', 'storage', 'auth'].map((kind) => ({
    kind: kind === 'database' ? 'database' : kind === 'storage' ? 'storage' : 'auth',
    completedAt: date,
    sha256: 'a'.repeat(64),
    bytes: 32,
    verified: true,
    independentCopyVerifiedAt: date,
    keyEscrowVerifiedAt: date,
    restoreVerifiedAt: date,
  }));
}
describe('recovery operational health', () => {
  it('accepts only fresh verified copies with independent keys and a recent drill', () => {
    expect(evaluateRecoveryHealth(parseRecoveryCopies(copies()), now)).toEqual({
      status: 'PASS',
      alerts: [],
    });
  });
  it('does not treat local file existence as recoverability', () => {
    const entries = copies();
    entries[0]!.independentCopyVerifiedAt = null;
    entries[1]!.keyEscrowVerifiedAt = null;
    entries[2]!.restoreVerifiedAt = null;
    expect(evaluateRecoveryHealth(entries, now)).toEqual({
      status: 'FAIL',
      alerts: [
        'database:independent-copy-unproven',
        'storage:key-escrow-unproven',
        'auth:restore-unproven-or-overdue',
      ],
    });
  });
  it('alerts missing, partial, corrupted, stale and future-dated results', () => {
    expect(evaluateRecoveryHealth([], now).alerts).toHaveLength(3);
    const entries = copies();
    entries[0]!.verified = false;
    entries[0]!.sha256 = 'bad';
    entries[1]!.completedAt = new Date(now - RECOVERY_POLICY.staleAfterMs - 1).toISOString();
    entries[2]!.completedAt = new Date(now + 1).toISOString();
    expect(evaluateRecoveryHealth(entries, now)).toEqual({
      status: 'FAIL',
      alerts: [
        'database:integrity-unproven',
        'storage:stale-or-invalid-clock',
        'auth:stale-or-invalid-clock',
      ],
    });
  });
  it('rejects malformed external state and does not accept invalid timestamps', () => {
    for (const value of [
      null,
      {},
      [{ kind: 'other' }],
      [{ ...copies()[0], keyEscrowVerifiedAt: 1 }],
    ])
      expect(() => parseRecoveryCopies(value)).toThrow();
    const entries = copies();
    entries[0]!.completedAt = 'invalid';
    expect(evaluateRecoveryHealth(entries, now).status).toBe('FAIL');
  });
});
