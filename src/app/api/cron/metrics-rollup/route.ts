/**
 * GET /api/cron/metrics-rollup — consolida `system_metrics_daily` (C16, FASE 7).
 *
 * Recalcula os últimos dias (idempotente via UPSERT) agregando, por clínica e
 * por dia, as métricas de negócio/IA. Base histórica para aferir os SLOs de
 * docs/c16/slo.md. Janela default 3 dias (captura dados que chegam atrasados,
 * ex.: cash_flow_daily só fecha às 3:30); `?days=` ajusta (cap 35).
 *
 * Roda DEPOIS do cash-flow-rollup (revenue_received lê cash_flow_daily). Métricas
 * são EAV: adicionar uma nova = mais uma statement aqui, sem migration de coluna.
 *
 * Auth idêntica aos demais crons (Bearer CRON_SECRET + header Vercel não-fatal).
 */
import { sql, type SQL } from 'drizzle-orm';

import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { dbAdmin } from '@/lib/db';
import { withCron } from '@/lib/http/cron';
import { metrics } from '@/lib/observability/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_WINDOW_DAYS = 3;
const MAX_WINDOW_DAYS = 35;

/**
 * Cada métrica é um SELECT que produz (clinic_id, date, value). O wrapper faz o
 * UPSERT em system_metrics_daily com o metric_name literal. Recalcula a janela
 * inteira → idempotente (um dia recalculado neta o valor antigo).
 */
function buildMetrics(windowDays: number): Array<{ name: string; select: SQL }> {
  const since = sql`now() - (${windowDays}::int * interval '1 day')`;
  return [
    {
      name: 'patients_created',
      select: sql`SELECT clinic_id, created_at::date AS date, count(*)::numeric AS value
                    FROM patients
                   WHERE created_at >= ${since}
                   GROUP BY clinic_id, created_at::date`,
    },
    {
      name: 'appointments_scheduled',
      select: sql`SELECT clinic_id, scheduled_at::date AS date, count(*)::numeric AS value
                    FROM appointments
                   WHERE scheduled_at >= ${since}
                   GROUP BY clinic_id, scheduled_at::date`,
    },
    {
      name: 'ai_messages',
      select: sql`SELECT clinic_id, created_at::date AS date, count(*)::numeric AS value
                    FROM ai_messages
                   WHERE created_at >= ${since}
                   GROUP BY clinic_id, created_at::date`,
    },
    {
      name: 'ai_cost_usd',
      select: sql`SELECT clinic_id, created_at::date AS date, coalesce(sum(cost_usd), 0)::numeric AS value
                    FROM ai_messages
                   WHERE created_at >= ${since}
                   GROUP BY clinic_id, created_at::date`,
    },
    {
      name: 'revenue_received',
      select: sql`SELECT clinic_id, date, total_recebido::numeric AS value
                    FROM cash_flow_daily
                   WHERE date >= (${since})::date`,
    },
  ];
}

export const GET = withCron(
  {
    job: 'metrics-rollup',
    route: 'metrics-rollup',
    errorEvent: 'observability.metrics_rollup.error',
  },
  async (req) => {
    const url = new URL(req.url);
    const windowDays = Math.min(
      Math.max(Number(url.searchParams.get('days')) || DEFAULT_WINDOW_DAYS, 1),
      MAX_WINDOW_DAYS,
    );

    const byMetric: Record<string, number> = {};
    for (const m of buildMetrics(windowDays)) {
      const rows = (await dbAdmin.execute(
        sql`INSERT INTO system_metrics_daily (clinic_id, date, metric_name, value, updated_at)
            SELECT src.clinic_id, src.date, ${m.name}, src.value, now()
              FROM (${m.select}) AS src
            ON CONFLICT (clinic_id, date, metric_name) DO UPDATE SET
               value      = excluded.value,
               updated_at = now()
            RETURNING clinic_id`,
      )) as unknown as Array<{ clinic_id: string }>;
      byMetric[m.name] = rows.length;
    }

    metrics.emit('observability.metrics_rollup.run', { windowDays, byMetric });
    await recordHeartbeat('metrics-rollup', 'success', { windowDays, byMetric });
    return Response.json({ ok: true, windowDays, byMetric }, { status: 200 });
  },
);
