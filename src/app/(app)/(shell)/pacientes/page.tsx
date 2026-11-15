import type { Metadata } from 'next';
/**
 * /pacientes — list + search. Server component. No decryption (5.13): shows
 * nome/email only. Search is by name (ILIKE / trigram). Tenant scope comes from
 * the session via requireClinicId. Criação vive num Drawer (?novo=1).
 */
import { Search, UserRound, Users } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { pageGate } from '@/lib/auth/page-guard';
import { listPatients, listPatientsPageWithBonds } from '@/contexts/patient/queries';
import { PageNoAccess } from '@/components/shared/page-no-access';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { EntityCell } from '@/components/ui/entity-cell';
import { SearchField } from '@/components/ui/filter-bar';
import { LinkSegmented } from '@/components/ui/link-segmented';
import { PageHeader } from '@/components/ui/page-header';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { PATIENT_RESTORE_WINDOW_DAYS } from '@/contexts/patient/internal/restore-policy';
import { formatDatePt } from '@/lib/format';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { ageOnDate, todayInTimeZone } from '@/lib/datetime/clinic-calendar';

import styles from './patients.module.css';

import { NewPatientDrawer } from './new-patient-drawer';
import {
  parsePatientListPage,
  patientListHref,
  type PatientListSearchParams,
} from './patient-list-url';
import { RestorePatientButton } from './restore-patient-button';

