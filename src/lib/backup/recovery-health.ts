export type RecoveryCopy = {
  kind: 'database' | 'storage' | 'auth';
  completedAt: string;
  sha256: string;
  bytes: number;
  verified: boolean;
  independentCopyVerifiedAt: string | null;
  keyEscrowVerifiedAt: string | null;
  restoreVerifiedAt: string | null;
};
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const RECOVERY_POLICY = Object.freeze({
  staleAfterMs: 26 * HOUR_MS,
  drillAfterMs: 30 * DAY_MS,
  escrowReviewAfterMs: 90 * DAY_MS,
  retainedDailyCopies: 7,
  retainedWeeklyCopies: 4,
});
function recent(value: string | null, now: number, limit: number): boolean {
  if (value === null) return false;
  const age = now - Date.parse(value);
  return Number.isFinite(age) && age >= 0 && age <= limit;
}
/** Não basta existir arquivo: exige integridade, cópia independente, chave e drill. */
export function evaluateRecoveryHealth(
  copies: readonly RecoveryCopy[],
  now: number,
): { status: 'PASS' | 'FAIL'; alerts: string[] } {
  if (!Number.isFinite(now)) throw new Error('Invalid recovery clock');
  const alerts: string[] = [];
  for (const kind of ['database', 'storage', 'auth'] as const) {
    const copy = copies
      .filter((entry) => entry.kind === kind)
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))[0];
    if (!copy) {
      alerts.push(`${kind}:missing`);
      continue;
    }
    if (!recent(copy.completedAt, now, RECOVERY_POLICY.staleAfterMs))
      alerts.push(`${kind}:stale-or-invalid-clock`);
    if (
      !copy.verified ||
      !/^[a-f0-9]{64}$/u.test(copy.sha256) ||
      !Number.isSafeInteger(copy.bytes) ||
      copy.bytes <= 0
    )
      alerts.push(`${kind}:integrity-unproven`);
    if (!recent(copy.independentCopyVerifiedAt, now, RECOVERY_POLICY.staleAfterMs))
      alerts.push(`${kind}:independent-copy-unproven`);
    if (!recent(copy.keyEscrowVerifiedAt, now, RECOVERY_POLICY.escrowReviewAfterMs))
      alerts.push(`${kind}:key-escrow-unproven`);
    if (!recent(copy.restoreVerifiedAt, now, RECOVERY_POLICY.drillAfterMs))
      alerts.push(`${kind}:restore-unproven-or-overdue`);
  }
  return { status: alerts.length ? 'FAIL' : 'PASS', alerts };
}

export function parseRecoveryCopies(input: unknown): RecoveryCopy[] {
  if (!Array.isArray(input) || input.length > 10000) throw new Error('Invalid recovery inventory');
  return input.map((row: unknown) => {
    if (
      !row ||
      typeof row !== 'object' ||
      !('kind' in row) ||
      !['database', 'storage', 'auth'].includes(String(row.kind)) ||
      !('completedAt' in row) ||
      typeof row.completedAt !== 'string' ||
      !('sha256' in row) ||
      typeof row.sha256 !== 'string' ||
      !('bytes' in row) ||
      typeof row.bytes !== 'number' ||
      !('verified' in row) ||
      typeof row.verified !== 'boolean'
    )
      throw new Error('Invalid recovery inventory entry');
    const validatedRow = row;
    function timestamp(name: string): string | null {
      const value: unknown = Reflect.get(validatedRow, name);
      if (value === null || typeof value === 'string') return value;
      throw new Error('Invalid recovery attestation');
    }
    return {
      kind: row.kind === 'database' ? 'database' : row.kind === 'storage' ? 'storage' : 'auth',
      completedAt: row.completedAt,
      sha256: row.sha256,
      bytes: row.bytes,
      verified: row.verified,
      independentCopyVerifiedAt: timestamp('independentCopyVerifiedAt'),
      keyEscrowVerifiedAt: timestamp('keyEscrowVerifiedAt'),
      restoreVerifiedAt: timestamp('restoreVerifiedAt'),
    };
  });
}
