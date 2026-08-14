import { SENSITIVE_KEYS } from './keys';
import { redactStringValue } from './patterns';

/**
 * Recursive key + value level redaction for forensic / log payloads.
 *
 * - Keys matching SENSITIVE_KEYS (case-insensitive) → value replaced with `[REDACTED]`.
 * - Strings traversed → value-level regex patterns applied (Bearer/JWT/sk_/DSN).
 * - Depth cap 16 — defensive against accidental cycles. A cycle would have
 *   already failed JSON serialization, but logs sometimes carry Error objects
 *   with `.cause` chains; capping is cheap insurance.
 *
 * IMPORTANT: this function does NOT validate input is JSON-safe — that is
 * `assertJsonSafe()` in `src/lib/idempotency/json-safe.ts`. Callers in audit
 * paths should typically have validated upstream (Zod schemas). In observability
 * paths the value is whatever the caller passed and we accept best-effort.
 */
export function sanitizePayload(value: unknown, depth = 0): unknown {
  if (depth > 16) return '[TOO_DEEP]';
  if (value === null) return null;
  if (typeof value === 'string') return redactStringValue(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => sanitizePayload(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // React Server Actions serializa campos de FormData como `_1_cardNumber`.
    // Mantenha a regra central de redação mesmo com esse prefixo interno.
    const normalizedKey = k.toLowerCase().replace(/^_\d+_/, '');
    if (SENSITIVE_KEYS.has(normalizedKey)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = sanitizePayload(v, depth + 1);
    }
  }
  return out;
}

/**
 * Keeps an opaque identifier useful for correlating an operational check
 * without writing the complete provider or database identifier to a log.
 */
export function redactOpaqueId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return '[REDACTED]';
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}
