/**
 * GET /api/health/outbox
 *
 * Healthcheck operacional. Dois níveis de acesso (MEDIUM-19):
 *
 *   1. Bearer CRON_SECRET → resposta MÍNIMA (counts + ages agregados).
 *      Suficiente para monitoramento externo (UptimeRobot, healthcheck).
 *      NÃO expõe failures_by_type — atacante com secret vazado não profile
 *      o sistema por tenant/event_type.
 *
 *   2. super_admin JWT (AAL2) → resposta COMPLETA com failures_by_type.
 *      Para dashboard operacional / debug ad-hoc. Validação via
 *      requireSuperAdmin que já verifica MFA.
 *
 * Bearer + Vercel header check (mesma defesa do cron route — HIGH-08).
 */
// dbAdmin é permitido aqui via ignores de guard #2 (eslint.config.mjs):
// healthcheck precisa de queries cross-tenant agregadas.
import { sql } from 'drizzle-orm';

import {
  getCurrentUser,
} from '@/lib/auth/tenant-context';
import { dbAdmin } from '@/lib/db';
import { env, assertCronRuntimeReady } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Limiares de degradação (gap 4.2). Conservadores: o worker roda a cada 1min.
const PENDING_STUCK_S = 300; // pending parado > 5min → worker provavelmente caído
const PROCESSING_STUCK_S = 600; // processing > 10min → handler travado / janitor não reclamou

type OutboxCounts = {
  pending: number;
  processing: number;
  failed: number;
  // F-03: terminally skipped events (in catalog, no handler). `skipped > 0` in
  // prod is an ANOMALY to alert on (a handler expected but not registered / a
  // deploy regression). Exposed at the monitoring level so an external monitor
  // can alarm without super_admin access.
  skipped: number;
  oldest_pending_age_s: number;
  oldest_processing_age_s: number;
  oldest_failed_age_s: number;
};

type FailureRow = {
  event_type: string;
  error_code: string | null;
  count: number;
};

type AuditRow = { default_count: number };

type IdempotencyRow = {
  in_flight: number;
  expired: number;
  in_flight_orphans_1h: number;
};

