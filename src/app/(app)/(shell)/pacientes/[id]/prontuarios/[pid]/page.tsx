/**
 * /pacientes/[id]/prontuarios/[pid] — editor do prontuário (auto-save 10s) +
 * emissão de prescrição/documento. Prontuário assinado abre em somente-leitura.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { getProntuarioById, listPrescriptionTemplates } from '@/contexts/clinical/queries';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';

import { MedicalDocumentForm } from './medical-document-form';
import { PrescriptionForm } from './prescription-form';
import { ProntuarioEditor } from './prontuario-editor';

export const dynamic = 'force-dynamic';

export default async function ProntuarioEditorPage({
  params,
}: {
  params: Promise<{ id: string; pid: string }>;
}) {
  const user = await requireUser();
  const clinicId = await requireClinicId();
  const { id, pid } = await params;
  const patParsed = z.string().uuid().safeParse(id);
  const pidParsed = z.string().uuid().safeParse(pid);
  if (!patParsed.success || !pidParsed.success) notFound();

  const prontuario = await getProntuarioById(clinicId, pidParsed.data);
  if (!prontuario || prontuario.patientId !== patParsed.data) notFound();

  const assinado = prontuario.status === 'assinado';
  // Modelos de receita do médico logado (Fase 2) — paciente-agnósticos.
  const templates = await listPrescriptionTemplates(clinicId, user.userId);

  return (
    <div className="screen">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/pacientes">Pacientes</Link> <span className="sep">›</span>{' '}
            <Link href={`/pacientes/${patParsed.data}/prontuarios`}>Prontuários</Link>{' '}
            <span className="sep">›</span> <b>{assinado ? 'Assinado' : 'Rascunho'}</b>
          </>
        }
        title={`Prontuário ${assinado ? '(assinado)' : '(rascunho)'}`}
        actions={
          <>
            {prontuario.status === 'rascunho' ? (
              <Link
                href={`/pacientes/${patParsed.data}/prontuarios/${prontuario.id}/assinar`}
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                Assinar
              </Link>
            ) : null}
            <Link
              href={`/pacientes/${patParsed.data}/prontuarios`}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              Voltar
            </Link>
          </>
        }
      />

      <div className="stack" style={{ maxWidth: 860 }}>
        <div className="cardblock wrap-pad">
          <ProntuarioEditor prontuario={prontuario} />
        </div>

        <div className="cardblock wrap-pad">
          <h4 className="mb-4 text-sm font-semibold">Prescrição</h4>
          <PrescriptionForm
            patientId={patParsed.data}
            prontuarioId={prontuario.id}
            templates={templates}
          />
        </div>

        <div className="cardblock wrap-pad">
          <h4 className="mb-4 text-sm font-semibold">Documento médico</h4>
          <MedicalDocumentForm patientId={patParsed.data} />
        </div>
      </div>
    </div>
  );
}
