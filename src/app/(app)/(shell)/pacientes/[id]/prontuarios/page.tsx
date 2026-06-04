/**
 * /pacientes/[id]/prontuarios — lista de prontuários do paciente (C7).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { listProntuariosByPatient } from '@/contexts/clinical/queries';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';

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
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Prontuários</h1>
        <Link href={`/pacientes/${patientId}`} className="text-sm underline">
          Voltar
        </Link>
      </div>

      <NovoProntuarioButton patientId={patientId} />

      <ul className="mt-4 divide-y divide-gray-200">
        {list.length === 0 ? (
          <li className="py-3 text-sm text-gray-500">Nenhum prontuário ainda.</li>
        ) : null}
        {list.map((p) => (
          <li key={p.id} className="flex items-center justify-between py-3">
            <div className="text-sm">
              <span
                className={
                  p.status === 'assinado'
                    ? 'rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800'
                    : 'rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800'
                }
              >
                {p.status}
              </span>
              <span className="ml-2 text-gray-600">
                {new Date(p.createdAt).toLocaleString('pt-BR')}
              </span>
              {p.needsReturn ? (
                <span className="ml-2 text-xs text-gray-500">retorno em {p.returnDays}d</span>
              ) : null}
            </div>
            <div className="flex gap-3">
              <Link
                href={`/pacientes/${patientId}/prontuarios/${p.id}`}
                className="text-sm underline"
              >
                {p.status === 'assinado' ? 'Ver' : 'Editar'}
              </Link>
              {p.status === 'rascunho' ? (
                <Link
                  href={`/pacientes/${patientId}/prontuarios/${p.id}/assinar`}
                  className="text-sm underline"
                >
                  Assinar
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
