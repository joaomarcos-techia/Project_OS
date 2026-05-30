/**
 * Backoff schedule for failed outbox events.
 *
 * Frozen (PlanoAção §C4 + ADR-011):
 *   Tentativa 1 → imediato (0ms)
 *   Tentativa 2 → +30s
 *   Tentativa 3 → +5min
 *   Tentativa 4 → +30min
 *   Tentativa 5 → +6h
 *   Tentativa 6 → marca `failed` (sem mais retries; replay manual via SQL).
 *
 * The schedule is intentionally short on the head (catches transient network
 * blips fast) and stretches at the tail (gives a deploy fix window without
 * burning thousands of attempts).
 */
export const BACKOFF_FAIL = Symbol('outbox.backoff.fail');

const DELAYS_MS: ReadonlyArray<number> = [
  0,
  30 * 1000,
  5 * 60 * 1000,
  30 * 60 * 1000,
  6 * 60 * 60 * 1000,
];

export const MAX_ATTEMPTS = DELAYS_MS.length;

/**
 * Given `nextAttempt` (1-indexed: the attempt number ABOUT to run), returns
 * the delay before that attempt fires, or BACKOFF_FAIL if the cap is reached.
 *
 * Example: handler just failed on its 3rd attempt → caller passes 4 → returns
 * 30min (delay before the 4th attempt). Caller passes 6 → returns BACKOFF_FAIL.
 */
export function backoffDelayMs(nextAttempt: number): number | typeof BACKOFF_FAIL {
  if (!Number.isInteger(nextAttempt) || nextAttempt <= 0) {
    throw new Error(`backoffDelayMs: nextAttempt must be a positive integer, got ${nextAttempt}`);
  }
  if (nextAttempt > MAX_ATTEMPTS) return BACKOFF_FAIL;
  return DELAYS_MS[nextAttempt - 1] ?? BACKOFF_FAIL;
}
