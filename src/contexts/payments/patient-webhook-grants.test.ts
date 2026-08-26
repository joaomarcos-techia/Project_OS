import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const MIGRATION = 'drizzle/migrations/0089_patient_webhook_authenticated_insert.sql';

describe('patient_webhook_events grants', () => {
  it('permite somente o INSERT tenant-scoped exigido pelo dedup', () => {
    const migration = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8');

    expect(migration).toContain(
      'CREATE POLICY patient_webhook_events_write ON public.patient_webhook_events FOR INSERT',
    );
    expect(migration).toContain(
      "clinic_id::text = (select current_setting('app.current_clinic', true))",
    );
    expect(migration).toContain('GRANT INSERT ON public.patient_webhook_events TO authenticated');
    expect(migration).toContain(
      'REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\n' +
        '  ON public.patient_webhook_events FROM authenticated, anon',
    );
    expect(migration).not.toContain('GRANT ALL');
    expect(migration).not.toContain('GRANT UPDATE');
    expect(migration).not.toContain('GRANT DELETE');
  });

  it('registra a migration no journal do Drizzle', () => {
    const journal = JSON.parse(
      readFileSync(resolve(process.cwd(), 'drizzle/migrations/meta/_journal.json'), 'utf8'),
    ) as { entries?: Array<{ tag?: string }> };

    expect(
      journal.entries?.some(({ tag }) => tag === '0089_patient_webhook_authenticated_insert'),
    ).toBe(true);
  });
});
