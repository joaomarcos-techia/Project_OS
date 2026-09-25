import 'server-only';

const ORPHAN_RECOVERY_EPOCH_KEY = 'qoro_password_recovery_epoch';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Marker administrativo que torna o consumo determinístico mesmo no mesmo ms. */
export function isOrphanRecoveryEpochConsumed(metadata: unknown, epoch: number): boolean {
  return isRecord(metadata) && metadata[ORPHAN_RECOVERY_EPOCH_KEY] === epoch;
}

export function markOrphanRecoveryEpochConsumed(
  metadata: Record<string, unknown>,
  epoch: number,
): Record<string, unknown> {
  return { ...metadata, [ORPHAN_RECOVERY_EPOCH_KEY]: epoch };
}
