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
import { SIGNUP_SESSION_CEILING, getSignupSessionPressure } from '@/contexts/onboarding';
import { healthAuthLevel } from '@/lib/http/health-auth';
import { appendOnlyHealth } from '@/lib/db/append-only-barrier';
import { checkExternals, type CheckStatus } from '@/lib/http/health-probes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SLO de fila (slo.md / GAP 3): pending mais antigo acima disso → degraded.
const PENDING_STUCK_S = 300;

/**
 * ADR-060 (O-2a) — pressão na tabela de sessões anônimas de cadastro.
 *
 * Degrada em 80% do teto, NÃO em 100%: o teto é o ponto em que o cadastro passa
 * a ser recusado, e um alerta que só dispara ali avisa depois da queda. 80% dá
 * margem para olhar antes de alguém deixar de conseguir se cadastrar.
 *
 * Este check existe aqui, e não como regra de limiar sobre linha de log, por
 * decisão registrada na ADR-060: probe HTTP de saúde é caminho de alerta que
 * JÁ funciona neste projeto (monitores no Better Stack). Criar um caminho novo
 * significaria apostar a contenção de um risco num mecanismo não exercitado.
 */
const SIGNUP_PRESSURE_DEGRADED_AT = Math.floor(SIGNUP_SESSION_CEILING * 0.8);

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

  // Pressão de cadastro — mesma regra do outbox: só consulta se o banco
  // respondeu, e falha de leitura já é sinal (degraded), não silêncio.
  let signupLive = 0;
  let signup: CheckStatus = db === 'down' ? 'down' : 'ok';
  if (db !== 'down') {
    try {
      const pressure = await getSignupSessionPressure();
      signupLive = pressure.live;
      signup = signupLive >= SIGNUP_PRESSURE_DEGRADED_AT ? 'degraded' : 'ok';
    } catch {
      signup = 'degraded';
    }
  }

  // S5 / ADR-075 — trilhas append-only conferidas pelo catálogo, só no modo profundo (o monitor usa `?strict=1`).
  // Instalada e adulterada = degraded; não instalada só vira motivo informativo (ver `appendOnlyHealth`).
  let auditTrails: CheckStatus = db === 'down' ? 'down' : 'ok';
  let auditTrailReasons: Record<string, string> = {};
  if (deep && db !== 'down') {
    const health = await appendOnlyHealth(
      async (text, params) =>
        (await dbAdmin.$client.unsafe(text, params as never[])) as unknown as Array<
          Record<string, unknown>
        >,
    );
    auditTrails = health.status;
    auditTrailReasons = health.reasons;
  }

  const ext = await checkExternals(deep);
  const checks: Record<
    'db' | 'gemini' | 'meta' | 'asaas' | 'redis' | 'outbox' | 'signup' | 'audit_trails',
    CheckStatus
  > = {
    db,
    gemini: ext.gemini,
    meta: ext.meta,
    asaas: ext.asaas,
    // M3: torna visível o fail-open do rate-limit — sob outage do Upstash o
    // sistema segue servindo sem proteção de brute-force, hoje em silêncio.
    redis: ext.redis,
    outbox,
    signup,
    audit_trails: auditTrails,
  };

  const status = aggregate(checks);
  const httpStatus = strict && status !== 'ok' ? 503 : 200;

  const body: Record<string, unknown> = {
    status,
    checks,
    ts: new Date().toISOString(),
  };
  // POR QUE no nível `monitoring` (e não só super_admin): este corpo é o que o
  // operador lê às 3h com o pager tocando. Sem o motivo, `asaas: degraded` não
  // distingue "Asaas caiu" de "nossa key está errada" — dois incidentes com
  // runbooks opostos. O reason é de baixa cardinalidade e não vaza credencial
  // (é `http_401`/`timeout`/`not_configured`, nunca a chave ou a URL).
  const reasons = {
    ...ext.reasons,
    ...Object.fromEntries(
      Object.entries(auditTrailReasons).map(([id, why]) => [`audit_trails.${id}`, why]),
    ),
  };
  if (deep && Object.keys(reasons).length > 0) {
    body.reasons = reasons;
  }
  // super_admin: SLIs de fila nomeados (outbox_depth/outbox_oldest_age) p/ debug.
  if (level === 'super_admin') {
    body.sli = {
      outbox_depth: outboxPending,
      outbox_oldest_age: outboxOldestAgeS,
      signup_sessions_live: signupLive,
      signup_sessions_ceiling: SIGNUP_SESSION_CEILING,
    };
  }

  return Response.json(body, { status: httpStatus });
}
