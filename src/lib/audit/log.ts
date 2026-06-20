import { randomUUID } from 'node:crypto';

import type { Tx } from '@/lib/db';
import { auditEvents } from '@/lib/db/schema/infra/audit';
import { metrics } from '@/lib/observability/metrics';
import { sanitizePayload } from '@/lib/sanitize/redact';

import type { RequestContext } from './types';

/**
 * logAudit — ÚNICO ponto de gravação em `audit_events`.
 *
 * Atomicidade: aceita o `tx` da business mutation. INSERT em audit_events vai
 * junto da MESMA tx. Falha do INSERT (constraint, partition default, etc.)
 * RoLla a TX inteira — política "no audit, no op". Aceita perder a operação
 * para não perder a evidência.
 *
 * Sanitização: `before` e `after` passam por `sanitizePayload` antes do INSERT.
 *   - key-level: SENSITIVE_KEYS (password|token|secret|jwt|cookie|api_key|...)
 *     viram `[REDACTED]`.
 *   - value-level: strings com Bearer/JWT/sk_/DSN são redacted via regex.
 * Mesma defesa em metrics.emit.
 *
 * IP/UA/request_id vêm do RequestContext criado em buildRequestContext() pelo
 * caller (boundary Server Action ou route handler).
 */
export async function logAudit(
  tx: Tx,
  args: {
    clinicId: string;
    userId: string | null;
    action: string;
    resourceType: string;
    resourceId: string | null;
    before: unknown | null;
    after: unknown | null;
    requestContext: RequestContext;
  },
): Promise<string> {
  // C15: id explícito para que a auditoria EXTRA do impersonate referencie esta
  // linha por `auditEventId` (review #4 — referência, nunca payload duplicado).
  const auditEventId = randomUUID();
  await tx.insert(auditEvents).values({
    id: auditEventId,
    clinicId: args.clinicId,
    userId: args.userId,
    action: args.action,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    before: args.before === null ? null : (sanitizePayload(args.before) as never),
    after: args.after === null ? null : (sanitizePayload(args.after) as never),
    ipAddress: args.requestContext.ip,
    userAgent: args.requestContext.userAgent,
    requestId: args.requestContext.requestId,
    correlationId: args.requestContext.correlationId ?? args.requestContext.requestId,
  });
  metrics.emit('audit.written', {
    action: args.action,
    resourceType: args.resourceType,
  });
  return auditEventId;
}
