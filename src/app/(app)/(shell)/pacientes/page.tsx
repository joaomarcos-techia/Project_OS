/**
 * /pacientes — list + search. Server component. No decryption (5.13): shows
 * nome/email only. Search is by name (ILIKE / trigram). Tenant scope comes from
 * the session via requireClinicId. Criação vive num Drawer (?novo=1).
 */
import { ChevronRight, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { pageGate } from '@/lib/auth/page-guard';
import { listPatients, listPatientsPage } from '@/contexts/patient/queries';
import { PageNoAccess } from '@/components/shared/page-no-access';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { EntityCell } from '@/components/ui/entity-cell';
import { FilterBar, SearchField } from '@/components/ui/filter-bar';
import { PageHeader } from '@/components/ui/page-header';
import { StatsInline } from '@/components/ui/stats-inline';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { PATIENT_RESTORE_WINDOW_DAYS } from '@/contexts/patient/internal/restore-policy';
import { formatDatePt } from '@/lib/format';

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
            : 'Cadastro e busca de pacientes da clínica.'
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
          {/* Métrica na linha, não em card: a contagem cabe numa frase e a
              tabela sobe para perto do topo. */}
          <StatsInline
            className="mb-(--sp-3)"
            items={[
              {
                label: `${result.total.toLocaleString('pt-BR')} ${
                  showTrash ? 'removido' : 'paciente'
                }${result.total === 1 ? '' : 's'}`,
              },
              ...(q
                ? [{ label: `filtrando por “${q}”` as const, tone: 'attention' as const }]
                : []),
            ]}
          />

          <FilterBar>
            <form className="flex min-w-0 flex-1 items-center gap-(--sp-2)" role="search">
              {showTrash ? <input type="hidden" name="removidos" value="1" /> : null}
              <SearchField
                name="q"
                defaultValue={sp.q ?? ''}
                placeholder="Buscar por nome…"
                aria-label="Buscar pacientes por nome"
                className="max-w-90"
              />
            </form>
            {canRestore ? (
              <Link
                href={patientListHref(currentParams, {
                  removidos: showTrash ? undefined : '1',
                  novo: undefined,
                  page: undefined,
                })}
                className="text-(length:--fs-sm) font-medium text-link hover:underline"
              >
                {showTrash ? 'Voltar aos ativos' : 'Removidos'}
              </Link>
            ) : null}
          </FilterBar>

          <DataTable
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
                {showTrash ? <TableHead>Removido em</TableHead> : null}
                <TableHead className="w-12" aria-label="Abrir" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className={showTrash ? undefined : 'p-0'}>
                    {showTrash ? (
                      // A rota do paciente removido responde 404 (HTTP-001):
                      // oferecer o link aqui levaria a um beco sem saída.
                      <EntityCell name={p.nome} sub={p.email} />
                    ) : (
                      <Link href={`/pacientes/${p.id}`} className="block px-3.5 py-(--cell-py)">
                        <EntityCell name={p.nome} sub={p.email} />
                      </Link>
                    )}
                  </TableCell>
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
                        className="grid size-7 place-items-center rounded-(--r-sm) text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg"
                      >
                        <ChevronRight className="size-4" />
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
