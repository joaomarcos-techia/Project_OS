import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('migration 0093 — convênios da clínica', () => {
  const migrationPath = resolve(
    process.cwd(),
    'drizzle/migrations/0093_ai_clinic_config_convenios.sql',
  );
  const migration = readFileSync(migrationPath, 'utf8');
  const journal = JSON.parse(
    readFileSync(resolve(process.cwd(), 'drizzle/migrations/meta/_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };

  it('é aditiva, mantém o default seguro e não altera o catálogo financeiro', () => {
    expect(migration).toContain('ALTER TABLE ai_clinic_config');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS convenios text[] NOT NULL');
    expect(migration).toContain('DEFAULT ARRAY[]::text[]');
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\b/iu);
    expect(migration).not.toContain('payment_methods');
  });

  it('reserva 0093 depois das migrations financeiras já aplicadas', () => {
    expect(journal.entries).toContainEqual(
      expect.objectContaining({ idx: 93, tag: '0093_ai_clinic_config_convenios' }),
    );
  });
});
