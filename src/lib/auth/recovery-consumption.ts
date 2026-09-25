import 'server-only';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

const ORPHAN_RECOVERY_EPOCH_KEY = 'qoro_password_recovery_epoch';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Serializa a única escrita Auth de um recovery sem profile/draft.
 *
 * O lock é transacional e compartilhado por todas as instâncias. A transação
 * deliberadamente cobre a releitura e uma única chamada à Admin API: sem uma
 * linha autoritativa para CAS, soltar o lock antes desse I/O reabriria a corrida.
 */
export async function withOrphanRecoveryLock<T>(
  userId: string,
  work: () => Promise<T>,
): Promise<T> {
  return dbAdmin.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`qoro:password-recovery:${userId}`}, 0))`,
    );
    return work();
  });
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
