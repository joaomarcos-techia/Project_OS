/**
 * GET /financeiro/convenios/guias/:guideId/via — VIA DE ATENDIMENTO da guia emitida (D-5 fase 2):
 * o documento que a recepção imprime para a assinatura do paciente. Sem valores, fator, indicação
 * clínica nem observação; carteirinha MASCARADA (decisão do fundador de 17/11: o número completo
 * não entra em documento comum da recepção; quem precisa dele usa "Ver número", com finalidade e
 * auditoria).
 *
 * Quem lê: quem opera Convênios, quem vê o faturamento e a médica nas PRÓPRIAS guias (D-4:
 * executante ou solicitante, conferido aqui no servidor antes da leitura). Negativa, guia de outra
 * profissional, de outra clínica, não emitida ou inexistente = o mesmo 404. Sem URL pública, sem
 * cache; a leitura é a auditada do domínio (`guide_attendance_copy`, finalidade `via_atendimento`).
 * D24: imprimir o que já foi emitido é preservação (igual ao PDF oficial).
 */
import { z } from 'zod';

import {
  GuideAccessError,
  GuidePrintError,
  renderIssuedGuideAttendanceCopyPdf,
} from '@/contexts/health-insurance/downloads';
import { isGuideWithinScope } from '@/contexts/health-insurance/queries';
import { CONVENIOS_RULES, conveniosRights, guideScopeFor } from '@/contexts/health-insurance/rights';
import { resourceGate } from '@/lib/auth/page-guard';
import { assertClinicalPdfDownloadAllowed } from '@/lib/auth/rate-limit';
import { softwareIdentity } from '@/lib/software-identity';

import { attachment, TISS_DOWNLOAD_HEADERS, tissNotFound, tissText } from '../../../../../../_lib/tiss-download';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** P12.11: identificação do software no rodapé, sempre do build. */
const SOFTWARE = (() => {
  const id = softwareIdentity();
  return { vendor: id.vendor, name: id.name, version: id.version };
})();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ guideId: string }> },
): Promise<Response> {
  const gate = await resourceGate(CONVENIOS_RULES.attendanceCopy);
  if (!gate) return tissNotFound();
  const parsed = z.uuid().safeParse((await params).guideId);
  if (!parsed.success) return tissNotFound();
  const scope = guideScopeFor(conveniosRights(gate.user.permissions), gate.user.userId);
  if (!(await isGuideWithinScope(gate.clinicId, parsed.data, scope))) return tissNotFound();
  const limit = await assertClinicalPdfDownloadAllowed(gate.clinicId, gate.user.userId);
  if (!limit.ok) {
    return tissText(429, 'Muitos downloads em pouco tempo. Aguarde alguns minutos.', { 'Retry-After': '900' });
  }
  try {
    const pdf = await renderIssuedGuideAttendanceCopyPdf({
      clinicId: gate.clinicId,
      guideId: parsed.data,
      surface: 'rota_via_atendimento',
      software: SOFTWARE,
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
      return tissText(409, 'Esta revisão da guia foi emitida sem os dados do impresso. Reemita a guia para gerar a via.');
    }
    throw error;
  }
}
