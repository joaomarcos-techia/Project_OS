import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';

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
  return withTenant(clinicId, async (tx) => {
    const after = await fn(tx);
    await logAudit(tx, {
      clinicId,
      userId: user.userId,
      action: opts.action,
      resourceType: opts.resourceType,
      resourceId: opts.resourceId,
      before: opts.before,
      after,
      requestContext: opts.requestContext,
    });
    return after;
  });
}
