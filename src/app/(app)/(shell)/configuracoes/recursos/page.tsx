import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { listSchedulableResources } from '@/contexts/scheduling/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';

import { ResourcesManager } from './resources-manager';

export const dynamic = 'force-dynamic';

export default async function RecursosPage() {
  const user = await requireUser();
  const clinicId = await requireClinicId();
  const breadcrumb = (
    <>
      <Link href="/configuracoes">Configurações</Link> <span className="sep">›</span>{' '}
      <b>Salas e equipamentos</b>
    </>
  );
  const backLink = (
    <Link href="/configuracoes" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
      Voltar
    </Link>
  );

  if (!user.permissions.includes(PERMISSIONS.MANAGE_AVAILABILITY)) {
    return (
      <div>
        <PageHeader breadcrumb={breadcrumb} title="Salas e equipamentos" actions={backLink} />
        <Alert variant="warning" title="Sem acesso">
          Seu perfil não tem permissão para gerenciar recursos da agenda.
        </Alert>
      </div>
    );
  }

  const resources = await listSchedulableResources(clinicId, false);
  return (
    <div>
      <PageHeader
        breadcrumb={breadcrumb}
        title="Salas e equipamentos"
        description="Cadastre os recursos compartilhados usados nos atendimentos. O sistema impede reservas sobrepostas."
        actions={backLink}
      />
      <ResourcesManager initial={resources} />
    </div>
  );
}
