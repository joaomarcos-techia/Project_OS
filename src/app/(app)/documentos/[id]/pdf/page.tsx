/**
 * /documentos/[id]/pdf — preview + download de documento médico (atestado,
 * declaração, exame, encaminhamento). Mesma estratégia da prescrição: signed
 * URL fresca por load; regenerar se ausente.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { getMedicalDocumentById } from '@/contexts/clinical/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { resourceGate } from '@/lib/auth/page-guard';
import { createClinicalSignedUrl } from '@/lib/storage/clinical';

import { RegeneratePdfButton } from './regenerate-button';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  atestado: 'Atestado',
  declaracao: 'Declaração',
  exame: 'Solicitação de exames',
  encaminhamento: 'Encaminhamento',
};

export default async function DocumentPdfPage({ params }: { params: Promise<{ id: string }> }) {
  // AUTHZ-003 — ANTES de consultar/decifrar e MUITO antes de
  // `createClinicalSignedUrl`: a URL assinada é um bearer token para o arquivo,
  // então emiti-la já é o vazamento, mesmo que a página não renderize.
  // Negativa = notFound(), não 403: um 403 aqui distinguiria "existe mas você
  // não pode" de "não existe" e viraria oráculo de enumeração.
  const gate = await resourceGate([PERMISSIONS.VIEW_PRESCRIPTION]);
  if (!gate) notFound();
  const { clinicId } = gate;
  const { id } = await params;
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) notFound();

  const doc = await getMedicalDocumentById(clinicId, parsed.data);
  if (!doc) notFound();

  const url = doc.pdfStoragePath ? await createClinicalSignedUrl(doc.pdfStoragePath) : null;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          {TYPE_LABEL[doc.type] ?? 'Documento'} — {doc.snapshotPatientNome}
        </h1>
        <Link href={`/pacientes/${doc.patientId}/prontuarios`} className="text-sm underline">
          Voltar
        </Link>
      </div>

      {url ? (
        <>
          <div className="mb-3 flex gap-4 text-sm">
            <a href={url} target="_blank" rel="noreferrer" className="underline">
              Abrir em nova aba
            </a>
            <a href={url} download className="underline">
              Baixar
            </a>
          </div>
          <iframe
            src={url}
            title="Documento"
            className="h-[80vh] w-full rounded border border-gray-300"
          />
        </>
      ) : (
        <p className="mb-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          O PDF ainda não foi gerado. Clique abaixo para gerar.
        </p>
      )}

      <div className="mt-4">
        <RegeneratePdfButton id={doc.id} label={url ? 'Regenerar PDF' : 'Gerar PDF'} />
      </div>
    </main>
  );
}
