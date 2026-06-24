import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';

import { recordImpersonationAudit } from './impersonation-extra';
import { logAudit } from './log';
import type { RequestContext } from './types';

/**
 * auditedMutation — wrapper de mutação que loga audit na MESMA tx.
 *
 * **NÃO recomendado como default.** Para Server Actions mutativas a partir de
 * C5, prefira `idempotentMutation` (idempotency + audit numa só tx). Este
 * wrapper existe para os casos RAROS em que idempotency não faz sentido:
 *   - jobs internos cron-triggered (já idempotentes por design)
 *   - migrações operacionais one-shot
 *   - flows de bootstrap onde o caller não tem como gerar idempotency key
 *
 * Caller responsável por capturar `before` antes da chamada (SELECT do row
 * pré-mutação). `after` é o retorno de fn — passado a logAudit.
 */
export async function auditedMutation<T>(
  opts: {
    action: string;
    resourceType: string;
    resourceId: string | null;
    before: unknown | null;
    requestContext: RequestContext;
  },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const user = await requireUser();
  const clinicId = await requireClinicId();
  const impersonation = user.session?.impersonation;

  let auditEventId: string | undefined;
  const after = await withTenant(clinicId, async (tx) => {
    const result = await fn(tx);
    auditEventId = await logAudit(tx, {
      clinicId,
      userId: user.userId,
      action: opts.action,
      resourceType: opts.resourceType,
      resourceId: opts.resourceId,
      before: opts.before,
      after: result,
      requestContext: opts.requestContext,
    });
    return result;
  });

  // C15 — auditoria EXTRA do impersonate: gravada APÓS o commit, via dbAdmin
  // (super_admin_actions só aceita service_role). Best-effort (ver helper).
  if (impersonation && auditEventId) {
    await recordImpersonationAudit({
      impersonationId: impersonation.impersonationId,
      auditEventId,
      superAdminId: user.userId,
      clinicId,
      action: opts.action,
      resourceType: opts.resourceType,
      resourceId: opts.resourceId,
      requestContext: opts.requestContext,
    });
  }
  return after;
}
