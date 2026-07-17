/**
 * GET /api/health/auth-hook
 *
 * Healthcheck D11 do custom_access_token_hook. Invoca auth_hook_selftest()
 * (SECURITY DEFINER em 0003) e retorna 200 + {ok:true} OU 500 + erro.
 *
 * Consumido por monitoramento externo (UptimeRobot/Better Stack em C16). Em
 * produção, alarme se 3 hits consecutivos falharem.
 *
 * AUTH (A1 — auditoria de APIs): exige Bearer `CRON_SECRET` ou super_admin AAL2,
 * igual às rotas irmãs `/api/health` e `/api/health/outbox` — era a única de
 * `/api/health/**` anônima. O `payload` do selftest carrega `error`/`sqlstate` do
 * Postgres no caminho de falha; sem auth, isso era diagnóstico interno servido à
 * internet, e cada hit anônimo custava um round-trip na conexão privilegiada.
 * `runbooks/production-readiness.md` §5.2 já especificava "mesmo header Bearer" —
 * o código é que não implementava.
 *
 * DOIS NÍVEIS **no caminho de FALHA** (MEDIUM-19, como o /api/health/outbox): o
 * `payload` de erro carrega `sqlstate`/mensagem do Postgres, então `monitoring`
 * (Bearer) recebe só `error: 'selftest_failed'` — suficiente para o monitor alarmar —
 * e o detalhe fica para `super_admin` (AAL2). Secret vazado não vira janela de
 * profiling do banco. No caminho de SUCESSO ambos recebem o payload (`claims_keys`,
 * `elapsed_ms`): é o que `runbooks/c3-validation.md` §4 manda conferir, e não há o
 * que vazar quando o hook está são.
 *
 * Usa dbAdmin (BYPASSRLS) para invocar auth_hook_selftest sem precisar de
 * JWT. ESLint allowlist (eslint.config.mjs guard #2 ignores) cobre
 * `src/app/api/health/**` em C4 — só roda a RPC de selftest (não expõe RLS bypass).
 */
import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { healthAuthLevel } from '@/lib/http/health-auth';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const level = await healthAuthLevel(req);
  if (level === 'denied') {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const res = await dbAdmin.execute(sql`SELECT public.auth_hook_selftest() AS r`);
    const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
      r: { ok?: boolean; error?: string; sqlstate?: string };
    }>;
    const payload = rows[0]?.r ?? {};

    if (payload.ok === true) {
      return Response.json({ ok: true, payload }, { status: 200 });
    }

    // Dois níveis, igual à rota irmã /api/health/outbox (MEDIUM-19): o `payload` de
    // falha carrega `error`/`sqlstate` do Postgres, que é diagnóstico interno. Quem
    // tem só o CRON_SECRET precisa saber SE está quebrado (o status basta para o
    // monitor alarmar); o detalhe é para super_admin. Assim um secret vazado não
    // vira janela de profiling do banco — mesmo racional pelo qual o outbox reserva
    // `failures_by_type` ao super_admin.
    logger.error('health.auth_hook.selftest_failed', { payload });
    return Response.json(
      level === 'super_admin' ? { ok: false, payload } : { ok: false, error: 'selftest_failed' },
      { status: 500 },
    );
  } catch (e) {
    // V11 (auditoria de segurança): não devolver `e.message` cru — pode vazar
    // schema/role em mensagens de erro do Postgres. Corpo genérico ao chamador;
    // detalhe só no observability. Vale mesmo atrás de auth: o `payload` acima é
    // diagnóstico estruturado que a RPC devolve de propósito; uma exceção não
    // capturada é texto de driver, que não tem contrato.
    logger.error('health.auth_hook.error', {
      message: e instanceof Error ? e.message : String(e),
    });
    return Response.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}
