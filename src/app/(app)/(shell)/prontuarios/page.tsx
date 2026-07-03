/**
 * /prontuarios — ponto de entrada de navegação do histórico clínico. O prontuário
 * é sempre POR PACIENTE (a rota /pacientes/[id]/prontuarios já existe, C7); esta
 * tela só busca o paciente e leva até o histórico dele. Sem editor novo, sem
 * regra nova (ADR-018: vira link real porque a rota de destino existe).
 */
import Link from 'next/link';

import { listPatients } from '@/contexts/patient/queries';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { Icon } from '@/components/painel/icons';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

export default async function ProntuariosBrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireUser();
  const clinicId = await requireClinicId();
  const { q } = await searchParams;
  const patients = await listPatients(clinicId, q ? { search: q, limit: 50 } : { limit: 50 });

  return (
    <div>
      <PageHeader
        breadcrumb={
          <>
            Clínico <span className="sep">›</span> <b>Prontuários</b>
          </>
        }
        title="Prontuários"
        description="Escolha um paciente para ver o histórico clínico."
      />

      <form className="toolbar">
        <div className="input-wrap tb-grow" style={{ maxWidth: 360 }}>
          <Icon name="search" size={16} />
          <input
            className="input"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Buscar paciente por nome…"
            aria-label="Buscar paciente"
          />
        </div>
      </form>

      {patients.length === 0 ? (
        <EmptyState
          icon={<Icon name="record" size={22} />}
          title={q ? 'Nenhum paciente encontrado' : 'Nenhum paciente ainda'}
          description={
            q ? `Nada para “${q}”. Tente outro nome.` : 'Cadastre um paciente para registrar prontuários.'
          }
        />
      ) : (
        <div className="cardblock">
          <div className="listrows">
            {patients.map((p) => (
              <Link
                key={p.id}
                href={`/pacientes/${p.id}/prontuarios`}
                className="listrow"
              >
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
