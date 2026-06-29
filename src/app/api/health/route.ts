/**
 * GET /api/health — healthcheck unificado (C16, FASE 5).
 *
 * Agrega o estado das dependências num único endpoint para uptime monitors e
 * dashboards. Complementa (não substitui) /api/health/outbox (detalhe operacional)
 * e /api/health/auth-hook (self-test do Auth Hook).
 *
 *   { status: 'ok'|'degraded'|'down', checks: { db, gemini, meta, asaas, outbox } }
 *
 * Semântica (slo.md):
 *   - DOWN     → banco indisponível (única dependência cuja falha derruba tudo).
 *   - DEGRADED → dependência externa mal-configurada OU outbox acima do SLO
 *                (oldest_pending_age_s > 300s).
 *   - OK       → tudo dentro do alvo.
 *
 * Checks externos são LEVES (validação de config/token, não chamadas caras) para
 * não martelar/custear provedores a cada poll de 5min. `?strict=1`/`?alert=1` →
 * 503 quando não-ok (monitores que só checam status code).
 *
 * Auth idêntica ao /api/health/outbox (MEDIUM-19): Bearer CRON_SECRET = monitoring;
 * super_admin AAL2 = detalhe extra. Sem credencial → 401 (evita profiling público).
 */
// dbAdmin permitido aqui via guard #2 (eslint.config.mjs): healthcheck cross-tenant.
import { sql } from 'drizzle-orm';

import { getCurrentUser } from '@/lib/auth/tenant-context';
import { dbAdmin } from '@/lib/db';
import { assertCronRuntimeReady, env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SLO de fila (slo.md / GAP 3): pending mais antigo acima disso → degraded.
const PENDING_STUCK_S = 300;

type CheckStatus = 'ok' | 'degraded' | 'down';

async function authLevel(req: Request): Promise<'monitoring' | 'super_admin' | 'denied'> {
  // super_admin primeiro: se logado, devolve detalhe completo.
  try {
    const user = await getCurrentUser();
    if (user?.isSuperAdmin && user.aal === 'aal2') return 'super_admin';
  } catch {
    // ignore — cai no bearer
  }
  if (req.headers.get('authorization') === `Bearer ${env.CRON_SECRET}`) return 'monitoring';
  return 'denied';
}

/** `db` é a única dependência cuja falha é DOWN (resto degrada). */
async function checkDb(): Promise<CheckStatus> {
  try {
    await dbAdmin.execute(sql`SELECT 1`);
    return 'ok';
  } catch {
    return 'down';
  }
}

/** Check leve de config: provedor configurado → ok; ausente → degraded. */
function checkConfig(present: boolean): CheckStatus {
  return present ? 'ok' : 'degraded';
}

function aggregate(checks: Record<string, CheckStatus>): CheckStatus {
  const values = Object.values(checks);
  if (values.includes('down')) return 'down';
  if (values.includes('degraded')) return 'degraded';
  return 'ok';
}

export async function GET(req: Request): Promise<Response> {
  assertCronRuntimeReady();
  const level = await authLevel(req);
  if (level === 'denied') {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const qp = new URL(req.url).searchParams;
  const strict = qp.get('strict') === '1' || qp.get('alert') === '1';

  const db = await checkDb();

  // SLIs de fila (GAP 3) — só consulta se o banco respondeu.
  let outboxPending = 0;
  let outboxOldestAgeS = 0;
  let outbox: CheckStatus = db === 'down' ? 'down' : 'ok';
  if (db !== 'down') {
    try {
      const rows = await dbAdmin.execute<{ pending: number; oldest_pending_age_s: number }>(sql`
        SELECT
          count(*) FILTER (WHERE status = 'pending')::int AS pending,
          coalesce(
            extract(epoch FROM (now() - min(created_at) FILTER (WHERE status = 'pending')))::int,
            0
          ) AS oldest_pending_age_s
        FROM outbox
      `);
      outboxPending = rows[0]?.pending ?? 0;
      outboxOldestAgeS = rows[0]?.oldest_pending_age_s ?? 0;
      outbox = outboxOldestAgeS > PENDING_STUCK_S ? 'degraded' : 'ok';
    } catch {
      outbox = 'degraded';
    }
  }

  const checks: Record<'db' | 'gemini' | 'meta' | 'asaas' | 'outbox', CheckStatus> = {
    db,
    gemini: checkConfig(Boolean(env.GEMINI_API_KEY)),
    meta: checkConfig(Boolean(env.META_APP_SECRET)),
    asaas: checkConfig(Boolean(env.ASAAS_API_KEY)),
    outbox,
  };

  const status = aggregate(checks);
  const httpStatus = strict && status !== 'ok' ? 503 : 200;

  const body: Record<string, unknown> = {
    status,
    checks,
    ts: new Date().toISOString(),
  };
  // super_admin: SLIs de fila nomeados (outbox_depth/outbox_oldest_age) p/ debug.
  if (level === 'super_admin') {
    body.sli = {
      outbox_depth: outboxPending,
      outbox_oldest_age: outboxOldestAgeS,
    };
  }

  return Response.json(body, { status: httpStatus });
}
