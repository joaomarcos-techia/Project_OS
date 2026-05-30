import { randomUUID } from 'node:crypto';

import type { RequestContext } from './types';

/**
 * Build a RequestContext from incoming Headers.
 *
 * - IP: prefer `x-forwarded-for` (proxy chain), fall back to `x-real-ip`.
 *   We take the FIRST address in the XFF chain — that is the original client
 *   per RFC 7239. Vercel injects these; trust them server-side.
 * - User-Agent: as reported. Capped on insert by audit_events column type.
 * - Request ID: prefer the `x-request-id` set upstream (middleware can stamp
 *   it; some Vercel deployments inject `x-vercel-id`). Fallback: generate
 *   a UUID v4 here so EVERY audit row has a non-null request_id.
 */
export function buildRequestContext(headers: Headers): RequestContext {
  const xff = headers.get('x-forwarded-for');
  const firstFromXff = xff ? xff.split(',')[0]?.trim() || null : null;
  const ip = firstFromXff ?? headers.get('x-real-ip') ?? null;

  return {
    ip,
    userAgent: headers.get('user-agent') ?? null,
    requestId:
      headers.get('x-request-id') ??
      headers.get('x-vercel-id') ??
      randomUUID(),
  };
}
