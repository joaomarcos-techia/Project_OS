import { redactStringValue } from '@/lib/sanitize/patterns';
import { sanitizePayload } from '@/lib/sanitize/redact';

export type Fields = Record<string, unknown>;

/**
 * Field-level sanitization shared by `metrics.emit` and the structured logger.
 *
 * - `Error` values → `{ name, message }` with the message value-redacted and the
 *   stack dropped (stacks can pull in request bodies / SQL / forensic noise).
 * - Everything else → `sanitizePayload` (key + value redaction: Bearer/JWT/sk_/DSN).
 *
 * SECOND line of PII defense after the caller's own discipline. Keep it cheap —
 * it runs on every metric/log emission, some from hot loops.
 */
export function sanitizeFields(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof Error) {
      out[k] = {
        name: v.name,
        message: redactStringValue(v.message || String(v)),
      };
    } else {
      out[k] = sanitizePayload(v);
    }
  }
  return out;
}
