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

import { AuditExportForm } from './audit-export-form';

export const dynamic = 'force-dynamic';

export default async function AuditoriaPage() {
  const gate = await pageGate([PERMISSIONS.EXPORT_AUDIT]);
  if (!gate.allowed) {
    return (
      <PageNoAccess
        crumbs={[
          { label: 'Conformidade e segurança', href: '/configuracoes/seguranca' },
          { label: 'Auditoria' },
        ]}
        title="Auditoria"
        description="Seu perfil não tem permissão para exportar a trilha de auditoria da clínica. Fale com um gestor se precisar de acesso."
      />
    );
  }
  return <AuditExportForm />;
}
