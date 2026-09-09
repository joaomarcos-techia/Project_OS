/**
 * /pacientes — list + search. Server component. No decryption (5.13): shows
 * nome/email only. Search is by name (ILIKE / trigram). Tenant scope comes from
 * the session via requireClinicId. Criação vive num Drawer (?novo=1).
 */
import { Search, Users } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { pageGate } from '@/lib/auth/page-guard';
import { listPatients, listPatientsPage } from '@/contexts/patient/queries';
import { PageNoAccess } from '@/components/shared/page-no-access';
import { buttonVariants } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { EntityCell } from '@/components/ui/entity-cell';
import { FilterBar, SearchField } from '@/components/ui/filter-bar';
import { PageHeader } from '@/components/ui/page-header';
import { StatsInline } from '@/components/ui/stats-inline';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { PATIENT_RESTORE_WINDOW_DAYS } from '@/contexts/patient/internal/restore-policy';
import { formatDatePt } from '@/lib/format';
import { cn } from '@/lib/ui/cn';

import styles from './patients.module.css';

import { NewPatientDrawer } from './new-patient-drawer';
import {
  parsePatientListPage,
  patientListHref,
  type PatientListSearchParams,
} from './patient-list-url';
import { RestorePatientButton } from './restore-patient-button';

export const dynamic = 'force-dynamic';

