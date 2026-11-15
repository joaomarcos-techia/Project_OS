import type { Metadata } from 'next';
import { getCurrentPractitioner } from '@/contexts/identity/internal/practitioner';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requirePageUser } from '@/lib/auth/page-guard';
import { requireClinicId } from '@/lib/auth/tenant-context';

import { getBoard } from './actions';
import { ConsultorioBoard } from './consultorio-board';

export const metadata: Metadata = { title: 'Consultório' };

// Claims do usuário e o board mudam por requisição.
export const dynamic = 'force-dynamic';

export default async function ConsultorioPage() {
  const user = await requirePageUser();
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

  const [initialBoard, timeZone] = await Promise.all([
    getBoard(),
    getClinicTimezone(user.clinicId!),
  ]);

  return (
    <ConsultorioBoard
      clinicId={user.clinicId!}
      isPractitioner={await getCurrentPractitioner()}
      initialBoard={initialBoard}
      timeZone={timeZone}
    />
  );
}
