import { randomUUID } from 'node:crypto';

import type { RequestContext } from './types';

/**
 * Build a RequestContext from incoming Headers.
 *
 * - IP: prefer `x-real-ip` — on Vercel the platform sets it to the real client
 *   IP and the client cannot spoof it. Fall back to the leftmost `x-forwarded-for`
 *   ONLY for environments without x-real-ip (dev / custom proxy): the XFF leftmost
 *   is client-controllable, so it must not be the primary source for a forensic log.
 * - User-Agent: as reported. Capped on insert by audit_events column type.
 * - Request ID: prefer the `x-request-id` set upstream (middleware can stamp
 *   it; some Vercel deployments inject `x-vercel-id`). Fallback: generate
 *   a UUID v4 here so EVERY audit row has a non-null request_id.
 */
export function buildRequestContext(headers: Headers): RequestContext {
  const realIp = headers.get('x-real-ip')?.trim() || null;
  const xff = headers.get('x-forwarded-for');
  const firstFromXff = xff ? xff.split(',')[0]?.trim() || null : null;
  const ip = realIp ?? firstFromXff;

  const requestId = headers.get('x-request-id') ?? headers.get('x-vercel-id') ?? randomUUID();

  return {
    ip,
    userAgent: headers.get('user-agent') ?? null,
    requestId,
    // M20: prefer an upstream correlation id; otherwise reuse requestId so a
    // single HTTP operation still has a non-null correlation handle.
    correlationId: headers.get('x-correlation-id') ?? requestId,
  };
}

/**
 * C12 — RequestContext sintético para o AI Agent, que roda no worker do outbox
 * (SEM request HTTP, logo sem headers). Não há IP/User-Agent reais; o rastro
 * forense vem do turno: `requestId` = aiRequestId (R7) e `correlationId` =
 * eventId do inbound. userAgent fixo identifica a origem nos audit_events.
 */
export function buildAgentRequestContext(args: {
  /** aiRequestId do turno (R7). */
  requestId: string;
  /** eventId do inbound que originou a ação (rastro cross-context). */
  correlationId: string;
}): RequestContext {
  return {
    ip: null,
    userAgent: 'clinicaos-ai-agent',
    requestId: args.requestId,
    correlationId: args.correlationId,
  };
}
