/**
 * GET /financeiro/convenios/arquivos/:fileId — download de arquivo TISS guardado (P12.7):
 * XML do lote, documento de retorno e XML de recurso de glosa.
 *
 * Sem URL pública nem assinada: o servidor revalida sessão, permissão e clínica, lê do
 * bucket privado, confere o SHA-256 (cifrado e conteúdo), decifra e entrega. Toda leitura
 * é auditada (concedida, adulterada ou ausente); arquivo adulterado ou ausente nunca é
 * entregue. Conhecer o identificador não basta: ele só é usado depois do gate e da
 * consulta presa à clínica da sessão, e negativa, ID de outra clínica e inexistente
 * devolvem o mesmo 404.
 *
 * Permissão: gerenciar financeiro (o XML tem a carteirinha e serve ao envio manual).
 * D24: baixar documento já emitido é preservação — segue com a assinatura suspensa.
 */
import { z } from 'zod';

import {
  readTissFile,
  TissFileIntegrityError,
  TissFileMissingError,
} from '@/contexts/health-insurance/downloads';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import { CONVENIOS_RULES } from '@/contexts/health-insurance/rights';
import { resourceGate } from '@/lib/auth/page-guard';
import { assertClinicalPdfDownloadAllowed } from '@/lib/auth/rate-limit';
import { supabaseTissObjectStore } from '@/lib/storage/tiss-files';

import { attachment, TISS_DOWNLOAD_HEADERS, tissNotFound, tissText } from '../../../../../_lib/tiss-download';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  // Arquivo emitido (XML do lote, recurso, PDFs): faturamento (matriz 4.3), a mesma população que
  // tinha gerenciar o financeiro (owner, gestor, financeiro). A recepção não tinha e não ganha (D-5).
  const gate = await resourceGate(CONVENIOS_RULES.seeValues);
  if (!gate) return tissNotFound();
  const parsed = z.uuid().safeParse((await params).fileId);
  if (!parsed.success) return tissNotFound();
  // Mesmo orçamento dos downloads de documento pós-autenticação (por usuário e por clínica).
  const limit = await assertClinicalPdfDownloadAllowed(gate.clinicId, gate.user.userId);
  if (!limit.ok) {
    return tissText(429, 'Muitos downloads em pouco tempo. Aguarde alguns minutos.', { 'Retry-After': '900' });
  }
  try {
    const file = await readTissFile(supabaseTissObjectStore(), {
      clinicId: gate.clinicId,
      fileId: parsed.data,
      userId: gate.user.userId,
      purpose: 'download_arquivo',
      requestContext: await requestContext(),
    });
    if (!file) return tissNotFound();
    const contentType =
      file.mediaType === 'application/xml' ? 'application/xml; charset=ISO-8859-1' : file.mediaType;
    return new Response(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        ...TISS_DOWNLOAD_HEADERS,
        'Content-Type': contentType,
        'Content-Disposition': attachment(file.fileName),
        'X-Content-SHA256': file.contentSha256,
      },
    });
  } catch (error) {
    if (error instanceof TissFileIntegrityError || error instanceof TissFileMissingError) {
      // Auditado e medido; o usuário não recebe arquivo corrompido nem detalhe técnico.
      return tissText(409, 'Este arquivo não pôde ser conferido e não foi entregue. A equipe do Qoro foi avisada.');
    }
    return tissText(503, 'Não foi possível acessar o arquivo agora. Tente de novo em instantes.');
  }
}
