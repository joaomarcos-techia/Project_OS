import { requireSuperAdmin, requireUser } from '@/lib/auth/tenant-context';
import { dbAdmin } from '@/lib/db';
import type { Tx } from '@/lib/db';
import { superAdminActions } from '@/lib/db/schema/infra/super-admin';
import { metrics } from '@/lib/observability/metrics';
import { sanitizePayload } from '@/lib/sanitize/redact';

import type { RequestContext } from './types';

/**
 * superAdminAction — wrapper de ações cross-tenant do super_admin.
 *
 * Diferença para `auditedMutation`:
 *   - Não recebe clinic_id (super_admin não tem). O target_clinic_id é argumento
 *     se a ação afeta uma clínica específica.
 *   - Usa `dbAdmin` (BYPASSRLS) porque ações podem cruzar tenants ou tocar
 *     tabelas global-protected.
 *   - `requireSuperAdmin()` valida AAL2 (MFA obrigatório).
 *   - INSERT em super_admin_actions na MESMA tx — append-only forensic log
 *     lido apenas por super_admin via policy `USING (is_super_admin())`.
 *   - Payload sanitizado: super_admin_actions é o log forensic mais sensível
 *     do sistema (cruza tenant boundaries); um secret vazado aqui não tem
 *     dono claro de RLS.
 */
export async function superAdminAction<T>(
  opts: {
    action: string;
    targetClinicId: string | null;
    payload: unknown;
    requestContext: RequestContext;
  },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  await requireSuperAdmin(); // AAL2 enforced
  const user = await requireUser();

  return dbAdmin.transaction(async (tx) => {
    const result = await fn(tx);
    await tx.insert(superAdminActions).values({
      superAdminId: user.userId,
      action: opts.action,
      targetClinicId: opts.targetClinicId,
      payload: sanitizePayload(opts.payload) as never,
      ipAddress: opts.requestContext.ip,
      userAgent: opts.requestContext.userAgent,
    });
    metrics.emit('super_admin.action', {
      action: opts.action,
      targetClinicId: opts.targetClinicId,
    });
    return result;
  });
}
