/**
 * /configuracoes/horarios — disponibilidade semanal por profissional + feriados.
 * Base da Agenda/slots (slot-resolver). Backend C6 pronto (config-actions, gate
 * manage:availability, validação doctor↔clínica + EXCLUDE de overlap).
 */
import Link from 'next/link';

import { isPractitioner } from '@/contexts/identity';
import { listEmployees } from '@/contexts/identity/queries';
import { administersTeamSchedule } from '@/contexts/scheduling/internal/availability-scope';
import { listDoctorAvailability, listHolidays } from '@/contexts/scheduling/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';

import { HorariosManager } from './horarios-manager';

export const dynamic = 'force-dynamic';

export default async function HorariosPage() {
  const user = await requireUser();
  const clinicId = await requireClinicId();

  const breadcrumb = (
    <>
      <Link href="/configuracoes">Configurações</Link> <span className="sep">›</span>{' '}
      <b>Horários</b>
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
        <PageHeader breadcrumb={breadcrumb} title="Horários" actions={backLink} />
        <Alert variant="warning" title="Sem acesso">
          Seu perfil não tem permissão para gerenciar horários de atendimento.
        </Alert>
      </div>
    );
  }

  // AUTHZ-007 — quem não administra a equipe vê e edita só a própria janela;
  // feriado é da clínica inteira e some para esse perfil. Mesma regra da action.
  const canManageTeam = administersTeamSchedule(user);
  const employees = await listEmployees(clinicId);
  const doctors = employees
    .filter((e) => isPractitioner(e) && e.ativo)
    .filter((e) => canManageTeam || e.id === user.userId)
    .map((e) => ({ id: e.id, nome: e.nome }));
  const [availability, holidays] = await Promise.all([
    listDoctorAvailability(clinicId),
    listHolidays(clinicId),
  ]);

  return (
    <div>
      <PageHeader
        breadcrumb={breadcrumb}
        title="Horários de atendimento"
        description="Disponibilidade semanal dos profissionais e feriados — base da agenda e dos horários livres."
        actions={backLink}
      />
      <HorariosManager
        doctors={doctors}
        availability={availability}
        holidays={holidays}
        canManageHolidays={canManageTeam}
      />
    </div>
  );
}
