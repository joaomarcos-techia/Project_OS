/**
 * /pacientes — list + search. Server component. No decryption (5.13): shows
 * nome/email only. Search is by name (ILIKE / trigram). Tenant scope comes from
 * the session via requireClinicId. Criação vive num Drawer (?novo=1).
 */
import { ChevronRight, Search, Users } from 'lucide-react';
import Link from 'next/link';

import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { listPatients } from '@/contexts/patient/queries';
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

import { NewPatientDrawer } from './new-patient-drawer';

export const dynamic = 'force-dynamic';

export default async function PacientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; novo?: string }>;
}) {
  await requireUser();
  const clinicId = await requireClinicId();
  const { q, novo } = await searchParams;
  const [patients, guardianCandidates] = await Promise.all([
    listPatients(clinicId, q ? { search: q, limit: 50 } : { limit: 50 }),
    listPatients(clinicId, { limit: 200 }),
  ]);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Clínico' }, { label: 'Pacientes' }]}
        title="Pacientes"
        description="Cadastro e busca de pacientes da clínica."
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
                      <TableHead className="w-12" aria-label="Abrir" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {patients.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="p-0">
                          <Link
                            href={`/pacientes/${p.id}`}
                            className="block px-3.5 py-(--cell-py) font-medium text-fg"
                          >
                            {p.nome}
                          </Link>
                        </TableCell>
                        <TableCell className="text-fg-muted">{p.email}</TableCell>
                        <TableCell>
                          <Link
                            href={`/pacientes/${p.id}`}
                            aria-label={`Abrir ${p.nome}`}
                            className="grid size-7 place-items-center rounded-(--r-sm) text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg"
                          >
                            <ChevronRight className="size-4" />
                          </Link>
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
