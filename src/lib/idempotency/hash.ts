import { createHash } from 'node:crypto';

import { canonicalize } from './canonicalize';

/**
 * SHA-256 hex of the canonical form of `payload`.
 *
 * Identity contract for idempotency:
 *   - Same payload (modulo key ordering and NFC normalization) → same hash.
 *   - Different payload → different hash with overwhelming probability.
 *
 * SHA-256 is cryptographically overkill for the threat model (no adversary
 * is crafting collisions to bypass our idempotency), but it is the same hash
 * we use elsewhere and produces a stable 64-char string fit for inclusion
 * in primary keys.
 */
export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalize(payload)).digest('hex');
}
