import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { listPatientCards } from '@/contexts/patient/queries';
import { listProcedures, listWaitlistEntries } from '@/contexts/scheduling/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';

import { getAgendaData } from '../data';
import { WaitlistManager } from './waitlist-manager';

export const dynamic = 'force-dynamic';

export default async function ListaEsperaPage() {
  const user = await requireUser();
  const clinicId = await requireClinicId();
  if (!user.permissions.includes(PERMISSIONS.EDIT_AGENDA)) {
    return (
      <>
        <PageHeader title="Lista de espera" />
        <Alert variant="warning" title="Sem acesso">
          Seu perfil não tem permissão para editar a agenda.
        </Alert>
      </>
    );
  }
  const [entries, procedures, agendaData] = await Promise.all([
    listWaitlistEntries(clinicId, true),
    listProcedures(clinicId, { onlyActive: true }),
    getAgendaData({ view: 'day' }),
  ]);
  const patientIds = [...new Set(entries.map((entry) => entry.patientId))];
  const patients = await listPatientCards(clinicId, patientIds);

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Operação' },
          { label: 'Agenda', href: '/agenda' },
          { label: 'Lista de espera' },
        ]}
        title="Lista de espera"
        description="Cadastre interessados; quando um horário compatível é cancelado, o primeiro candidato elegível recebe uma oferta."
        actions={
          <Link href="/agenda" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Voltar à agenda
          </Link>
        }
      />
      <WaitlistManager
        initial={entries}
        patients={patients.map((patient) => ({ id: patient.id, name: patient.nome }))}
        procedures={procedures.map((procedure) => ({
          id: procedure.id,
          name: procedure.descricao,
        }))}
        doctors={agendaData.doctors.map((doctor) => ({ id: doctor.id, name: doctor.nome }))}
      />
    </>
  );
}
