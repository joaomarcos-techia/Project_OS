/**
 * /prescricoes/[id]/pdf — preview + download. Gera uma signed URL FRESCA (TTL
 * 24h) do pdf_storage_path a cada load (R4 — a action nunca retorna a URL). Se o
 * PDF ainda não existe (falha na geração), oferece regenerar.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { getPrescriptionById } from '@/contexts/clinical/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { resourceGate } from '@/lib/auth/page-guard';
import { createClinicalSignedUrl } from '@/lib/storage/clinical';

import { RegeneratePdfButton } from './regenerate-button';

export const dynamic = 'force-dynamic';

export default async function PrescriptionPdfPage({ params }: { params: Promise<{ id: string }> }) {
  // AUTHZ-003 — ver a nota gêmea em documentos/[id]/pdf: o gate precede a
  // consulta e a emissão da signed URL, e a negativa é indistinguível de 404.
  const gate = await resourceGate([PERMISSIONS.VIEW_PRESCRIPTION]);
  if (!gate) notFound();
  const { clinicId } = gate;
  const { id } = await params;
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) notFound();

  const presc = await getPrescriptionById(clinicId, parsed.data);
  if (!presc) notFound();

  const url = presc.pdfStoragePath ? await createClinicalSignedUrl(presc.pdfStoragePath) : null;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Prescrição — {presc.snapshotPatientNome}</h1>
        <Link href={`/pacientes/${presc.patientId}/prontuarios`} className="text-sm underline">
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
            title="Prescrição"
            className="h-[80vh] w-full rounded border border-gray-300"
          />
        </>
      ) : (
        <p className="mb-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          O PDF ainda não foi gerado. Clique abaixo para gerar.
        </p>
      )}

      <div className="mt-4">
        <RegeneratePdfButton id={presc.id} label={url ? 'Regenerar PDF' : 'Gerar PDF'} />
      </div>
    </main>
  );
}
