/**
 * GET /api/health/tiss-xsd — prontidão do validador XSD TISS no runtime do app (P9.2).
 *
 * Roda o autoteste do motor (xmllint-wasm 5.3.0 + XSD oficiais 4.03.00, conferidos por
 * SHA-256) com dado SINTÉTICO: válido aceito, inválido recusado, hostil recusado antes
 * do parser. 200 quando tudo confere; 503 quando o motor não sobe ou erra (o lote
 * nunca é exportado nesse estado). É a prova, no MESMO build que vai para a Vercel, de
 * que o pacote, o `.wasm` e os XSD entraram no bundle (ver `outputFileTracingIncludes`
 * no next.config.ts) — o `security:http` do CI chama esta rota contra o `next start`.
 *
 * Auth idêntica a /api/health (MEDIUM-19): Bearer CRON_SECRET ou super_admin AAL2.
 * Sem credencial → 401 (evita profiling público). Nenhum dado de clínica é lido.
 */
import { tissXsdSelfCheck } from '@/contexts/health-insurance';
import { healthAuthLevel } from '@/lib/http/health-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  if ((await healthAuthLevel(req)) === 'denied') {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  }
  const report = await tissXsdSelfCheck();
  return Response.json(report, {
    status: report.status === 'ok' ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
