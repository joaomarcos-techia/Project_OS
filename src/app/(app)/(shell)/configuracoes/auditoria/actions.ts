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
import { clinicDayRange } from '@/lib/datetime/clinic-calendar';
import { getClinicTimezone } from '@/contexts/tenancy/queries';

export type AuditExportResult =
  | { ok: true; csv: string; filename: string; rowCount: number; truncated: boolean }
  | { ok: false; message: string };

export async function exportAuditAction(from: string, to: string): Promise<AuditExportResult> {
  const user = await requireUser();
  // Fresh, não cached: exportar a trilha inteira da clínica é ação sensível e
  // um JWT antigo não pode continuar autorizando depois da revogação.
  await requireFreshPermission(PERMISSIONS.EXPORT_AUDIT);
  const clinicId = await requireClinicId();

  // "De" e "Até" são dias do calendário da CLÍNICA. Antes viravam dias em UTC:
  // "até 16/08" perdia os eventos das 21h às 23h59 de Brasília do dia 16, e
  // "de 01/08" trazia a noite de 31/07. A trilha em si continua em instantes
  // UTC (ISO com Z) no CSV — só a fronteira dos dias mudou.
  const range = clinicDayRange(from, to, await getClinicTimezone(clinicId));
  if (!range) return { ok: false, message: 'Informe um período válido.' };

  try {
    const result = await exportTenantAudit(clinicId, range);

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
