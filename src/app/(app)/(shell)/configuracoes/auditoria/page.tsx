import type { Metadata } from 'next';
/**
 * /configuracoes/auditoria — export da trilha da PRÓPRIA clínica (RBAC-001).
 *
 * Gateada em `export:audit`. Não confundir com o export de PLATAFORMA
 * (`(admin)/admin/clinicas/[id]/audit/export`), que é super-admin, cross-tenant
 * e gera artefato assinado: esta tela nunca dá acesso àquele.
 */
import { PageNoAccess } from '@/components/shared/page-no-access';
import { pageGate } from '@/lib/auth/page-guard';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { addDaysToYmd, todayInTimeZone } from '@/lib/datetime/clinic-calendar';

import { AuditExportForm } from './audit-export-form';

export const metadata: Metadata = { title: 'Auditoria' };

export const dynamic = 'force-dynamic';

export default async function AuditoriaPage() {
  const gate = await pageGate([PERMISSIONS.EXPORT_AUDIT]);
  if (!gate.allowed) {
    return (
      <PageNoAccess
        crumbs={[{ label: 'Configurações', href: '/configuracoes' }, { label: 'Auditoria' }]}
        title="Auditoria"
        description="Seu perfil não tem permissão para exportar a trilha de auditoria da clínica. Fale com um gestor se precisar de acesso."
      />
    );
  }
  // Hoje no fuso da clínica, calculado aqui: o servidor e o navegador mostram
  // o mesmo padrão, e depois das 21h ele não pula para o dia seguinte.
  const clinicId = gate.user.session?.impersonation?.clinicId ?? gate.user.clinicId;
  const today = todayInTimeZone(clinicId ? await getClinicTimezone(clinicId) : 'America/Sao_Paulo');
  return <AuditExportForm defaultFrom={addDaysToYmd(today, -30)} today={today} />;
}
