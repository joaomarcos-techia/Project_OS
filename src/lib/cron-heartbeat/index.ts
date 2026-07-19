/**
 * recordHeartbeat — registra a última execução de um cron (observabilidade).
 *
 * UPSERT em `cron_heartbeats` (global-protected) via dbAdmin/service_role. BEST-
 * EFFORT: qualquer falha é engolida — NUNCA derruba o cron por causa do heartbeat.
 *
 * `job` = nome do cron (= path no vercel.json, ex.: 'billing-dunning'). O painel
 * (jobs-health.repo) compara last_run_at com o SLA esperado por job.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { cronHeartbeats } from '@/lib/db/schema/infra/cron-heartbeats';
import { metrics } from '@/lib/observability/metrics';

export async function recordHeartbeat(
  job: string,
  status: 'success' | 'skipped' | 'error',
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await dbAdmin
      .insert(cronHeartbeats)
      .values({ job, lastRunAt: sql`now()`, lastStatus: status, detail: detail ?? null })
      .onConflictDoUpdate({
        target: cronHeartbeats.job,
        set: {
          lastRunAt: sql`now()`,
          lastStatus: status,
          detail: detail ?? null,
          updatedAt: sql`now()`,
        },
      });
  } catch (err) {
    // M2 — continua BEST-EFFORT (heartbeat jamais derruba o cron), mas deixa
    // rastro. Antes este catch era vazio, e isso cegava justamente o mecanismo
    // criado para detectar falha silenciosa: o SLO nº6 mede liveness por
    // `last_run_at`, então uma escrita perdida faz um cron que RODOU parecer
    // atrasado (ou um travado parecer saudável). Sem `detail` no sinal — ele
    // varia por job e não acrescenta nada ao diagnóstico desta falha.
    metrics.emit('cron.heartbeat.write_failed', {
      job,
      status,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
