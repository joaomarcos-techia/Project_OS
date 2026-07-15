/**
 * GET /api/health/auth-hook
 *
 * Healthcheck D11 do custom_access_token_hook. Invoca auth_hook_selftest()
 * (SECURITY DEFINER em 0003) e retorna 200 + {ok:true} OU 500 + erro.
 *
 * Consumido por monitoramento externo (UptimeRobot em C16). Em produção,
 * alarme se 3 hits consecutivos falharem.
 *
 * NOTA: este endpoint vive em `/api/health/` — não em `/api/admin/` —
 * para ficar acessível sem autenticação. Não vaza dados sensíveis (apenas
 * confirma que a função está executável + lista de keys do payload).
 *
 * Usa dbAdmin (BYPASSRLS) para invocar auth_hook_selftest sem precisar de
 * JWT. ESLint allowlist (eslint.config.mjs guard #2 ignores) cobre
 * `src/app/api/health/**` em C4 — endpoint não autenticado, mas só roda RPC
 * selftest (não expõe RLS bypass).
 */
import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    const res = await dbAdmin.execute(sql`SELECT public.auth_hook_selftest() AS r`);
    const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
      r: { ok?: boolean; error?: string; sqlstate?: string };
    }>;
    const payload = rows[0]?.r ?? {};

    if (payload.ok === true) {
      return Response.json({ ok: true, payload }, { status: 200 });
    }
    return Response.json({ ok: false, payload }, { status: 500 });
  } catch (e) {
    // V11 (auditoria de segurança): endpoint NÃO autenticado — não devolver
    // `e.message` cru (pode vazar schema/role em mensagens de erro do Postgres).
    // Corpo genérico ao chamador; detalhe só no observability.
    logger.error('health.auth_hook.error', {
      message: e instanceof Error ? e.message : String(e),
    });
    return Response.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}
