/**
 * /pacientes/[id]/prontuarios — lista de prontuários do paciente (C7).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { listProntuariosByPatient } from '@/contexts/clinical/queries';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { Icon } from '@/components/painel/icons';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';

import { NovoProntuarioButton } from './novo-prontuario-button';

export const dynamic = 'force-dynamic';

export default async function ProntuariosPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const clinicId = await requireClinicId();
  const { id } = await params;
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) notFound();
  const patientId = parsed.data;
  const list = await listProntuariosByPatient(clinicId, patientId);

  return (
    <div className="screen">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/pacientes">Pacientes</Link> <span className="sep">›</span>{' '}
            <Link href={`/pacientes/${patientId}`}>Paciente</Link> <span className="sep">›</span>{' '}
            <b>Prontuários</b>
          </>
        }
        title="Prontuários"
        description="Histórico clínico do paciente."
        actions={
          <>
            <NovoProntuarioButton patientId={patientId} />
            <Link
              href={`/pacientes/${patientId}`}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              Voltar
            </Link>
          </>
        }
      />

      {list.length === 0 ? (
        <EmptyState
          icon={<Icon name="record" size={22} />}
          title="Nenhum prontuário ainda"
          description="Crie o primeiro prontuário para registrar o atendimento."
        />
      ) : (
        <div className="cardblock">
          <div className="listrows">
            {list.map((p) => (
              <div key={p.id} className="listrow">
                <div className="lr-main">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={p.status === 'assinado' ? 'green' : 'amber'}>{p.status}</Badge>
                    <span className="text-sm text-fg-muted">
                      {new Date(p.createdAt).toLocaleString('pt-BR')}
                    </span>
                    {p.needsReturn ? (
                      <span className="text-xs text-fg-subtle">retorno em {p.returnDays}d</span>
                    ) : null}
                  </div>
                </div>
                <div className="lr-end">
                  <Link
                    href={`/pacientes/${patientId}/prontuarios/${p.id}`}
                    className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                  >
                    {p.status === 'assinado' ? 'Ver' : 'Editar'}
                  </Link>
                  {p.status === 'rascunho' ? (
                    <Link
                      href={`/pacientes/${patientId}/prontuarios/${p.id}/assinar`}
                      className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                    >
                      Assinar
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
