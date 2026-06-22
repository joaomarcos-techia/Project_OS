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
        set: { lastRunAt: sql`now()`, lastStatus: status, detail: detail ?? null, updatedAt: sql`now()` },
      });
  } catch {
    // best-effort — heartbeat nunca quebra a operação do cron.
  }
}
