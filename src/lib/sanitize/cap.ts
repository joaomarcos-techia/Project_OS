import { createHash } from 'node:crypto';

const DEFAULT_MAX_BYTES = 64 * 1024;

/**
 * Bound the JSON-serialized size of an idempotency cache entry.
 *
 * Returned shape:
 *   - within budget → original value untouched.
 *   - over budget → `{ truncated: true, originalBytes, originalHash, note }`
 *     so the caller has enough metadata to confirm the response identity
 *     without storing the body. Caller is expected to re-fetch by ID.
 *
 * The PG-side CHECK constraint `pg_column_size(response) <= 98304` is a
 * defense-in-depth catch — this TS cap is the contract.
 */
export function capJsonSize(value: unknown, maxBytes = DEFAULT_MAX_BYTES): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    // JSON.stringify returns undefined for non-serializable roots (function/symbol).
    // We treat that as a programmer error — caller passed something un-cacheable.
    throw new Error('[sanitize.capJsonSize] value is not JSON-serializable');
  }
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes <= maxBytes) return value;
  return {
    truncated: true,
    originalBytes: bytes,
    originalHash: createHash('sha256').update(serialized).digest('hex'),
    note: `Response exceeded ${maxBytes}B; caller must re-fetch by ID.`,
  };
}
