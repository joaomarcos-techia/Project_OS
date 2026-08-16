/**
 * /pacientes — list + search. Server component. No decryption (5.13): shows
 * nome/email only. Search is by name (ILIKE / trigram). Tenant scope comes from
 * the session via requireClinicId. Criação vive num Drawer (?novo=1).
 */
import { ChevronRight, Search, Users } from 'lucide-react';
import Link from 'next/link';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { pageGate } from '@/lib/auth/page-guard';
import { listPatients } from '@/contexts/patient/queries';
import { PageNoAccess } from '@/components/shared/page-no-access';
import { EmptyState } from '@/components/ui/empty-state';
import { fieldControlClassName } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableFoot,
  TableFootInfo,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  TableWrap,
} from '@/components/ui/table';
import { TableToolbar } from '@/components/ui/table-toolbar';
import { cn } from '@/lib/ui/cn';

import { PATIENT_RESTORE_WINDOW_DAYS } from '@/contexts/patient/internal/restore-policy';
import { formatDatePt } from '@/lib/format';

import { NewPatientDrawer } from './new-patient-drawer';
import { RestorePatientButton } from './restore-patient-button';

export const dynamic = 'force-dynamic';

export default async function PacientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; novo?: string; removidos?: string }>;
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
  const { q, novo, removidos } = await searchParams;
  // PAT-001 — a lixeira só existe para quem tem a capacidade que removeu. Ver
  // quem foi apagado é informação sobre a operação da clínica, não uma listagem
  // de pacientes: `view:patient` sozinho não basta.
  const canRestore = gate.user.permissions.includes(PERMISSIONS.DELETE_PATIENT);
  const showTrash = removidos === '1' && canRestore;
  const [patients, guardianCandidates] = await Promise.all([
    listPatients(
      clinicId,
      showTrash
        ? { onlyDeleted: true, limit: 50, ...(q ? { search: q } : {}) }
        : q
          ? { search: q, limit: 50 }
          : { limit: 50 },
    ),
    listPatients(clinicId, { limit: 200 }),
  ]);

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
            defaultOpen={novo === '1'}
            guardianCandidates={guardianCandidates.map(({ id, nome }) => ({ id, nome }))}
          />
        }
      />

      {patients.length === 0 && !q ? (
        <EmptyState
          icon={<Users />}
          title="Nenhum paciente ainda"
          description="Cadastre o primeiro paciente para começar."
        />
      ) : (
        <TableWrap>
          <TableToolbar>
            <form className="min-w-0 flex-1" role="search">
              <span className="relative block max-w-90">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
                />
                <input
                  name="q"
                  defaultValue={q ?? ''}
                  placeholder="Buscar por nome…"
                  aria-label="Buscar pacientes por nome"
                  className={cn(fieldControlClassName, 'pl-9')}
                />
              </span>
            </form>
            {canRestore ? (
              <Link
                href={showTrash ? '/pacientes' : '/pacientes?removidos=1'}
                className="text-(length:--fs-sm) font-medium text-link hover:underline"
              >
                {showTrash ? 'Voltar aos ativos' : 'Removidos'}
              </Link>
            ) : null}
          </TableToolbar>
          {patients.length === 0 ? (
            <EmptyState
              icon={<Search />}
              title="Nenhum paciente encontrado"
              description={`Nada para “${q}”. Tente outro nome.`}
            />
          ) : (
            <>
              <TableScroll>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>E-mail</TableHead>
                      {showTrash ? <TableHead>Removido em</TableHead> : null}
                      <TableHead className="w-12" aria-label="Abrir" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {patients.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className={showTrash ? undefined : 'p-0'}>
                          {showTrash ? (
                            // A rota do paciente removido responde 404 (HTTP-001):
                            // oferecer o link aqui levaria a um beco sem saída.
                            <span className="font-medium text-fg">{p.nome}</span>
                          ) : (
                            <Link
                              href={`/pacientes/${p.id}`}
                              className="block px-3.5 py-(--cell-py) font-medium text-fg"
                            >
                              {p.nome}
                            </Link>
                          )}
                        </TableCell>
                        <TableCell className="text-fg-muted">{p.email}</TableCell>
                        {showTrash ? (
                          <TableCell className="text-fg-muted">
                            {formatDatePt(p.deletedAt)}
                          </TableCell>
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
                </Table>
              </TableScroll>
              <TableFoot>
                <TableFootInfo>
                  {patients.length} paciente{patients.length === 1 ? '' : 's'}
                  {patients.length === 50 ? ' (mostrando os 50 primeiros — refine a busca)' : ''}
                </TableFootInfo>
              </TableFoot>
            </>
          )}
        </TableWrap>
      )}
    </>
  );
}
