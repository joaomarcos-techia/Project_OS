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
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Assinar prontuário</h1>
        <Link
          href={`/pacientes/${patParsed.data}/prontuarios/${prontuario.id}`}
          className="text-sm underline"
        >
          Voltar ao editor
        </Link>
      </div>

      {prontuario.status === 'assinado' ? (
        <p className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          Este prontuário já está assinado.
        </p>
      ) : (
        <>
          <div className="mb-6 rounded border border-gray-200 p-4">
            {entries.length === 0 ? (
              <p className="text-sm text-red-600">
                O prontuário está vazio — preencha o conteúdo antes de assinar.
              </p>
            ) : (
              <dl className="flex flex-col gap-3 text-sm">
                {entries.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs font-semibold uppercase text-gray-500">{k}</dt>
                    <dd className="whitespace-pre-wrap">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <SignProntuarioForm patientId={patParsed.data} prontuarioId={prontuario.id} />
        </>
      )}
    </main>
  );
}
