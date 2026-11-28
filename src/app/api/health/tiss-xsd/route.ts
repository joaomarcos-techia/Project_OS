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
 * `?probe=limits` acrescenta a sonda de limites (namespace, lote grande, timeout, teto de
 * memória e fila), com instâncias próprias do motor: é a prova de que os limites valem no
 * runtime efetivo da Preview. Só depois da credencial; custo limitado (ver a sonda).
 *
 * Auth idêntica a /api/health (MEDIUM-19): Bearer CRON_SECRET ou super_admin AAL2.
 * Sem credencial → 401 (evita profiling público). Nenhum dado de clínica é lido.
 */
import { tissXsdLimitsProbe, tissXsdSelfCheck } from '@/contexts/health-insurance';
import { healthAuthLevel } from '@/lib/http/health-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(req: Request): Promise<Response> {
  if ((await healthAuthLevel(req)) === 'denied') {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }
  const report = await tissXsdSelfCheck();
  const wantsLimits = new URL(req.url).searchParams.get('probe') === 'limits';
  const limits = wantsLimits && report.status === 'ok' ? await tissXsdLimitsProbe() : null;
  const ok = report.status === 'ok' && (!wantsLimits || limits?.status === 'ok');
  return Response.json(
    {
      ...report,
      ...(wantsLimits ? { limits } : {}),
      runtime: {
        node: process.version,
        region: process.env.VERCEL_REGION ?? null,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
        env: process.env.VERCEL_ENV ?? null,
      },
    },
    { status: ok ? 200 : 503, headers: NO_STORE },
  );
}