export default async function PacientesPage({
  searchParams,
}: {
  searchParams: Promise<PatientListSearchParams>;
}) {
  // AUTHZ-001 — o gate vem ANTES de qualquer leitura. `listPatients` aplica
  // tenant-scope/RLS, não RBAC: sem isto, um colaborador com `view:patient`
  // negada continuava lendo a lista da própria clínica.
  const gate = await pageGate([PERMISSIONS.VIEW_PATIENT]);
  if (!gate.allowed) {
    return (
      <PageNoAccess
        crumbs={[{ label: 'Clínico' }, { label: 'Pacientes' }]}
        title="Pacientes"
        description="Seu perfil não tem permissão para ver os pacientes da clínica. Fale com um gestor se precisar de acesso."
      />
    );
  }
  const { clinicId } = gate;
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 64) || undefined;
  const page = parsePatientListPage(sp.page);
  // PAT-001 — a lixeira só existe para quem tem a capacidade que removeu. Ver
  // quem foi apagado é informação sobre a operação da clínica, não uma listagem
  // de pacientes: `view:patient` sozinho não basta.
  const canRestore = gate.user.permissions.includes(PERMISSIONS.DELETE_PATIENT);
  const showTrash = sp.removidos === '1' && canRestore;
  const drawerOpen = sp.novo === '1';
  const [result, guardianCandidates] = await Promise.all([
    listPatientsPage(clinicId, {
      page,
      ...(showTrash ? { onlyDeleted: true } : {}),
      ...(q ? { search: q } : {}),
    }),
    // Os candidatos só são necessários dentro do formulário aberto. A listagem
    // normal não carrega mais 200 pacientes adicionais em toda navegação.
    drawerOpen ? listPatients(clinicId, { limit: 200 }) : Promise.resolve([]),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const filtering = Boolean(q || showTrash);
  const currentParams: PatientListSearchParams = {
    ...(q ? { q } : {}),
    ...(showTrash ? { removidos: '1' } : {}),
    ...(drawerOpen ? { novo: '1' } : {}),
    ...(page > 1 ? { page: String(page) } : {}),
  };
  if (page > totalPages) {
    redirect(
      patientListHref(currentParams, {
        page: totalPages > 1 ? String(totalPages) : undefined,
      }),
    );
  }

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Clínico' }, { label: 'Pacientes' }]}
        title="Pacientes"
        description={
          showTrash
            ? `Pacientes removidos nos últimos ${PATIENT_RESTORE_WINDOW_DAYS} dias. Depois disso a remoção é definitiva.`
            : 'Busca, cadastro e hub de cada paciente.'
        }
        actions={
          <NewPatientDrawer
            defaultOpen={drawerOpen}
            guardianCandidates={guardianCandidates.map(({ id, nome }) => ({ id, nome }))}
            openHref={patientListHref(currentParams, { novo: '1' })}
            closeHref={patientListHref(currentParams, { novo: undefined })}
          />
        }
      />

      {result.total === 0 && !filtering ? (
        <EmptyState
          icon={<Users />}
          title="Nenhum paciente ainda"
          description="Cadastre o primeiro paciente para começar."
        />
      ) : (
        <>
          <FilterBar className="qoro-toolbar">
            <form className="flex w-full min-w-0 items-center gap-(--sp-2) sm:w-68" role="search">
              {showTrash ? <input type="hidden" name="removidos" value="1" /> : null}
              <SearchField
                name="q"
                defaultValue={sp.q ?? ''}
                placeholder="Buscar por nome…"
                aria-label="Buscar pacientes por nome"
                className="min-w-0"
              />
            </form>
            {canRestore ? (
              <nav
                aria-label="Situação dos pacientes"
                className="inline-flex rounded-(--r-md) border border-border bg-surface-inset p-0.5"
              >
                {[
                  { label: 'Ativos', removed: false },
                  { label: 'Removidos', removed: true },
                ].map((item) => (
                  <Link
                    key={item.label}
                    href={patientListHref(currentParams, {
                      removidos: item.removed ? '1' : undefined,
                      novo: undefined,
                      page: undefined,
                    })}
                    aria-current={showTrash === item.removed ? 'page' : undefined}
                    className={cn(
                      'inline-flex min-h-(--hit-target) items-center rounded-(--r-sm) px-3 text-(length:--fs-sm)',
                      showTrash === item.removed
                        ? 'bg-surface font-semibold text-fg shadow-xs'
                        : 'text-fg-muted hover:bg-surface-hover',
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            ) : null}
            <StatsInline
              className="ml-auto"
              items={[
                {
                  label: `${result.total.toLocaleString('pt-BR')} ${showTrash ? 'removido' : 'paciente'}${result.total === 1 ? '' : 's'}`,
                },
                ...(q ? [{ label: `filtrando por “${q}”`, tone: 'attention' as const }] : []),
              ]}
            />
          </FilterBar>

          <DataTable
            className={styles.table ?? ''}
            total={result.items.length === 0 ? 0 : result.total}
            page={page}
            pageCount={totalPages}
            pageSize={result.pageSize}
            unit={{
              one: showTrash ? 'removido' : 'paciente',
              many: showTrash ? 'removidos' : 'pacientes',
            }}
            hrefFor={(nextPage) => patientListHref(currentParams, { page: String(nextPage) })}
            empty={
              <EmptyState
                icon={<Search />}
                title={showTrash ? 'Nenhum paciente removido' : 'Nenhum paciente encontrado'}
                description={
                  q
                    ? `Nada para “${q}”. Tente outro nome.`
                    : showTrash
                      ? 'Não há pacientes removidos para restaurar.'
                      : 'Nenhum paciente está disponível nesta página.'
                }
              />
            }
          >
            <TableHeader>
              <TableRow>
                <TableHead>Paciente</TableHead>
                <TableHead>Contato</TableHead>
                {showTrash ? <TableHead>Removido em</TableHead> : null}
                <TableHead className="w-28" aria-label="Abrir" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className={showTrash ? undefined : 'p-0'}>
                    {showTrash ? (
                      // A rota do paciente removido responde 404 (HTTP-001):
                      // oferecer o link aqui levaria a um beco sem saída.
                      <EntityCell name={p.nome} />
                    ) : (
                      <Link href={`/pacientes/${p.id}`} className="block px-3.5 py-(--cell-py)">
                        <EntityCell name={p.nome} />
                      </Link>
                    )}
                  </TableCell>
                  <TableCell className="text-fg-muted">{p.email || 'Não informado'}</TableCell>
                  {showTrash ? (
                    <TableCell className="text-fg-muted">{formatDatePt(p.deletedAt)}</TableCell>
                  ) : null}
                  <TableCell>
                    {showTrash ? (
                      <RestorePatientButton patientId={p.id} />
                    ) : (
                      <Link
                        href={`/pacientes/${p.id}`}
                        aria-label={`Abrir ${p.nome}`}
                        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                      >
                        Abrir
                      </Link>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </DataTable>
        </>
      )}
    </>
  );
}
