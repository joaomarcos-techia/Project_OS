/**
 * /pacientes — list + search. Server component. No decryption (5.13): shows
 * nome/email only. Search is by name (ILIKE / trigram). Tenant scope comes from
 * the session via requireClinicId.
 */
import { Users } from 'lucide-react';
import Link from 'next/link';

import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { listPatients } from '@/contexts/patient/queries';
import { Icon } from '@/components/painel/icons';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
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
    <div className="screen">
      <PageHeader
        breadcrumb={
          <>
            Pacientes <span className="sep">›</span> <b>Lista</b>
          </>
        }
        title="Pacientes"
        description="Cadastro e busca de pacientes da clínica."
        actions={
          <Link href="/pacientes/novo" className={buttonVariants({ size: 'sm' })}>
            <Icon name="plus" size={15} />
            Novo paciente
          </Link>
        }
      />

      <form className="toolbar">
        <div className="input-wrap tb-grow" style={{ maxWidth: 360 }}>
          <Icon name="search" size={16} />
          <input
            className="input"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Buscar por nome…"
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
        <div className="cardblock">
          <div className="listrows">
            {patients.map((p) => (
              <Link key={p.id} href={`/pacientes/${p.id}`} className="listrow">
                <div className="lr-main">
                  <b>{p.nome}</b>
                  <span className="lr-sub">{p.email}</span>
                </div>
                <span className="lr-end">
                  <Icon name="chevR" size={16} className="text-fg-subtle" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
