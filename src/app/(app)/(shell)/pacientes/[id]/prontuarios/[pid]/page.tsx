/**
 * /pacientes/[id]/prontuarios/[pid] — editor do prontuário (auto-save 10s).
 * Deep-link clínico/auditável — esta rota PERMANECE (ADR-031). Assinatura em
 * Dialog (?assinar=1); prescrição/documento reusam os Drawers do Consultório
 * (zero duplicação). Prontuário assinado abre em somente-leitura.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { getProntuarioById } from '@/contexts/clinical/queries';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

import { DocumentDrawer } from '../../../../consultorio/document-drawer';
import { PrescriptionDrawer } from '../../../../consultorio/prescription-drawer';
import { ProntuarioEditor } from './prontuario-editor';
import { SignProntuarioDialog } from './sign-prontuario-dialog';

export const dynamic = 'force-dynamic';

export default async function ProntuarioEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; pid: string }>;
  searchParams: Promise<{ assinar?: string }>;
}) {
  await requireUser();
  const clinicId = await requireClinicId();
  const { id, pid } = await params;
  const { assinar } = await searchParams;
  const patParsed = z.string().uuid().safeParse(id);
  const pidParsed = z.string().uuid().safeParse(pid);
  if (!patParsed.success || !pidParsed.success) notFound();

  const prontuario = await getProntuarioById(clinicId, pidParsed.data);
  if (!prontuario || prontuario.patientId !== patParsed.data) notFound();

  const assinado = prontuario.status === 'assinado';
  const vazio = !Object.values(prontuario.content).some(
    (v) => typeof v === 'string' && v.trim() !== '',
  );

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Pacientes', href: '/pacientes' },
          { label: 'Paciente', href: `/pacientes/${patParsed.data}?tab=prontuarios` },
          { label: assinado ? 'Prontuário assinado' : 'Prontuário (rascunho)' },
        ]}
        title={`Prontuário ${assinado ? '(assinado)' : '(rascunho)'}`}
        actions={
          <>
            {!assinado ? (
              <SignProntuarioDialog
                patientId={patParsed.data}
                prontuarioId={prontuario.id}
                defaultOpen={assinar === '1'}
                empty={vazio}
              />
            ) : null}
            <Link
              href={`/pacientes/${patParsed.data}?tab=prontuarios`}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              Voltar
            </Link>
          </>
        }
      />

      <div className="flex max-w-215 flex-col gap-(--sp-4)">
        <Card className="p-(--card-pad)">
          <ProntuarioEditor prontuario={prontuario} />
        </Card>

        <Card className="flex flex-wrap items-center gap-2 p-4">
          <span className="mr-1 font-mono text-(length:--fs-2xs) tracking-(--tracking-label) text-fg-subtle uppercase">
            Emitir
          </span>
          <PrescriptionDrawer patientId={patParsed.data} prontuarioId={prontuario.id} />
          <DocumentDrawer patientId={patParsed.data} />
        </Card>
      </div>
    </>
  );
}
