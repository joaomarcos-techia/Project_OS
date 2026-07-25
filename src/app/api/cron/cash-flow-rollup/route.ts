/**
 * GET /api/cron/cash-flow-rollup — consolida `cash_flow_daily` (C9).
 *
 * Recalcula os últimos dias (idempotente via UPSERT) agregando lançamentos
 * liquidados (`status='pago'`) por clínica e por dia de `paid_at`. Estornos
 * (status='estornado') saem das somas; como recalculamos a janela inteira, um
 * estorno recente neta o dia original (R2). Os números "de hoje" da UI são
 * calculados ao vivo (getCashFlowToday); esta tabela guarda o histórico fechado.
 *
 * Limitação documentada (MVP): estorno > janela de recálculo não neta dias
 * antigos. v2 = event-sourcing.
 *
 * Auth idêntica aos demais crons (Bearer CRON_SECRET + header Vercel não-fatal).
 */
import { sql } from 'drizzle-orm';

import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { dbAdmin } from '@/lib/db';
import { withCron } from '@/lib/http/cron';
import { metrics } from '@/lib/observability/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_WINDOW_DAYS = 3;
const MAX_WINDOW_DAYS = 35;

export const GET = withCron(
  {
    job: 'cash-flow-rollup',
    route: 'cash-flow-rollup',
    errorEvent: 'financial.cash_flow_rollup.error',
  },
  async (req) => {
    const url = new URL(req.url);
    const windowDays = Math.min(
      Math.max(Number(url.searchParams.get('days')) || DEFAULT_WINDOW_DAYS, 1),
      MAX_WINDOW_DAYS,
    );

    const result = (await dbAdmin.execute(
      sql`INSERT INTO cash_flow_daily (clinic_id, date, total_recebido, total_pago, saldo, updated_at)
          SELECT pt.clinic_id,
                 (pt.occurred_at AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'))::date AS date,
                 coalesce(sum(case
                   when (l.tipo = 'receber' and pt.kind = 'payment')
                     or (l.tipo = 'pagar' and pt.kind = 'refund')
                   then pt.amount else 0 end), 0) AS total_recebido,
                 coalesce(sum(case
                   when (l.tipo = 'pagar' and pt.kind = 'payment')
                     or (l.tipo = 'receber' and pt.kind = 'refund')
                   then pt.amount else 0 end), 0) AS total_pago,
                 coalesce(sum(case
                   when (l.tipo = 'receber' and pt.kind = 'payment')
                     or (l.tipo = 'pagar' and pt.kind = 'refund')
                   then pt.amount else -pt.amount end), 0) AS saldo,
                 now()
            FROM payment_transactions pt
            JOIN lancamentos l ON l.id = pt.lancamento_id
            JOIN clinics c ON c.id = pt.clinic_id
           WHERE pt.occurred_at >= now() - (${windowDays}::int * interval '1 day')
           GROUP BY pt.clinic_id,
                    (pt.occurred_at AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'))::date
          ON CONFLICT (clinic_id, date) DO UPDATE SET
             total_recebido = excluded.total_recebido,
             total_pago     = excluded.total_pago,
             saldo          = excluded.saldo,
             updated_at     = now()
          RETURNING clinic_id`,
    )) as unknown as Array<{ clinic_id: string }>;

    metrics.emit('financial.cash_flow_rollup.run', { rows: result.length, windowDays });
    await recordHeartbeat('cash-flow-rollup', 'success', { rows: result.length, windowDays });
    return Response.json({ ok: true, rows: result.length, windowDays }, { status: 200 });
  },
);
