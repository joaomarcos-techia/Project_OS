/**
 * GET /api/cron/cash-flow-rollup — consolida `cash_flow_daily` (C9).
 *
 * Recalcula os últimos dias (idempotente via UPSERT) agregando lançamentos
 * liquidados (`status='pago'`) por clínica e por dia de `paid_at`. Estornos
 * (status='estornado') saem das somas; como recalculamos a janela inteira, um
 * estorno recente neta o dia original (R2). Os números "de hoje" da UI são
 * calculados ao vivo (getCashFlowToday); esta tabela guarda o histórico fechado.
 *
 * Limitações documentadas (MVP): dia agregado em UTC (a UI usa tz da clínica);
 * estorno > janela de recálculo não neta dias antigos. v2 = event-sourcing.
 *
 * Auth idêntica aos demais crons (Bearer CRON_SECRET + header Vercel não-fatal).
 */
import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { assertCronRuntimeReady, env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_WINDOW_DAYS = 3;
const MAX_WINDOW_DAYS = 35;

function isAuthorized(req: Request): boolean {
  if (req.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) return false;
  const hasOriginHeader =
    req.headers.get('x-vercel-cron') !== null ||
    req.headers.get('x-vercel-cron-schedule') !== null;
  const allowNonVercel =
    process.env.OUTBOX_CRON_ALLOW_NON_VERCEL === 'true' || env.NODE_ENV !== 'production';
  if (!hasOriginHeader && !allowNonVercel) {
    metrics.emit('cron.origin_header_missing', { route: 'cash-flow-rollup' });
  }
  return true;
}

export async function GET(req: Request): Promise<Response> {
  assertCronRuntimeReady();
  if (!isAuthorized(req)) {
    metrics.emit('cron.unauthorized', { route: 'cash-flow-rollup' });
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const windowDays = Math.min(
    Math.max(Number(url.searchParams.get('days')) || DEFAULT_WINDOW_DAYS, 1),
    MAX_WINDOW_DAYS,
  );

  try {
    const result = (await dbAdmin.execute(
      sql`INSERT INTO cash_flow_daily (clinic_id, date, total_recebido, total_pago, saldo, updated_at)
          SELECT clinic_id,
                 (paid_at)::date AS date,
                 coalesce(sum(case when tipo = 'receber' then valor_pago else 0 end), 0) AS total_recebido,
                 coalesce(sum(case when tipo = 'pagar'   then valor_pago else 0 end), 0) AS total_pago,
                 coalesce(sum(case when tipo = 'receber' then valor_pago else -valor_pago end), 0) AS saldo,
                 now()
            FROM lancamentos
           WHERE status = 'pago'
             AND paid_at >= now() - (${windowDays}::int * interval '1 day')
           GROUP BY clinic_id, (paid_at)::date
          ON CONFLICT (clinic_id, date) DO UPDATE SET
             total_recebido = excluded.total_recebido,
             total_pago     = excluded.total_pago,
             saldo          = excluded.saldo,
             updated_at     = now()
          RETURNING clinic_id`,
    )) as unknown as Array<{ clinic_id: string }>;

    metrics.emit('financial.cash_flow_rollup.run', { rows: result.length, windowDays });
    return Response.json({ ok: true, rows: result.length, windowDays }, { status: 200 });
  } catch (err) {
    metrics.emit('financial.cash_flow_rollup.error', { error: err });
    return Response.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}
