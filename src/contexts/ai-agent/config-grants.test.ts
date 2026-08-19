import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('ai_clinic_config grants', () => {
  it('permite o UPSERT da UI sem conceder DELETE', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'drizzle/migrations/0080_ai_clinic_config_authenticated_write.sql'),
      'utf8',
    );

    expect(migration).toContain('GRANT INSERT, UPDATE ON ai_clinic_config TO authenticated');
    expect(migration).toContain(
      'REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON ai_clinic_config FROM authenticated, anon',
    );
    expect(migration).not.toContain('GRANT ALL');
    expect(migration).not.toContain('GRANT DELETE');
  });

  it('registra a migration no journal do Drizzle', () => {
    const journal = JSON.parse(
      readFileSync(resolve(process.cwd(), 'drizzle/migrations/meta/_journal.json'), 'utf8'),
    ) as { entries?: Array<{ tag?: string }> };

    expect(
      journal.entries?.some(({ tag }) => tag === '0080_ai_clinic_config_authenticated_write'),
    ).toBe(true);
  });
});
