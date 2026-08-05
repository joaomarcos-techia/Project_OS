/**
 * AdminJobsHealthRepository (C15 · Platform Settings) — saúde dos crons internos (read-only).
 *
 * Lê `cron_heartbeats` (global-protected) via dbAdmin e compara `last_run_at` com
 * o SLA esperado por job (derivado do schedule em vercel.json). NÃO mede serviço
 * externo (isso é /admin/saude) — mede "o cron rodou recentemente?".
 *
 * Server-only.
 */
import 'server-only';

import { dbAdmin } from '@/lib/db';
import { cronHeartbeats } from '@/lib/db/schema/infra/cron-heartbeats';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Jobs esperados + janela máxima de staleness antes de virar "atrasado". */
const JOBS = [
  { job: 'outbox', label: 'Outbox worker', cadence: 'a cada 1 min', maxAgeMs: 10 * MIN },
  {
    job: 'financial-reconcile',
    label: 'Reconcile financeiro',
    cadence: 'a cada 15 min',
    maxAgeMs: 45 * MIN,
  },
  {
    job: 'proactive-reminders',
    label: 'Lembretes',
    cadence: '15 min · 8–20h',
    maxAgeMs: 14 * HOUR,
  },
  {
    job: 'proactive-dunning',
    label: 'Dunning paciente',
    cadence: '15 min · 8–20h',
    maxAgeMs: 14 * HOUR,
  },
  { job: 'proactive-followup', label: 'Followup', cadence: '15 min · 8–20h', maxAgeMs: 14 * HOUR },
  { job: 'cash-flow-rollup', label: 'Rollup do caixa', cadence: 'diário', maxAgeMs: 26 * HOUR },
  { job: 'patient-hard-delete', label: 'Hard-delete LGPD', cadence: 'diário', maxAgeMs: 26 * HOUR },
  { job: 'billing-dunning', label: 'Dunning de clínica', cadence: 'diário', maxAgeMs: 26 * HOUR },
  { job: 'billing-reconcile', label: 'Reconcile Asaas', cadence: 'diário', maxAgeMs: 26 * HOUR },
  { job: 'audit-partitions', label: 'Partições (audit/IA)', cadence: 'mensal', maxAgeMs: 32 * DAY },
  { job: 'data-retention', label: 'Retenção (purge)', cadence: 'mensal', maxAgeMs: 32 * DAY },
] as const;

export type JobHealth = 'ok' | 'late' | 'never';

export interface JobHealthDTO {
  job: string;
  label: string;
  cadence: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  health: JobHealth;
}

export class AdminJobsHealthRepository {
  async list(): Promise<JobHealthDTO[]> {
    const rows = await dbAdmin
      .select({
        job: cronHeartbeats.job,
        lastRunAt: cronHeartbeats.lastRunAt,
        lastStatus: cronHeartbeats.lastStatus,
      })
      .from(cronHeartbeats);
    const byJob = new Map(rows.map((r) => [r.job, r]));
    const now = Date.now();

    return JOBS.map((j) => {
      const r = byJob.get(j.job);
      if (!r || !r.lastRunAt) {
        return {
          job: j.job,
          label: j.label,
          cadence: j.cadence,
          lastRunAt: null,
          lastStatus: r?.lastStatus ?? null,
          health: 'never' as const,
        };
      }
      const lastRun = new Date(r.lastRunAt);
      const health: JobHealth = now - lastRun.getTime() <= j.maxAgeMs ? 'ok' : 'late';
      return {
        job: j.job,
        label: j.label,
        cadence: j.cadence,
        lastRunAt: lastRun.toISOString(),
        lastStatus: r.lastStatus,
        health,
      };
    });
  }
}

export const jobsHealthRepository = new AdminJobsHealthRepository();
