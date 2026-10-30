import { RECOVERY_POLICY } from './recovery-health';
import { RECOVERY_PACKAGE_LIMITS } from './recovery-package';

const ENTRY_METADATA_ALLOWANCE = 1024; // ID <=128, hash, JSON e margem; sem conteúdo real.
const ENVELOPE_ALLOWANCE = 1024;
const PRE_ROLLOUT_COPIES = 1;
const CAPACITY_HEADROOM_PERCENT = 20;

export type RecoverySizes = {
  databaseBytes: number;
  storageEntryBytes: readonly number[];
  authUpperBoundBytes: number;
  storageKeyUpperBoundBytes: number;
};

function integer(value: number, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error('Invalid capacity input');
}

/** Planeja bytes, nunca atesta upload, custódia, integridade ou recuperação. */
export function planRecoveryCapacity(
  sizes: RecoverySizes,
  options: { freeBytes: number; lockDays: number; growthFactor: number },
) {
  integer(sizes.databaseBytes, 1);
  integer(sizes.authUpperBoundBytes, 1);
  integer(sizes.storageKeyUpperBoundBytes, 1);
  integer(options.freeBytes, 1);
  integer(options.lockDays, 0);
  integer(options.growthFactor, 1);
  if (!Array.isArray(sizes.storageEntryBytes) || !sizes.storageEntryBytes.length)
    throw new Error('Storage metadata missing');
  const entries = [
    ...sizes.storageEntryBytes.map((bytes) => {
      integer(bytes, 0);
      const scaled = bytes * options.growthFactor;
      integer(scaled, 0);
      return scaled;
    }),
    sizes.authUpperBoundBytes,
    sizes.storageKeyUpperBoundBytes,
  ];
  const clearBytes = entries.reduce((total, bytes) => total + bytes, 0);
  integer(clearBytes, 1);
  const portableUpperBoundBytes =
    entries.reduce((total, bytes) => total + 4 * Math.ceil(bytes / 3), 0) +
    entries.length * ENTRY_METADATA_ALLOWANCE +
    ENVELOPE_ALLOWANCE;
  integer(portableUpperBoundBytes, 1);
  const setUpperBoundBytes = sizes.databaseBytes * options.growthFactor + portableUpperBoundBytes;
  integer(setUpperBoundBytes, 1);
  // Uma execução diária; lock pode manter mais cópias que a política lógica.
  // +1 cobre a fronteira do vencimento. Sem desconto por sobreposição semanal.
  const retainedSets =
    Math.max(RECOVERY_POLICY.retainedDailyCopies, options.lockDays + 1) +
    RECOVERY_POLICY.retainedWeeklyCopies +
    PRE_ROLLOUT_COPIES;
  const retainedUpperBoundBytes = setUpperBoundBytes * retainedSets;
  integer(retainedUpperBoundBytes, 1);
  const reservedBytes = Math.ceil(retainedUpperBoundBytes * (1 + CAPACITY_HEADROOM_PERCENT / 100));
  integer(reservedBytes, 1);
  return {
    growthFactor: options.growthFactor,
    clearBytes,
    portableUpperBoundBytes,
    setUpperBoundBytes,
    retainedSets,
    reservedBytes,
    freeBytes: options.freeBytes,
    portableFormatFits:
      clearBytes <= RECOVERY_PACKAGE_LIMITS.clearBytes &&
      entries.length <= RECOVERY_PACKAGE_LIMITS.entries,
    freeAllowanceFits: reservedBytes <= options.freeBytes,
    note: 'Capacity estimate only; no upload, escrow or restore attestation',
  };
}

export function estimateTransferSeconds(bytes: number, megabitsPerSecond: number): number {
  integer(bytes, 0);
  if (!Number.isFinite(megabitsPerSecond) || megabitsPerSecond <= 0)
    throw new Error('Invalid bandwidth');
  const seconds = (bytes * 8) / (megabitsPerSecond * 1_000_000);
  if (!Number.isFinite(seconds)) throw new Error('Invalid transfer estimate');
  return Math.ceil(seconds);
}
