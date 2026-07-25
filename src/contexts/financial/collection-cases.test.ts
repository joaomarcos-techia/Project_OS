import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0058_financial_collection_cases.sql'),
  'utf8',
);
const enqueue = readFileSync(
  resolve(process.cwd(), 'src/contexts/ai-agent/proactive-jobs/application/enqueue.ts'),
  'utf8',
);
const store = readFileSync(
  resolve(process.cwd(), 'src/contexts/financial/internal/collection-cases.ts'),
  'utf8',
);

describe('manual collection queue', () => {
  it('persiste uma fila tenant-scoped sem permitir escrita direta do usuario', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS collection_cases');
    expect(migration).toContain('ALTER TABLE collection_cases FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('GRANT SELECT ON collection_cases TO authenticated');
    expect(migration).not.toContain('GRANT SELECT, INSERT ON collection_cases TO authenticated');
  });

  it('resolve casos quitados e roteia dividas antigas sem enviar WhatsApp automatico', () => {
    expect(enqueue).toContain('listOpenCollectionCaseClinicIds()');
    expect(enqueue).toContain('resolveSettledCollectionCases(clinicId)');
    expect(enqueue).toContain("if (route.mode === 'manual')");
    expect(enqueue).toContain('upsertCollectionCase(c, route.stage)');
    expect(enqueue.indexOf("if (route.mode === 'manual')")).toBeLessThan(
      enqueue.lastIndexOf('repo.enqueue(c.clinicId'),
    );
  });

  it('faz toda escrita de caso manual dentro do tenant explícito', () => {
    expect(store).toContain('withTenant(candidate.clinicId');
    expect(store).toContain('withTenant(clinicId');
    expect(store).not.toContain('dbAdmin');
    expect(store).toContain('cc.clinic_id = ${clinicId}');
  });
});
