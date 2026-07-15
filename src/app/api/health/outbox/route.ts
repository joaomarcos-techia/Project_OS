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
 * Auth em [health-auth.ts]. Só Bearer/super_admin — sem o header `x-vercel-cron`
 * do caminho de cron: este endpoint existe para monitor externo, que não tem como
 * enviá-lo (F-09).
 */
// dbAdmin é permitido aqui via ignores de guard #2 (eslint.config.mjs):
// healthcheck precisa de queries cross-tenant agregadas.
import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { healthAuthLevel } from '@/lib/http/health-auth';
import { toErrorResponse } from '@/lib/http/error-response';
import { assertCronRuntimeReady } from '@/lib/env';
import { logger } from '@/lib/observability/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Limiares de degradação (gap 4.2). Conservadores: o worker roda a cada 1min.
const PENDING_STUCK_S = 300; // pending parado > 5min → worker provavelmente caído
const PROCESSING_STUCK_S = 600; // processing > 10min → handler travado / janitor não reclamou
const AUDIT_DEFAULT_MAX = 1000; // linhas na default acima disso → provisioning realmente quebrado

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

export async function GET(req: Request): Promise<Response> {
  assertCronRuntimeReady();
  const level = await healthAuthLevel(req);
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
        -- FILTER aplica ao AGREGADO (min), não ao coalesce — senão "syntax error at
        -- or near FILTER". min(col) FILTER (...) = menor valor só entre as linhas do status.
        coalesce(extract(epoch FROM (now() - min(created_at) FILTER (WHERE status = 'pending')))::int, 0)
          AS oldest_pending_age_s,
        coalesce(extract(epoch FROM (now() - min(processing_started_at) FILTER (WHERE status = 'processing')))::int, 0)
          AS oldest_processing_age_s,
        coalesce(extract(epoch FROM (now() - min(first_failed_at) FILTER (WHERE status = 'failed')))::int, 0)
          AS oldest_failed_age_s
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
    if (outbox.oldest_pending_age_s > PENDING_STUCK_S) alarms.push(`pending_age=${outbox.oldest_pending_age_s}s`);
    if (outbox.oldest_processing_age_s > PROCESSING_STUCK_S) alarms.push(`processing_age=${outbox.oldest_processing_age_s}s`);
    if (idempotency.in_flight_orphans_1h > 0) alarms.push(`idem_orphans=${idempotency.in_flight_orphans_1h}`);
    if (defaultPartitionRows > AUDIT_DEFAULT_MAX) alarms.push(`audit_default_rows=${defaultPartitionRows}`);
    // `skipped` NÃO alarma: muitos eventos são legitimamente "producer ahead of
    // consumer" (ex.: scheduling.appointment.cancelled sem handler até C9). Fica
    // visível no corpo (outbox.skipped) p/ inspeção, mas não dispara degraded/503.
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
    // B1: envelope genérico + trace_id. O erro cru ia para o corpo — atrás de auth
    // privilegiada, mas ainda expondo internals do driver/Postgres a quem opera.
    logger.error('health.outbox.error', {
      message: err instanceof Error ? err.message : String(err),
    });
    return toErrorResponse(err);
  }
}
