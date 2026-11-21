/**
 * GET /financeiro/convenios/relatorios/csv?from=AAAA-MM-DD&to=AAAA-MM-DD[&insurerId=uuid] — CSV do
 * relatório por operadora e período (P9.10).
 *
 * Permissão: ver os valores do faturamento de Convênios (`seeValues`, a mesma da tela do relatório).
 * Sem ela, a mesma resposta 404 de qualquer recurso inexistente. A leitura roda sob a RLS da clínica
 * da sessão; operadora de outra clínica simplesmente não traz linha. Toda exportação é auditada.
 * Planilha segura: células que começariam fórmula viram texto; nada de paciente ou carteirinha.
 */
import { z } from 'zod';

import { CONVENIOS_RULES } from '@/contexts/health-insurance/rights';
import { exportInsurerReportCsv, InsurerReportError } from '@/contexts/health-insurance/reports';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import { resourceGate } from '@/lib/auth/page-guard';
import { assertClinicalPdfDownloadAllowed } from '@/lib/auth/rate-limit';

import { attachment, TISS_DOWNLOAD_HEADERS, tissNotFound, tissText } from '../../../../../_lib/tiss-download';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  insurerId: z.uuid().nullable(),
});

export async function GET(request: Request): Promise<Response> {
  const gate = await resourceGate(CONVENIOS_RULES.seeValues);
  if (!gate) return tissNotFound();
  const params = new URL(request.url).searchParams;
  const q = Query.safeParse({ from: params.get('from'), to: params.get('to'), insurerId: params.get('insurerId') || null });
  if (!q.success) return tissText(400, 'Período inválido: informe as datas no formato AAAA-MM-DD.');
  const limit = await assertClinicalPdfDownloadAllowed(gate.clinicId, gate.user.userId);
  if (!limit.ok) {
    return tissText(429, 'Muitos downloads em pouco tempo. Aguarde alguns minutos.', { 'Retry-After': '900' });
  }
  try {
    const out = await exportInsurerReportCsv(gate.clinicId, gate.user.userId, q.data, await requestContext());
    return new Response(out.csv, {
      status: 200,
      headers: {
        ...TISS_DOWNLOAD_HEADERS,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': attachment(out.fileName),
        'X-Report-Rows': String(out.rows),
      },
    });
  } catch (error) {
    if (error instanceof InsurerReportError) return tissText(error.code === 'too_large' ? 413 : 400, error.message);
    return tissText(503, 'Não foi possível gerar o relatório agora. Tente de novo em instantes.');
  }
}
