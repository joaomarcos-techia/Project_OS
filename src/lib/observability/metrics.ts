import { redactStringValue } from '@/lib/sanitize/patterns';
import { sanitizePayload } from '@/lib/sanitize/redact';

/**
 * Structured metrics emission. MVP target is "JSON line on stdout" — Vercel
 * captures it, log forwarders (Datadog/Honeycomb) ingest, ad-hoc filtering
 * works via grep. Replaced with a real metrics SDK in C16 without changing
 * the call sites.
 *
 * Every field is run through sanitizePayload before serialization. This is
 * the SECOND line of PII defense (after the caller's own discipline): if a
 * Bearer token sneaks into a metric field, it's redacted before reaching
 * any external log pipeline.
 *
 * Keep emit() synchronous and allocation-cheap — it's called from hot loops
 * (worker tick, every audit insert).
 */
type Metric = Record<string, unknown>;

export const metrics = {
  emit(event: string, fields: Metric = {}): void {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      kind: 'metric',
      event,
      ...sanitizeFields(fields),
    });
    process.stdout.write(line + '\n');
  },
};

function sanitizeFields(fields: Metric): Metric {
  const out: Metric = {};
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
