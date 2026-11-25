/**
 * GET /financeiro/convenios/comprovantes/:attachmentId — comprovante da autorização da operadora (P6.3).
 *
 * Quem lê: recepção (operar Convênios) ou faturamento (matriz 4.2, `readReceipt`). A leitura é a
 * AUDITADA do domínio (`readAuthorizationReceipt`): confere o SHA-256 do cifrado e do conteúdo e
 * registra o acesso; adulterado ou ausente nunca é entregue. Negado = 404 (sem oráculo de existência),
 * com o mesmo orçamento de downloads dos documentos (por usuário e por clínica).
 */
import { z } from 'zod';

import { AuthorizationReceiptUnavailableError, readAuthorizationReceipt } from '@/contexts/health-insurance/downloads';
import { CONVENIOS_RULES } from '@/contexts/health-insurance/rights';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import { resourceGate } from '@/lib/auth/page-guard';
import { assertClinicalPdfDownloadAllowed } from '@/lib/auth/rate-limit';
import { supabaseTissObjectStore } from '@/lib/storage/tiss-files';

import { attachment, TISS_DOWNLOAD_HEADERS, tissNotFound, tissText } from '../../../../../_lib/tiss-download';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
): Promise<Response> {
  const gate = await resourceGate(CONVENIOS_RULES.readReceipt);
  if (!gate) return tissNotFound();
  const parsed = z.uuid().safeParse((await params).attachmentId);
  if (!parsed.success) return tissNotFound();
  const limit = await assertClinicalPdfDownloadAllowed(gate.clinicId, gate.user.userId);
  if (!limit.ok) {
    return tissText(429, 'Muitos downloads em pouco tempo. Aguarde alguns minutos.', { 'Retry-After': '900' });
  }
  try {
    const read = await readAuthorizationReceipt(supabaseTissObjectStore(), {
      clinicId: gate.clinicId,
      attachmentId: parsed.data,
      userId: gate.user.userId,
      requestContext: await requestContext(),
    });
    if (!read) return tissNotFound();
    return new Response(new Uint8Array(read.bytes), {
      status: 200,
      headers: {
        ...TISS_DOWNLOAD_HEADERS,
        'Content-Type': read.mediaType,
        'Content-Disposition': attachment(read.fileName),
        'X-Content-SHA256': read.contentSha256,
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationReceiptUnavailableError && error.outcome !== 'storage_unavailable') {
      return tissText(409, 'Este comprovante não pôde ser conferido e não foi entregue. A equipe do Qoro foi avisada.');
    }
    return tissText(503, 'Não foi possível acessar o comprovante agora. Tente de novo em instantes.');
  }
}
