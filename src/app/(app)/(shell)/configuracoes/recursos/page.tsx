import type { Metadata } from 'next';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { administersTeamSchedule } from '@/contexts/scheduling/internal/availability-scope';
import { listSchedulableResources } from '@/contexts/scheduling/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requirePageUser } from '@/lib/auth/page-guard';
import { requireClinicId } from '@/lib/auth/tenant-context';

import { ResourcesManager } from './resources-manager';

export const metadata: Metadata = { title: 'Salas e equipamentos' };

export const dynamic = 'force-dynamic';

export default async function RecursosPage() {
  const user = await requirePageUser();
  const clinicId = await requireClinicId();

  // AUTHZ-007 — sala/equipamento é recurso COMPARTILHADO: desativar um afeta a
  // agenda de toda a clínica. Exige a mesma capacidade administrativa que a
  // action passou a exigir; a tela não pode oferecer o que o servidor nega.
  if (
    !user.permissions.includes(PERMISSIONS.MANAGE_AVAILABILITY) ||
    !administersTeamSchedule(user)
  ) {
    return (
      <div>
        <PageHeader
          crumbs={[
            { label: 'Configurações', href: '/configuracoes' },
            { label: 'Salas e equipamentos' },
          ]}
          title="Salas e equipamentos"
        />
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
        crumbs={[
          { label: 'Configurações', href: '/configuracoes' },
          { label: 'Salas e equipamentos' },
        ]}
        title="Salas e equipamentos"
        description="Cadastre os recursos compartilhados usados nos atendimentos. O sistema impede reservas sobrepostas."
      />
      <ResourcesManager initial={resources} />
    </div>
  );
}
