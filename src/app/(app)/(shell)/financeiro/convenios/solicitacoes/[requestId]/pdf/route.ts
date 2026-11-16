/**
 * GET /financeiro/convenios/solicitacoes/:requestId/pdf — PDF oficial da SOLICITAÇÃO SP/SADT
 * (P6.2): o pedido de autorização como foi CONGELADO na geração (XML validado no XSD + PDF
 * no modelo oficial, cifrados no armazenamento privado). A rota só LÊ o arquivo guardado —
 * nunca remonta com o cadastro de hoje —, confere o SHA-256 (cifrado e conteúdo) e audita a
 * leitura (concedida, adulterada ou ausente).
 *
 * Mesmo modelo de proteção do PDF da guia: gate de sessão, permissão e clínica; negativa,
 * ID de outra clínica e inexistente = o mesmo 404; sem URL pública; sem cache; limite de
 * downloads por usuário e clínica. Estado: solicitação que não exige autorização (não há
 * pedido à operadora) ou cujo documento ainda não foi gerado = 409 com a orientação.
 * D24: reimprimir o que já foi gerado é preservação (segue com a assinatura suspensa).
 */
import { z } from 'zod';

import {
  findSadtRequestDocument,
  readTissFile,
  TissFileIntegrityError,
  TissFileMissingError,
} from '@/contexts/health-insurance/downloads';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import { CONVENIOS_RULES } from '@/contexts/health-insurance/rights';
import { resourceGate } from '@/lib/auth/page-guard';
import { assertClinicalPdfDownloadAllowed } from '@/lib/auth/rate-limit';
import { supabaseTissObjectStore } from '@/lib/storage/tiss-files';

import {
  attachment,
  TISS_DOWNLOAD_HEADERS,
  tissNotFound,
  tissText,
} from '../../../../../../_lib/tiss-download';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  // Documento da solicitação SP/SADT: recepção (operar) ou faturamento (matriz 4.2).
  const gate = await resourceGate(CONVENIOS_RULES.readReceipt);
  if (!gate) return tissNotFound();
  const parsed = z.uuid().safeParse((await params).requestId);
  if (!parsed.success) return tissNotFound();
  const limit = await assertClinicalPdfDownloadAllowed(gate.clinicId, gate.user.userId);
  if (!limit.ok) {
    return tissText(429, 'Muitos downloads em pouco tempo. Aguarde alguns minutos.', {
      'Retry-After': '900',
    });
  }
  try {
    const doc = await findSadtRequestDocument(gate.clinicId, parsed.data, gate.user.userId);
    if (!doc) return tissNotFound();
    if (doc.state === 'no_authorization') {
      return tissText(
        409,
        'Esta solicitação não exige autorização da operadora: não há pedido oficial a imprimir. O atendimento segue direto para a guia SP/SADT.',
      );
    }
    if (doc.state === 'not_generated') {
      return tissText(
        409,
        'O documento oficial desta solicitação ainda não foi gerado. Gere-o na página da solicitação (depois da conferência).',
      );
    }
    const file = await readTissFile(supabaseTissObjectStore(), {
      clinicId: gate.clinicId,
      fileId: doc.pdfFileId,
      userId: gate.user.userId,
      purpose: 'download_arquivo',
      requestContext: await requestContext(),
    });
    if (!file) return tissNotFound();
    const inline = new URL(request.url).searchParams.get('download') !== '1';
    return new Response(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        ...TISS_DOWNLOAD_HEADERS,
        'Content-Type': 'application/pdf',
        'Content-Disposition': inline
          ? `inline; filename="${file.fileName}"`
          : attachment(file.fileName),
        'X-Content-SHA256': file.contentSha256,
      },
    });
  } catch (error) {
    if (error instanceof TissFileIntegrityError || error instanceof TissFileMissingError) {
      return tissText(
        409,
        'Este documento não pôde ser conferido e não foi entregue. A equipe do Qoro foi avisada.',
      );
    }
    return tissText(503, 'Não foi possível acessar o documento agora. Tente de novo em instantes.');
  }
}
