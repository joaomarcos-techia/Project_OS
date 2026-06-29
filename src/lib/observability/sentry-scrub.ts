import type { ErrorEvent } from '@sentry/nextjs';

import { sanitizePayload } from '@/lib/sanitize/redact';

/**
 * `beforeSend` scrubber shared by the Sentry client/server/edge configs.
 *
 * Reuses the same `sanitizePayload` discipline as the logger/metrics (Bearer/JWT/
 * sk_/DSN + SENSITIVE_KEYS) so an event never carries a credential or clinical
 * payload to Sentry. Combined with `sendDefaultPii: false`, this drops request
 * cookies/headers entirely and redacts request body / extra / contexts.
 *
 * Pure (no Node APIs) → safe in the edge and browser runtimes.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    if (event.request.data !== undefined) {
      event.request.data = sanitizePayload(event.request.data);
    }
  }
  if (event.extra) {
    event.extra = sanitizePayload(event.extra) as Record<string, unknown>;
  }
  if (event.contexts) {
    event.contexts = sanitizePayload(event.contexts) as typeof event.contexts;
  }
  return event;
}
