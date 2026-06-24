/**
 * /pacientes/[id]/prontuarios/[pid]/assinar — confirma + assina o prontuário.
 * O gate sign:prontuario é aplicado na Server Action signProntuario (doctor sim,
 * attendant → 403). Esta página apenas mostra o conteúdo e o formulário.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { getProntuarioById } from '@/contexts/clinical/queries';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';

import { SignProntuarioForm } from './sign-form';

export const dynamic = 'force-dynamic';

export default async function AssinarPage({
  params,
}: {
  params: Promise<{ id: string; pid: string }>;
}) {
  await requireUser();
  const clinicId = await requireClinicId();
  const { id, pid } = await params;
  const patParsed = z.string().uuid().safeParse(id);
  const pidParsed = z.string().uuid().safeParse(pid);
  if (!patParsed.success || !pidParsed.success) notFound();

  const prontuario = await getProntuarioById(clinicId, pidParsed.data);
  if (!prontuario || prontuario.patientId !== patParsed.data) notFound();

  const entries = Object.entries(prontuario.content).filter(
    ([, v]) => typeof v === 'string' && v.trim() !== '',
  ) as [string, string][];

  return (
    <div className="screen">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/pacientes">Pacientes</Link> <span className="sep">›</span>{' '}
            <Link href={`/pacientes/${patParsed.data}/prontuarios`}>Prontuários</Link>{' '}
            <span className="sep">›</span> <b>Assinar</b>
          </>
        }
        title="Assinar prontuário"
        actions={
          <Link
            href={`/pacientes/${patParsed.data}/prontuarios/${prontuario.id}`}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            Voltar ao editor
          </Link>
        }
      />

      <div className="stack" style={{ maxWidth: 720 }}>
        {prontuario.status === 'assinado' ? (
          <Alert variant="success">Este prontuário já está assinado.</Alert>
        ) : (
          <>
            <div className="cardblock wrap-pad">
              {entries.length === 0 ? (
                <p className="text-sm text-danger-600">
                  O prontuário está vazio — preencha o conteúdo antes de assinar.
                </p>
              ) : (
                <dl className="flex flex-col gap-3 text-sm">
                  {entries.map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-fg-subtle">
                        {k}
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            <div className="cardblock wrap-pad">
              <SignProntuarioForm patientId={patParsed.data} prontuarioId={prontuario.id} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