async function authLevel(req: Request): Promise<'public' | 'monitoring' | 'super_admin' | 'denied'> {
  // super_admin path via cookies → privileged.
  // Try super_admin first because if they're logged in, give them full detail.
  try {
    const user = await getCurrentUser();
    if (user?.isSuperAdmin && user.aal === 'aal2') return 'super_admin';
  } catch {
    // ignore, fall through to bearer check
  }

  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${env.CRON_SECRET}`) return 'denied';

  // F-09: the Bearer CRON_SECRET is the control for this READ-ONLY counts
  // endpoint. Previously it ALSO required the `x-vercel-cron` header in prod —
  // but this endpoint is meant for external monitors (UptimeRobot), which cannot
  // send a Vercel-injected header, so that check was self-defeating AND relied on
  // an undocumented header. Bearer alone → monitoring level.
  return 'monitoring';
}

export async function GET(req: Request): Promise<Response> {
  assertCronRuntimeReady();
  const level = await authLevel(req);
  if (level === 'denied') {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  // `?strict=1` (ou `?alert=1`): retorna 503 quando degradado, para monitores
  // que só checam status code alarmarem sem parsear JSON (gap 4.2).
  const qp = new URL(req.url).searchParams;
  const strict = qp.get('strict') === '1' || qp.get('alert') === '1';

  try {
    const outboxRes = await dbAdmin.execute<OutboxCounts>(sql`
      SELECT
        count(*) FILTER (WHERE status = 'pending')::int                                AS pending,
        count(*) FILTER (WHERE status = 'processing')::int                             AS processing,
        count(*) FILTER (WHERE status = 'failed')::int                                 AS failed,
        count(*) FILTER (WHERE status = 'skipped')::int                                AS skipped,
        coalesce(extract(epoch FROM (now() - min(created_at)))::int, 0)
          FILTER (WHERE status = 'pending')                                            AS oldest_pending_age_s,
        coalesce(extract(epoch FROM (now() - min(processing_started_at)))::int, 0)
          FILTER (WHERE status = 'processing')                                         AS oldest_processing_age_s,
        coalesce(extract(epoch FROM (now() - min(first_failed_at)))::int, 0)
          FILTER (WHERE status = 'failed')                                             AS oldest_failed_age_s
      FROM outbox
    `);

    const auditRes = await dbAdmin.execute<AuditRow>(sql`
      SELECT count(*)::int AS default_count FROM audit_events_default
    `);

    const idemRes = await dbAdmin.execute<IdempotencyRow>(sql`
      SELECT
        count(*) FILTER (WHERE response IS NULL)::int                           AS in_flight,
        count(*) FILTER (WHERE expires_at < now())::int                         AS expired,
        count(*) FILTER (
          WHERE response IS NULL AND created_at < now() - interval '1 hour'
        )::int                                                                  AS in_flight_orphans_1h
      FROM idempotency_keys
    `);

    const outbox = outboxRes[0] ?? {
      pending: 0, processing: 0, failed: 0, skipped: 0,
      oldest_pending_age_s: 0, oldest_processing_age_s: 0, oldest_failed_age_s: 0,
    };
    const idempotency = idemRes[0] ?? { in_flight: 0, expired: 0, in_flight_orphans_1h: 0 };
    const defaultPartitionRows = auditRes[0]?.default_count ?? 0;

    // Gap 4.2: condições operacionais que merecem alerta. `degraded` + `alarms`
    // são aditivos (ok continua true = endpoint respondeu); `?strict=1` vira 503.
    const alarms: string[] = [];
    if (outbox.failed > 0) alarms.push(`outbox_failed=${outbox.failed}`);
    if (outbox.skipped > 0) alarms.push(`outbox_skipped=${outbox.skipped}`);
    if (outbox.oldest_pending_age_s > PENDING_STUCK_S) alarms.push(`pending_age=${outbox.oldest_pending_age_s}s`);
    if (outbox.oldest_processing_age_s > PROCESSING_STUCK_S) alarms.push(`processing_age=${outbox.oldest_processing_age_s}s`);
    if (idempotency.in_flight_orphans_1h > 0) alarms.push(`idem_orphans=${idempotency.in_flight_orphans_1h}`);
    if (defaultPartitionRows > 0) alarms.push(`audit_default_rows=${defaultPartitionRows}`);
    const degraded = alarms.length > 0;
    const httpStatus = strict && degraded ? 503 : 200;

    const base = {
      ok: true,
      degraded,
      alarms,
      outbox,
      audit: { default_partition_rows: defaultPartitionRows },
      idempotency,
      ts: new Date().toISOString(),
    };

    if (level === 'monitoring') {
      // Sem failures_by_type. Indica para o operador que está acessível via
      // super_admin para mais detalhe.
      return Response.json({ ...base, level: 'monitoring' }, { status: httpStatus });
    }

    // super_admin level — detalhe completo
    const failures = await dbAdmin.execute<FailureRow>(sql`
      SELECT event_type, error_code, count(*)::int AS count
        FROM outbox
       WHERE status = 'failed'
         AND last_failed_at > now() - interval '24 hours'
       GROUP BY event_type, error_code
       ORDER BY count DESC
       LIMIT 20
    `);

    // F-03: which event_types are being terminally skipped (no handler). A
    // non-empty list is the signal to investigate (handler expected but absent).
    const skipped = await dbAdmin.execute<{ event_type: string; count: number }>(sql`
      SELECT event_type, count(*)::int AS count
        FROM outbox
       WHERE status = 'skipped'
       GROUP BY event_type
       ORDER BY count DESC
       LIMIT 20
    `);

    return Response.json(
      {
        ...base,
        level: 'super_admin',
        failures_by_type: [...failures],
        skipped_by_type: [...skipped],
      },
      { status: httpStatus },
    );
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
