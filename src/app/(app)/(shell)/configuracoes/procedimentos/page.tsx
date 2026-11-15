import type { Metadata } from 'next';
/**
 * /configuracoes/procedimentos — catálogo de procedimentos da clínica (preço +
 * duração). É o que destrava a criação de atendimentos na Agenda para clínicas
 * reais (antes só existia via seed). Backend C6 pronto (createProcedure/update/
 * deactivate; procedure NUNCA é deletado — FK RESTRICT → só ativo=false).
 */
import { listProcedures } from '@/contexts/scheduling/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requirePageUser } from '@/lib/auth/page-guard';
import { requireClinicId } from '@/lib/auth/tenant-context';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';

import { ProceduresManager } from './procedures-manager';

export const metadata: Metadata = { title: 'Procedimentos' };

export const dynamic = 'force-dynamic';

export default async function ProcedimentosPage() {
  const user = await requirePageUser();
  const clinicId = await requireClinicId();

  if (!user.permissions.includes(PERMISSIONS.MANAGE_PROCEDURES)) {
    return (
      <div>
        <PageHeader
          crumbs={[{ label: 'Configurações', href: '/configuracoes' }, { label: 'Procedimentos' }]}
          title="Procedimentos"
        />
        <Alert variant="warning" title="Sem acesso">
          Seu perfil não tem permissão para gerenciar o catálogo de procedimentos.
        </Alert>
      </div>
    );
  }

  const procedures = await listProcedures(clinicId);

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Configurações', href: '/configuracoes' }, { label: 'Procedimentos' }]}
        title="Procedimentos"
        description="Catálogo de procedimentos com preço e duração — base da Agenda e do faturamento."
      />
      <ProceduresManager initial={procedures} />
    </div>
  );
}
