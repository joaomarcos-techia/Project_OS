import Link from 'next/link';
import { redirect } from 'next/navigation';

import { isPractitioner } from '@/contexts/identity';
import { getProfileNames, listEmployees } from '@/contexts/identity/queries';
import { administersTeamSchedule } from '@/contexts/scheduling/internal/availability-scope';
import { listDoctorAbsencesPage } from '@/contexts/scheduling/queries';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { PanelCard } from '@/components/ui/panel-card';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableCellStack,
  TableFoot,
  TableFootInfo,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  TableWrap,
} from '@/components/ui/table';
import { TablePager } from '@/components/ui/table-pager';
import { TableToolbar } from '@/components/ui/table-toolbar';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';

import { DoctorAbsenceForm } from './doctor-absence-form';
import {
  doctorAbsencePageHref,
  parseDoctorAbsencePage,
  parseDoctorAbsencePeriod,
} from './pagination';

export const dynamic = 'force-dynamic';

type SP = { profissional?: string; periodo?: string; page?: string };

export default async function DoctorAbsencesPage({ searchParams }: { searchParams: Promise<SP> }) {
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
  const filterDoctors = employees
    .filter((employee) => !employee.pending && isPractitioner(employee))
    .map((employee) => ({ id: employee.id, nome: employee.nome }));
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
  const sp = await searchParams;
  const page = parseDoctorAbsencePage(sp.page);
  const period = parseDoctorAbsencePeriod(sp.periodo);
  const doctorId = filterDoctors.some((doctor) => doctor.id === sp.profissional)
    ? sp.profissional
    : undefined;
  const filters = {
    ...(doctorId ? { doctorId } : {}),
    ...(period !== 'upcoming' ? { period } : {}),
  };
  const asOf = new Date();
  const [result, timezoneResult] = await Promise.all([
    listDoctorAbsencesPage(clinicId, { ...filters, period, page, asOf }),
    getClinicTimezone(clinicId),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  if (page > totalPages) redirect(doctorAbsencePageHref(filters, totalPages));

  const absences = result.items;
  const timezone = timezoneResult ?? 'America/Sao_Paulo';
  const names = await getProfileNames(
    clinicId,
    absences.flatMap((absence) => [absence.doctorId, absence.replacementDoctorId ?? '']),
  );
  const firstItem = (page - 1) * result.pageSize + 1;
  const lastItem = Math.min(page * result.pageSize, result.total);
  const periodTitle =
    period === 'past'
      ? 'Histórico de ausências'
      : period === 'all'
        ? 'Todas as ausências'
        : 'Ausências atuais e futuras';

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
      <div className="grid gap-5 xl:grid-cols-[minmax(18rem,0.75fr)_minmax(0,1.25fr)]">
        <PanelCard title="Registrar ausência">
          <DoctorAbsenceForm doctors={doctors} />
        </PanelCard>
        <section aria-labelledby="absence-list-title" className="min-w-0">
          <h2 id="absence-list-title" className="mb-2 text-balance text-sm font-semibold text-fg">
            {periodTitle}
          </h2>
          <TableWrap>
            <TableToolbar>
              <form className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <div className="min-w-44 flex-1">
                  <Select
                    name="profissional"
                    defaultValue={doctorId ?? ''}
                    aria-label="Filtrar ausências por profissional"
                  >
                    <option value="">Todos os profissionais</option>
                    {filterDoctors.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.nome}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="min-w-40 flex-1">
                  <Select
                    name="periodo"
                    defaultValue={period === 'upcoming' ? '' : period}
                    aria-label="Filtrar ausências por período"
                  >
                    <option value="">Atuais e futuras</option>
                    <option value="past">Encerradas</option>
                    <option value="all">Todas</option>
                  </Select>
                </div>
                <button
                  type="submit"
                  className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                >
                  Filtrar
                </button>
              </form>
            </TableToolbar>
            {absences.length === 0 ? (
              <EmptyState
                title="Nenhuma ausência registrada"
                description="Ajuste os filtros ou registre um novo período de ausência."
              />
            ) : (
              <TableScroll>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Profissional</TableHead>
                      <TableHead>Período</TableHead>
                      <TableHead>Estratégia</TableHead>
                      <TableHead numeric>Afetados</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {absences.map((absence) => (
                      <TableRow key={absence.id}>
                        <TableCell>
                          <TableCellStack
                            main={names.get(absence.doctorId) ?? 'Profissional'}
                            sub={absence.reason}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-fg-muted tabular-nums">
                          {new Date(absence.startsAt).toLocaleString('pt-BR', {
                            timeZone: timezone,
                          })}{' '}
                          até{' '}
                          {new Date(absence.endsAt).toLocaleString('pt-BR', {
                            timeZone: timezone,
                          })}
                        </TableCell>
                        <TableCell>
                          <Badge tone={absence.strategy === 'transfer' ? 'blue' : 'amber'}>
                            {absence.strategy === 'transfer' ? 'Transferência' : 'Cancelamento'}
                          </Badge>
                          {absence.replacementDoctorId ? (
                            <p className="mt-1 text-pretty text-xs text-fg-subtle">
                              Substituto: {names.get(absence.replacementDoctorId) ?? 'Profissional'}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell numeric>{absence.affectedAppointments}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableScroll>
            )}
            <TableFoot>
              <TableFootInfo className="tabular-nums">
                Página {page} de {totalPages} ·{' '}
                {result.total === 0
                  ? '0 ausências'
                  : `${firstItem}–${lastItem} de ${result.total} ausência${result.total === 1 ? '' : 's'}`}
              </TableFootInfo>
              <TablePager
                page={page}
                pageCount={totalPages}
                hrefFor={(targetPage) => doctorAbsencePageHref(filters, targetPage)}
              />
            </TableFoot>
          </TableWrap>
        </section>
      </div>
    </>
  );
}
