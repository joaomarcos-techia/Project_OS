/**
 * Auditoria EXTRA do impersonate (C15) — atômica e por REFERÊNCIA.
 *
 * Toda mutação tenant feita durante uma sessão de impersonate gera, ALÉM do
 * `audit_events` normal, uma linha em `super_admin_actions` (OR-I8). Esta linha
 * NÃO duplica o payload: guarda apenas `auditEventId` (1:1 com a linha de
 * audit_events) + `impersonationId` (correlação por sessão). "O que mudou?" →
 * join em audit_events.id; "mesma sessão?" → impersonationId (review #4/#14).
 *
 * Escreve com o `tx` do withTenant (role authenticated): a migração 0028
 * concedeu INSERT em super_admin_actions a authenticated, e a policy
 * super_admin_actions_super_insert (0008) gateia por is_super_admin() — durante
 * o impersonate o JWT segue super_admin. Mesma tx = "no audit, no op".
 *
 * Server-only.
 */
import 'server-only';

import type { Tx } from '@/lib/db';
import { superAdminActions } from '@/lib/db/schema/infra/super-admin';
import { sanitizePayload } from '@/lib/sanitize/redact';

import type { RequestContext } from './types';

export async function recordImpersonationAudit(
  tx: Tx,
  args: {
    impersonationId: string;
    auditEventId: string;
    superAdminId: string;
    clinicId: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    requestContext: RequestContext;
  },
): Promise<void> {
  await tx.insert(superAdminActions).values({
    superAdminId: args.superAdminId,
    action: 'impersonate_mutation',
    targetClinicId: args.clinicId,
    // Só referência — nunca o before/after da mutação.
    payload: sanitizePayload({
      impersonationId: args.impersonationId,
      auditEventId: args.auditEventId,
      action: args.action,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
    }) as never,
    ipAddress: args.requestContext.ip,
    userAgent: args.requestContext.userAgent,
  });
}
