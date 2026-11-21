/**
 * GET /financeiro/convenios/guias/:guideId/pdf — PDF oficial da guia (P7.6/P12.7), gerado
 * na hora a partir do SNAPSHOT congelado na emissão (nunca do cadastro atual), pela leitura
 * auditada (`guide_pdf`, finalidade "impressão da guia"), com o software e o número do
 * build no rodapé (req. 36).
 *
 * Mesmo modelo de proteção do download de arquivo: gate de sessão, permissão e clínica;
 * negativa, ID de outra clínica, guia não emitida e inexistente = o mesmo 404; sem URL
 * pública; sem cache. D24: imprimir guia já emitida é preservação.
 */
import { z } from 'zod';

import {
  GuideAccessError,
  GuidePrintError,
  renderIssuedGuidePdf,
} from '@/contexts/health-insurance/downloads';
import { CONVENIOS_RULES } from '@/contexts/health-insurance/rights';
import { resourceGate } from '@/lib/auth/page-guard';
import { assertClinicalPdfDownloadAllowed } from '@/lib/auth/rate-limit';

import { attachment, TISS_DOWNLOAD_HEADERS, tissNotFound, tissText } from '../../../../../../_lib/tiss-download';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Versão do build no rodapé (rastreabilidade do software, req. 36). */
const BUILD = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ guideId: string }> },
): Promise<Response> {
  // PDF completo da guia emitida (D-5 fase 3): só quem vê o faturamento; a recepção usa a via.
  const gate = await resourceGate(CONVENIOS_RULES.emittedDocuments);
  if (!gate) return tissNotFound();
  const parsed = z.uuid().safeParse((await params).guideId);
  if (!parsed.success) return tissNotFound();
  const limit = await assertClinicalPdfDownloadAllowed(gate.clinicId, gate.user.userId);
  if (!limit.ok) {
    return tissText(429, 'Muitos downloads em pouco tempo. Aguarde alguns minutos.', { 'Retry-After': '900' });
  }
  try {
    const pdf = await renderIssuedGuidePdf({
      clinicId: gate.clinicId,
      guideId: parsed.data,
      surface: 'rota_pdf_guia',
      software: { name: 'Qoro', version: BUILD },
    });
    const inline = new URL(request.url).searchParams.get('download') !== '1';
    return new Response(new Uint8Array(pdf.pdf), {
      status: 200,
      headers: {
        ...TISS_DOWNLOAD_HEADERS,
        'Content-Type': 'application/pdf',
        'Content-Disposition': inline ? `inline; filename="${pdf.fileName}"` : attachment(pdf.fileName),
      },
    });
  } catch (error) {
    if (error instanceof GuideAccessError) return tissNotFound();
    if (error instanceof GuidePrintError) {
      return tissText(
        409,
        'Esta revisão da guia foi emitida sem os dados do impresso. Reemita a guia para gerar o PDF oficial.',
      );
    }
    throw error;
  }
}
