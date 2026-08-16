import Link from 'next/link';

import { isPractitioner } from '@/contexts/identity';
import { getProfileNames, listEmployees } from '@/contexts/identity/queries';
import { administersTeamSchedule } from '@/contexts/scheduling/internal/availability-scope';
import { listDoctorAbsences } from '@/contexts/scheduling/queries';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { PanelCard } from '@/components/ui/panel-card';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';

import { DoctorAbsenceForm } from './doctor-absence-form';

export const dynamic = 'force-dynamic';

export default async function DoctorAbsencesPage() {
  const user = await requireUser();
  if (!user.permissions.includes(PERMISSIONS.MANAGE_AVAILABILITY)) {
    return (
      <Alert variant="warning" title="Sem permissão">
        Você não tem permissão para reorganizar a disponibilidade da equipe.
      </Alert>
    );
  }
  const clinicId = await requireClinicId();
  const employees = await listEmployees(clinicId);
  // AUTHZ-007 — o seletor listava TODOS os profissionais para qualquer portador
  // de `manage:availability`. Quem não administra a equipe só pode registrar a
  // própria ausência; a mesma regra é reaplicada na action (a UI não é o gate).
  const canManageTeam = administersTeamSchedule(user);
  const doctors = employees
    .filter((employee) => employee.ativo && !employee.pending && isPractitioner(employee))
    .filter((employee) => canManageTeam || employee.id === user.userId)
    .map((employee) => ({ id: employee.id, nome: employee.nome }));

  // Um não-practitioner sem gestão de equipe não tem agenda própria para
  // ausentar-se — a tela não teria o que oferecer.
  if (doctors.length === 0) {
    return (
      <Alert variant="warning" title="Sem permissão">
        Você só pode registrar ausências da sua própria agenda, e seu perfil não tem agenda de
        atendimento. Fale com um gestor da clínica.
      </Alert>
    );
  }
  const absences = await listDoctorAbsences(clinicId, { from: new Date(), limit: 100 });
  const timezone = (await getClinicTimezone(clinicId)) ?? 'America/Sao_Paulo';
  const names = await getProfileNames(
    clinicId,
    absences.flatMap((absence) => [absence.doctorId, absence.replacementDoctorId ?? '']),
  );

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Operação' },
          { label: 'Agenda', href: '/agenda' },
          { label: 'Ausências médicas' },
        ]}
        title="Ausências médicas"
        description="Registre um período e reorganize os atendimentos afetados de forma auditável."
        actions={
          <Link href="/agenda" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            Voltar à agenda
          </Link>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
        <PanelCard title="Registrar ausência">
          <DoctorAbsenceForm doctors={doctors} />
        </PanelCard>
        <PanelCard title="Ausências atuais e futuras" meta={`${absences.length}`}>
          {absences.length === 0 ? (
            <EmptyState
              title="Nenhuma ausência registrada"
              description="Os próximos períodos aparecerão aqui."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {absences.map((absence) => (
                <li key={absence.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm">
                      {names.get(absence.doctorId) ?? 'Profissional'}
                    </strong>
                    <Badge tone={absence.strategy === 'transfer' ? 'blue' : 'amber'}>
                      {absence.strategy === 'transfer' ? 'Transferência' : 'Cancelamento'}
                    </Badge>
                  </div>
                  <p className="text-pretty text-xs text-fg-muted">{absence.reason}</p>
                  <p className="text-xs text-fg-subtle tabular-nums">
                    {new Date(absence.startsAt).toLocaleString('pt-BR', { timeZone: timezone })} até{' '}
                    {new Date(absence.endsAt).toLocaleString('pt-BR', { timeZone: timezone })}
                  </p>
                  <p className="text-xs text-fg-subtle">
                    {absence.affectedAppointments} atendimento(s) afetado(s)
                    {absence.replacementDoctorId
                      ? ` · substituto: ${names.get(absence.replacementDoctorId) ?? 'Profissional'}`
                      : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
      </div>
    </>
  );
}
