/**
 * Leitura do feed de atividade recente (audit_events) para o dashboard.
 *
 * Tenant-scoped via `withTenant` (RLS `audit_events_tenant_select` resolve por
 * `app.current_clinic`). O feed é sensível (quem mexeu em quê) — a CAMADA DE TELA
 * deve gatear em `view:audit` antes de chamar isto. Aqui só lemos campos não-PII
 * (action/resource/quem/quando); nunca expomos `before`/`after`.
 *
 * Server-only.
 */
import 'server-only';

import { desc, eq } from 'drizzle-orm';

import { auditEvents } from '@/lib/db/schema/infra/audit';
import { withTenant } from '@/lib/db/tenant';

export type AuditActivity = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  userId: string | null;
  createdAt: string;
};

export async function getRecentActivity(clinicId: string, limit = 8): Promise<AuditActivity[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        resourceType: auditEvents.resourceType,
        resourceId: auditEvents.resourceId,
        userId: auditEvents.userId,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .where(eq(auditEvents.clinicId, clinicId)) // usa o índice (clinic_id, created_at); RLS já isola
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId ?? null,
      userId: r.userId ?? null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    }));
  });
}
