import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { administersTeamSchedule } from '@/contexts/scheduling/internal/availability-scope';
import { listSchedulableResources } from '@/contexts/scheduling/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';

import { ResourcesManager } from './resources-manager';

export const dynamic = 'force-dynamic';

export default async function RecursosPage() {
  const user = await requireUser();
  const clinicId = await requireClinicId();
  const crumbs = [{ label: 'Configurações', href: '/configuracoes' }, { label: 'Recursos' }];
  const backLink = (
    <Link href="/configuracoes" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
      Voltar
    </Link>
  );

  // AUTHZ-007 — sala/equipamento é recurso COMPARTILHADO: desativar um afeta a
  // agenda de toda a clínica. Exige a mesma capacidade administrativa que a
  // action passou a exigir; a tela não pode oferecer o que o servidor nega.
  if (
    !user.permissions.includes(PERMISSIONS.MANAGE_AVAILABILITY) ||
    !administersTeamSchedule(user)
  ) {
    return (
      <div>
        <PageHeader crumbs={crumbs} title="Salas e equipamentos" actions={backLink} />
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
        crumbs={crumbs}
        title="Salas e equipamentos"
        description="Cadastre os recursos compartilhados usados nos atendimentos. O sistema impede reservas sobrepostas."
        actions={backLink}
      />
      <ResourcesManager initial={resources} />
    </div>
  );
}
