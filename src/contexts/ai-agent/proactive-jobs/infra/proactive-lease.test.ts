import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repository = readFileSync(
  resolve(process.cwd(), 'src/contexts/ai-agent/proactive-jobs/infra/repository.ts'),
  'utf8',
);
const processor = readFileSync(
  resolve(process.cwd(), 'src/contexts/ai-agent/proactive-jobs/application/process.ts'),
  'utf8',
);
const reminders = readFileSync(
  resolve(process.cwd(), 'src/contexts/scheduling/reminder-candidates.ts'),
  'utf8',
);
const dunning = readFileSync(
  resolve(process.cwd(), 'src/contexts/financial/dunning-candidates.ts'),
  'utf8',
);
const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0068_proactive_job_leases.sql'),
  'utf8',
);

describe('proactive job lease and fairness', () => {
  it('reserva como processing com token e prazo recuperavel', () => {
    expect(repository).toContain("status = 'processing'");
    expect(repository).toContain('lease_expires_at = now() + make_interval');
    expect(repository).toContain('lease_token = gen_random_uuid()::text');
    expect(repository).toContain("j.status = 'processing' AND j.lease_expires_at <= now()");
    expect(repository).toContain('FOR UPDATE OF j SKIP LOCKED');
    expect(migration).toContain('ai_proactive_jobs_lease_chk');
  });

  it('nao converte o novo valor do enum antes do commit da migration', () => {
    expect(migration).toContain(
      "ALTER TYPE proactive_job_status ADD VALUE IF NOT EXISTS 'processing'",
    );
    expect(migration).not.toContain("status = 'processing'");
    expect(migration).not.toContain("status <> 'processing'");
    expect(migration).not.toContain("WHERE status IN ('pending', 'processing')");
    expect(migration).toContain("status::text = 'processing'");
    expect(migration).toContain('ON ai_proactive_jobs (status, type, scheduled_for, clinic_id)');
  });

  it('finaliza somente o lease que ainda pertence ao processor', () => {
    expect(repository).toContain("eq(aiProactiveJobs.status, 'processing')");
    expect(repository).toContain('eq(aiProactiveJobs.leaseToken, leaseToken)');
    expect(processor).toContain('job.leaseToken');
  });

  it('distribui claim e scans em rodadas por clinica', () => {
    expect(repository).toContain('PARTITION BY j.clinic_id');
    expect(repository).toContain('ORDER BY r.clinic_rank');
    expect(reminders).toContain('PARTITION BY a.clinic_id');
    expect(reminders).toContain('ORDER BY clinic_rank');
    expect(dunning).toContain('PARTITION BY l.clinic_id');
    expect(dunning).toContain('ORDER BY clinic_rank');
  });
});
