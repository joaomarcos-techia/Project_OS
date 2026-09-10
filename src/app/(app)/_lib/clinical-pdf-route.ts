import 'server-only';

import { z } from 'zod';

import { getMedicalDocumentPdfRef, getPrescriptionPdfRef } from '@/contexts/clinical/queries';
import { logAudit } from '@/lib/audit/log';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { resourceGate } from '@/lib/auth/page-guard';
import { assertClinicalPdfDownloadAllowed } from '@/lib/auth/rate-limit';
import { withTenant } from '@/lib/db/tenant';
import { downloadClinicalPdf } from '@/lib/storage/clinical';

type ClinicalPdfKind = 'document' | 'prescription';

const PDF_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/pdf',
  'Cross-Origin-Resource-Policy': 'same-origin',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
} as const;

function notFoundResponse(): Response {
  return new Response(null, {
    status: 404,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
    },
  });
}

/**
 * Serve PDF clínico sem expor signed URL do Storage. O identificador e o path
 * só são usados depois do gate e da consulta tenant-scoped; negativa, ID de
 * outro tenant e recurso inexistente devolvem o mesmo 404.
 */
export async function serveClinicalPdf(
  request: Request,
  rawId: string,
  kind: ClinicalPdfKind,
): Promise<Response> {
  const gate = await resourceGate([PERMISSIONS.VIEW_PRESCRIPTION]);
  if (!gate) return notFoundResponse();

  const parsed = z.string().uuid().safeParse(rawId);
  if (!parsed.success) return notFoundResponse();

  const rateLimit = await assertClinicalPdfDownloadAllowed(gate.clinicId, gate.user.userId);
  if (!rateLimit.ok) {
    return new Response('Muitos downloads em pouco tempo. Aguarde alguns minutos.', {
      status: 429,
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Type': 'text/plain; charset=utf-8',
        'Retry-After': '900',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  const record =
    kind === 'prescription'
      ? await getPrescriptionPdfRef(gate.clinicId, parsed.data)
      : await getMedicalDocumentPdfRef(gate.clinicId, parsed.data);
  if (!record?.pdfStoragePath) return notFoundResponse();

  const pdf = await downloadClinicalPdf(record.pdfStoragePath);
  const attachment = new URL(request.url).searchParams.get('download') === '1';
  const filename = `${kind === 'prescription' ? 'prescricao' : 'documento'}-${parsed.data}.pdf`;
  const context = await requestContext();

  await withTenant(gate.clinicId, (tx) =>
    logAudit(tx, {
      clinicId: gate.clinicId,
      userId: gate.user.userId,
      action: `clinical.${kind}.pdf_accessed`,
      resourceType: kind === 'prescription' ? 'prescription' : 'medical_document',
      resourceId: parsed.data,
      before: null,
      // Não registrar path, URL, paciente ou conteúdo clínico.
      after: { disposition: attachment ? 'attachment' : 'inline' },
      requestContext: context,
    }),
  );

  return new Response(pdf, {
    headers: {
      ...PDF_HEADERS,
      'Content-Disposition': `${attachment ? 'attachment' : 'inline'}; filename="${filename}"`,
    },
  });
}
