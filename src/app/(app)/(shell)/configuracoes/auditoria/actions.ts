'use server';

/**
 * RBAC-001 — Server Action do export de auditoria TENANT (`export:audit`).
 *
 * O `clinicId` vem de `requireClinicId()`, nunca do cliente: não existe
 * parâmetro de tenant nesta superfície, então não há `clinic_id` arbitrário a
 * recusar. A leitura roda sob RLS, e o próprio export é auditado — quem
 * exportou a trilha também fica na trilha.
 */
import { logAudit } from '@/lib/audit/log';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import { AuditExportRangeError, exportTenantAudit } from '@/lib/audit/tenant-export';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';
import { withTenant } from '@/lib/db/tenant';

export type AuditExportResult =
  | { ok: true; csv: string; filename: string; rowCount: number; truncated: boolean }
  | { ok: false; message: string };

export async function exportAuditAction(from: string, to: string): Promise<AuditExportResult> {
  const user = await requireUser();
  // Fresh, não cached: exportar a trilha inteira da clínica é ação sensível e
  // um JWT antigo não pode continuar autorizando depois da revogação.
  await requireFreshPermission(PERMISSIONS.EXPORT_AUDIT);
  const clinicId = await requireClinicId();

  try {
    const result = await exportTenantAudit(clinicId, {
      from: new Date(from),
      // Fim do dia informado: quem pede "até 16/08" espera o dia 16 inteiro.
      to: new Date(`${to.slice(0, 10)}T23:59:59.999Z`),
    });

    const ctx = await requestContext();
    await withTenant(clinicId, (tx) =>
      logAudit(tx, {
        clinicId,
        userId: user.userId,
        action: 'audit.export.tenant',
        resourceType: 'audit_events',
        resourceId: null,
        before: null,
        // Só metadados: período, volume e se saiu completo. Nunca o conteúdo.
        after: {
          from: result.from,
          to: result.to,
          rowCount: result.rowCount,
          truncated: result.truncated,
        },
        requestContext: ctx,
      }),
    );

    return {
      ok: true,
      csv: result.csv,
      filename: `auditoria-${from.slice(0, 10)}-a-${to.slice(0, 10)}.csv`,
      rowCount: result.rowCount,
      truncated: result.truncated,
    };
  } catch (err) {
    // Período inválido é entrada do usuário (OBS-002), não falha interna.
    if (err instanceof AuditExportRangeError) return { ok: false, message: err.message };
    throw err;
  }
}
