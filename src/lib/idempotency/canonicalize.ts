import stringify from 'safe-stable-stringify';

import { assertJsonSafe } from './json-safe';

/**
 * Canonicalize a JSON-safe value to a stable string for hashing.
 *
 * Why a wrapper around safe-stable-stringify:
 *   - safe-stable-stringify sorts object keys (deterministic) and handles
 *     cycles, but it does NOT validate JSON-safety (BigInt/Date/NaN would
 *     pass through with mangled semantics) and does NOT NFC-normalize strings.
 *   - For idempotency hashing, "same payload" must mean the same byte sequence
 *     across HTTP requests, V8 versions, and JSON.stringify quirks of the
 *     caller's runtime. NFC normalization on every string covers the case
 *     where a user types "café" with U+00E9 vs "café" with U+0065 + U+0301
 *     — visually identical, semantically equal, but different bytes.
 *
 * Performance: safe-stable-stringify is pure JS, ~5 µs for typical payloads.
 * NFC normalize iterates every string field — also cheap at this scale.
 */
export function canonicalize(value: unknown): string {
  assertJsonSafe(value);
  const normalized = normalizeUnicode(value);
  const out = stringify(normalized);
  if (out === undefined) {
    // safe-stable-stringify returns undefined only for non-stringifiable roots
    // (e.g. a top-level Symbol). assertJsonSafe should have caught these — if
    // we land here it is a programmer error in this module.
    throw new Error('[canonicalize] safe-stable-stringify returned undefined');
  }
  return out;
}

function normalizeUnicode(value: unknown): unknown {
  if (typeof value === 'string') return value.normalize('NFC');
  if (Array.isArray(value)) return value.map(normalizeUnicode);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Keys also normalized — a caller using composed vs decomposed unicode
      // in keys would otherwise produce different canonical forms.
      out[k.normalize('NFC')] = normalizeUnicode(v);
    }
    return out;
  }
  return value;
}
