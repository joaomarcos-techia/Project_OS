import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { aiProactiveJobs } from './schema';

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0118_proactive_job_send_key.sql'),
  'utf8',
);
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/migrations/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string }> };

describe('0118 — chave de envio por geração da C14 (ADR-064)', () => {
  it('acrescenta send_key anulável e sem default: jobs existentes seguem na geração 0', () => {
    expect(migration).toContain(
      'ALTER TABLE public.ai_proactive_jobs\n  ADD COLUMN IF NOT EXISTS send_key uuid;',
    );
    // NOT NULL ou DEFAULT reescreveriam as linhas e tirariam o job.id da geração 0.
    expect(migration).not.toMatch(/send_key uuid\s+(NOT NULL|DEFAULT)/u);
    expect(migration).not.toMatch(/\bDEFAULT\b/u);
  });

  it('indexa a chave por clínica, só onde ela existe, e é única', () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS ai_proactive_jobs_clinic_send_key_uniq\n' +
        '  ON public.ai_proactive_jobs (clinic_id, send_key)\n' +
        '  WHERE send_key IS NOT NULL;',
    );
  });

  it('o schema do Drizzle declara a mesma coluna e o mesmo índice', () => {
    const config = getTableConfig(aiProactiveJobs);
    const column = config.columns.find((c) => c.name === 'send_key');
    expect(column?.getSQLType()).toBe('uuid');
    expect(column?.notNull).toBe(false);
    expect(column?.hasDefault).toBe(false);
    const index = config.indexes.find(
      (i) => i.config.name === 'ai_proactive_jobs_clinic_send_key_uniq',
    );
    expect(index?.config.unique).toBe(true);
  });

  it('registra o marcador e entra no journal depois da 0117', () => {
    expect(migration).toContain("VALUES ('0118-proactive-job-send-key')");
    const previous = journal.entries.find((entry) => entry.idx === 117);
    const entry = journal.entries.find((candidate) => candidate.idx === 118);
    expect(entry?.tag).toBe('0118_proactive_job_send_key');
    expect(entry && previous && entry.when > previous.when).toBe(true);
  });
});
