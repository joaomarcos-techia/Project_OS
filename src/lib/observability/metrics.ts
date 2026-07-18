import { contextFields } from './context';
import { sanitizeFields } from './sanitize-fields';

/**
 * Structured metrics emission. MVP target is "JSON line on stdout" — Vercel
 * captures it, log forwarders (Better Stack/Datadog) ingest, ad-hoc filtering
 * works via grep. A real metrics SDK can layer on in C16 without changing the
 * call sites.
 *
 * Every field is run through `sanitizeFields` (shared with the structured
 * logger) before serialization. This is the SECOND line of PII defense (after
 * the caller's own discipline): if a Bearer token sneaks into a metric field,
 * it's redacted before reaching any external log pipeline.
 *
 * Keep emit() synchronous and allocation-cheap — it's called from hot loops
 * (worker tick, every audit insert).
 */
type Metric = Record<string, unknown>;

export const metrics = {
  emit(event: string, fields: Metric = {}): void {
    // Correlação ambiente ANTES dos campos: o call-site explícito sempre vence
    // (A2/A3). Sem escopo, `contextFields()` é `{}` e a linha sai idêntica à de
    // hoje — a correlação é ADITIVA, nunca substitutiva.
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      kind: 'metric',
      event,
      ...sanitizeFields({ ...contextFields(), ...fields }),
    });
    process.stdout.write(line + '\n');
  },
};
