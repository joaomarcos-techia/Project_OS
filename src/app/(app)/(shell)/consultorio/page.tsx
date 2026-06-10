import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';

import { getBoard } from './actions';
import { ConsultorioBoard } from './consultorio-board';

// Claims do usuário e o board mudam por requisição.
export const dynamic = 'force-dynamic';

export default async function ConsultorioPage() {
  const user = await requireUser();
  await requireClinicId();

  if (!user.permissions.includes(PERMISSIONS.VIEW_CONSULTORIO)) {
    return (
      <>
        <PageHeader title="Consultório" />
        <Alert variant="warning" title="Sem acesso">
          Seu perfil não tem permissão para o consultório.
        </Alert>
      </>
    );
  }

  const initialBoard = await getBoard();

  return (
    <ConsultorioBoard
      clinicId={user.clinicId!}
      isDoctor={user.role === 'doctor'}
      initialBoard={initialBoard}
    />
  );
}