export const metadata: Metadata = { title: 'Pacientes' };

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
  // UMA rodada, não duas. Os vínculos dependem dos ids da página, então a
  // leitura deles é mesmo sequencial — mas acontece DENTRO da transação da
  // lista, em vez de abrir um segundo `withTenant` (BEGIN + SET LOCAL ROLE +
  // set_config + COMMIT) só para uma query. Medido: o segundo wrapper custava
  // ~820 ms antes de qualquer SELECT.
  //
  // O drawer continua em paralelo porque é outra transação — e transações
  // paralelas são de fato simultâneas (pool max:6), ao contrário de duas
  // queries dentro da mesma.
  const [{ bonds, ...result }, guardianCandidates, timeZone] = await Promise.all([
    listPatientsPageWithBonds(clinicId, {
      page,
      // Na lixeira o vínculo não faz sentido: ele descreve operação corrente.
      withBonds: !showTrash,
      ...(showTrash ? { onlyDeleted: true } : {}),
      ...(q ? { search: q } : {}),
    }),
    // Os candidatos só são necessários dentro do formulário aberto. A listagem
    // normal não carrega mais 200 pacientes adicionais em toda navegação.
    drawerOpen ? listPatients(clinicId, { limit: 200 }) : Promise.resolve([]),
    getClinicTimezone(clinicId),
  ]);
  // Idade pelo dia de hoje da clínica: nascimento é data civil, não instante.
  const hoje = todayInTimeZone(timeZone);
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
        icon={<Users aria-hidden="true" />}
        title="Pacientes"
        headline={`${result.total.toLocaleString('pt-BR')} ${
          showTrash
            ? result.total === 1
              ? 'paciente removido'
              : 'pacientes removidos'
            : result.total === 1
              ? 'paciente ativo'
              : 'pacientes ativos'
        }`}
        description={
          showTrash
            ? `Pacientes removidos nos últimos ${PATIENT_RESTORE_WINDOW_DAYS} dias. Depois disso a remoção é definitiva.`
            : 'Selecione um paciente para ver a ficha completa'
        }
        {...(result.total === 0 && !filtering
          ? {}
          : {
              search: (
                <form role="search">
                  {showTrash ? <input type="hidden" name="removidos" value="1" /> : null}
                  <SearchField
                    name="q"
                    defaultValue={sp.q ?? ''}
                    placeholder="Buscar por nome"
                    aria-label="Buscar pacientes por nome"
                    grow={false}
                    className="w-full"
                  />
                </form>
              ),
            })}
        {...(canRestore && !(result.total === 0 && !filtering)
          ? {
              controls: (
                <LinkSegmented
                  label="Situação dos pacientes"
                  items={[
                    { label: 'Ativos', removed: false },
                    { label: 'Removidos', removed: true },
                  ].map((item) => ({
                    label: item.label,
                    href: patientListHref(currentParams, {
                      removidos: item.removed ? '1' : undefined,
                      novo: undefined,
                      page: undefined,
                    }),
                    active: showTrash === item.removed,
                  }))}
                />
              ),
            }
          : {})}
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
          <DataTable
            className={styles.table ?? ''}
            title={
              showTrash
                ? `Removidos nos últimos ${PATIENT_RESTORE_WINDOW_DAYS} dias`
                : 'Todos os pacientes'
            }
            {...(q
              ? { description: `Filtrando por “${q}”` }
              : showTrash
                ? { description: 'Restaure antes da remoção definitiva' }
                : {})}
            total={result.items.length === 0 ? 0 : result.total}
            page={page}
            pageCount={totalPages}
            pageSize={result.pageSize}
            unit={{
              one: showTrash ? 'removido' : 'paciente',
              many: showTrash ? 'removidos' : 'pacientes',
            }}
            hrefFor={(nextPage) => patientListHref(currentParams, { page: String(nextPage) })}
            hint="Use a busca para localizar um paciente específico"
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
                {showTrash ? (
                  <TableHead>Removido em</TableHead>
                ) : (
                  <>
                    <TableHead>Nascimento</TableHead>
                    <TableHead>Vínculo</TableHead>
                  </>
                )}
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
                        <EntityCell
                          name={p.nome}
                          {...(p.cpfMascarado
                            ? {
                                sub: (
                                  <span className="font-mono tabular-nums">
                                    CPF {p.cpfMascarado}
                                  </span>
                                ),
                              }
                            : {})}
                        />
                      </Link>
                    )}
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    {/* E-mail em cima, telefone embaixo — a referência empilha os
                        dois porque a recepção usa um ou outro conforme o caso, e
                        abrir o cadastro só para descobrir o número era um clique
                        a mais em toda ligação. */}
                    <span className="block truncate">
                      {p.email || <span className="italic text-fg-subtle">Não informado</span>}
                    </span>
                    {p.telefone ? (
                      <span className="mt-1 block font-mono text-(length:--fs-2xs) tabular-nums text-fg-subtle">
                        {p.telefone}
                      </span>
                    ) : null}
                  </TableCell>
                  {showTrash ? (
                    <TableCell className="text-fg-muted">{formatDatePt(p.deletedAt)}</TableCell>
                  ) : (
                    <>
                      <TableCell>
                        {p.dataNascimento ? (
                          <>
                            <span className="block font-mono text-(length:--fs-sm) tabular-nums text-fg-muted">
                              {formatDatePt(p.dataNascimento)}
                            </span>
                            {ageOnDate(p.dataNascimento, hoje) !== null ? (
                              <span className="mt-0.5 block text-(length:--fs-2xs) text-fg-subtle">
                                {ageOnDate(p.dataNascimento, hoje)} anos
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {/* Responsável primeiro: para um menor, saber QUEM responde
                            é o que decide se a recepção pode seguir sozinha. */}
                        {bonds.get(p.id)?.responsavelNome ? (
                          <Badge tone="blue">
                            <UserRound aria-hidden="true" className="size-3" />
                            Responsável: {bonds.get(p.id)!.responsavelNome}
                          </Badge>
                        ) : (bonds.get(p.id)?.dependentes ?? 0) > 0 ? (
                          <Badge tone="gray">
                            <Users aria-hidden="true" className="size-3" />
                            {bonds.get(p.id)!.dependentes} dependente
                            {bonds.get(p.id)!.dependentes === 1 ? '' : 's'}
                          </Badge>
                        ) : null}
                      </TableCell>
                    </>
                  )}
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
