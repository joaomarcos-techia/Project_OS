/**
 * /pacientes — list + search. Server component. No decryption (5.13): shows
 * nome/email only. Search is by name (ILIKE / trigram). Tenant scope comes from
 * the session via requireClinicId.
 */
import { Search, Users } from 'lucide-react';
import Link from 'next/link';

import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { listPatients } from '@/contexts/patient/queries';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

export default async function PacientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireUser();
  const clinicId = await requireClinicId();
  const { q } = await searchParams;
  const patients = await listPatients(clinicId, q ? { search: q, limit: 50 } : { limit: 50 });

  return (
    <>
      <PageHeader
        title="Pacientes"
        description="Cadastro e busca de pacientes da clínica."
        actions={
          <Link href="/pacientes/novo" className={buttonVariants({ size: 'sm' })}>
            Novo paciente
          </Link>
        }
      />

      <form className="mb-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Buscar por nome…"
            className="pl-9"
            aria-label="Buscar pacientes por nome"
          />
        </div>
      </form>

      {patients.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={q ? 'Nenhum paciente encontrado' : 'Nenhum paciente ainda'}
          description={
            q ? `Nada para “${q}”. Tente outro nome.` : 'Cadastre o primeiro paciente para começar.'
          }
          action={
            !q ? (
              <Link href="/pacientes/novo" className={buttonVariants({ size: 'sm' })}>
                Novo paciente
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {patients.map((p) => (
            <Link
              key={p.id}
              href={`/pacientes/${p.id}`}
              className="flex items-center justify-between gap-4 px-4 py-3 text-sm transition-colors hover:bg-surface-inset"
            >
              <span className="font-medium text-fg">{p.nome}</span>
              <span className="truncate font-mono text-xs text-fg-muted">{p.email}</span>
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}
