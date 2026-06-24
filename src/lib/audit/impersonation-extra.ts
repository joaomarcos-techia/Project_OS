/**
 * Auditoria EXTRA do impersonate (C15) — cross-reference em super_admin_actions.
 *
 * IMPORTANTE (arquitetura): `super_admin_actions` tem RLS `WITH CHECK
 * (is_super_admin())`, e `is_super_admin()` lê `auth.jwt()` — que é NULL na nossa
 * conexão postgres-js (a tx do `withTenant` roda como role `authenticated` SEM o
 * GUC `request.jwt.claims`). Logo, só o `service_role` (dbAdmin, BYPASSRLS)
 * consegue escrever nessa tabela. Por isso a linha extra é gravada via `dbAdmin`,
 * APÓS o commit da mutação (não dentro da tx do tenant).
 *
 * Atomicidade: o registro PRIMÁRIO é o `audit_events` da própria mutação — que
 * durante o impersonate já tem `user_id`=super_admin + `clinic_id`=clínica
 * impersonada (atômico com a mutação). Esta linha em super_admin_actions é um
 * cross-reference (correlação por impersonationId + ponteiro para o auditEventId).
 * Se falhar (raro), emite métrica e NÃO derruba a mutação já commitada.
 *
 * Server-only. (src/lib/audit/impersonation-extra.ts está na allowlist de dbAdmin
 * do arch:db-check.)
 */
import 'server-only';

import { dbAdmin } from '@/lib/db';
import { superAdminActions } from '@/lib/db/schema/infra/super-admin';
import { metrics } from '@/lib/observability/metrics';
import { sanitizePayload } from '@/lib/sanitize/redact';

import type { RequestContext } from './types';

export async function recordImpersonationAudit(args: {
  impersonationId: string;
  auditEventId: string;
  superAdminId: string;
  clinicId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestContext: RequestContext;
}): Promise<void> {
  try {
    await dbAdmin.insert(superAdminActions).values({
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
    metrics.emit('super_admin.impersonate_mutation', { targetClinicId: args.clinicId });
  } catch {
    // A mutação já commitou; o audit_events primário prova a ação. Best-effort.
    metrics.emit('super_admin.impersonate_audit_failed', { targetClinicId: args.clinicId });
  }
}
