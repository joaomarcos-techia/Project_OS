/**
 * /pacientes/[id]/prontuarios/[pid] — editor do prontuário (auto-save 10s) +
 * emissão de prescrição/documento. Prontuário assinado abre em somente-leitura.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { getProntuarioById } from '@/contexts/clinical/queries';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';

import { MedicalDocumentForm } from './medical-document-form';
import { PrescriptionForm } from './prescription-form';
import { ProntuarioEditor } from './prontuario-editor';

export const dynamic = 'force-dynamic';

export default async function ProntuarioEditorPage({
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

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          Prontuário {prontuario.status === 'assinado' ? '(assinado)' : '(rascunho)'}
        </h1>
        <div className="flex gap-3 text-sm">
          {prontuario.status === 'rascunho' ? (
            <Link
              href={`/pacientes/${patParsed.data}/prontuarios/${prontuario.id}/assinar`}
              className="underline"
            >
              Assinar
            </Link>
          ) : null}
          <Link href={`/pacientes/${patParsed.data}/prontuarios`} className="underline">
            Voltar
          </Link>
        </div>
      </div>

      <ProntuarioEditor prontuario={prontuario} />

      <section className="mt-10 border-t border-gray-200 pt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Prescrição</h2>
        <PrescriptionForm patientId={patParsed.data} prontuarioId={prontuario.id} />
      </section>

      <section className="mt-8 border-t border-gray-200 pt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Documento médico</h2>
        <MedicalDocumentForm patientId={patParsed.data} />
      </section>
    </main>
  );
}
