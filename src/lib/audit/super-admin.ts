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

/**
 * superAdminAuditedRead — LEITURA sensível do super_admin com trilha fail-closed
 * (S-01, ADR-073).
 *
 * Mesma autoridade e mesma transação de `superAdminAction`, com duas diferenças
 * que só fazem sentido para leitura:
 *   - `fn` devolve `null` quando não há o que ler (recurso inexistente ou de
 *     outra clínica). Nesse caso NADA é gravado: a trilha registra leitura que
 *     aconteceu, não tentativa.
 *   - o `payload` é calculado a partir do resultado (ex.: quantas mensagens
 *     saíram). Quem chama escolhe só metadado; conteúdo nunca entra aqui.
 *
 * Fail-closed: o INSERT roda DEPOIS da leitura e DENTRO da mesma tx. Se ele
 * falhar, a transação desfaz, a exceção sobe e o resultado não sai da função —
 * a política "no audit, no op" aplicada ao lado da leitura.
 */
export async function superAdminAuditedRead<T>(
  opts: {
    action: string;
    targetClinicId: string;
    payload: (result: T) => Record<string, unknown>;
    requestContext: RequestContext;
  },
  fn: (tx: Tx) => Promise<T | null>,
): Promise<T | null> {
  await requireSuperAdmin(); // AAL2 enforced
  const user = await requireUser();

  return dbAdmin.transaction(async (tx) => {
    const result = await fn(tx);
    if (result === null) return null;
    await tx.insert(superAdminActions).values({
      superAdminId: user.userId,
      action: opts.action,
      targetClinicId: opts.targetClinicId,
      payload: sanitizePayload(opts.payload(result)) as never,
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
