/**
 * GET /api/health — healthcheck unificado (C16, FASE 5).
 *
 * Agrega o estado das dependências num único endpoint para uptime monitors e
 * dashboards. Complementa (não substitui) /api/health/outbox (detalhe operacional)
 * e /api/health/auth-hook (self-test do Auth Hook).
 *
 *   { status: 'ok'|'degraded'|'down', checks: { db, gemini, meta, asaas, redis, outbox } }
 *
 * Semântica (slo.md):
 *   - DOWN     → banco indisponível (única dependência cuja falha derruba tudo).
 *   - DEGRADED → dependência externa mal-configurada OU INALCANÇÁVEL, ou outbox
 *                acima do SLO (oldest_pending_age_s > 300s).
 *   - OK       → tudo dentro do alvo.
 *
 * DOIS NÍVEIS de check externo (C2 — corrigido em 2026-07-18):
 *   - RASO (default): presença de env, zero rede. Poll barato.
 *   - PROFUNDO (`?deep=1`, e implícito em `?strict=1`/`?alert=1`):
 *     alcançabilidade real com timeout curto + cache de 60s ([health-probes.ts]).
 *
 * Antes, TODOS os checks externos eram presença de env: um provedor fora do ar
 * com a key configurada reportava `ok`, e o uptime monitor ficava verde durante
 * um apagão do WhatsApp. Como o monitor usa `?strict=1`, é ele quem paga o probe
 * real — e era exatamente ele que precisava enxergar.
 *
 * `?strict=1`/`?alert=1` → 503 quando não-ok (monitores que só checam status code).
 *
 * Auth idêntica ao /api/health/outbox (MEDIUM-19): Bearer CRON_SECRET = monitoring;
 * super_admin AAL2 = detalhe extra. Sem credencial → 401 (evita profiling público).
 */
// dbAdmin permitido aqui via guard #2 (eslint.config.mjs): healthcheck cross-tenant.
import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { assertCronRuntimeReady } from '@/lib/env';
import { healthAuthLevel } from '@/lib/http/health-auth';
import { checkExternals, type CheckStatus } from '@/lib/http/health-probes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SLO de fila (slo.md / GAP 3): pending mais antigo acima disso → degraded.
const PENDING_STUCK_S = 300;

/** `db` é a única dependência cuja falha é DOWN (resto degrada). */
async function checkDb(): Promise<CheckStatus> {
  try {
    await dbAdmin.execute(sql`SELECT 1`);
    return 'ok';
  } catch {
    return 'down';
  }
}

function aggregate(checks: Record<string, CheckStatus>): CheckStatus {
  const values = Object.values(checks);
  if (values.includes('down')) return 'down';
  if (values.includes('degraded')) return 'degraded';
  return 'ok';
}

export async function GET(req: Request): Promise<Response> {
  assertCronRuntimeReady();
  const level = await healthAuthLevel(req);
  if (level === 'denied') {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const qp = new URL(req.url).searchParams;
  const strict = qp.get('strict') === '1' || qp.get('alert') === '1';
  // C2: `strict` IMPLICA `deep`. O monitor externo usa `?strict=1`, então é ele
  // quem paga o probe real — e é justamente ele que precisava enxergar o outage.
  // O poll manual/barato sem query continua raso.
  const deep = strict || qp.get('deep') === '1';

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

  const ext = await checkExternals(deep);
  const checks: Record<'db' | 'gemini' | 'meta' | 'asaas' | 'redis' | 'outbox', CheckStatus> = {
    db,
    gemini: ext.gemini,
    meta: ext.meta,
    asaas: ext.asaas,
    // M3: torna visível o fail-open do rate-limit — sob outage do Upstash o
    // sistema segue servindo sem proteção de brute-force, hoje em silêncio.
    redis: ext.redis,
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
