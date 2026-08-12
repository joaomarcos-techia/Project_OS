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
  resolve(process.cwd(), 'src/lib/financial/collection-case-store.ts'),
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

  it('usa o seam service-role com vínculo tenant explícito e auditoria atômica', () => {
    expect(store).toContain('dbAdmin.transaction');
    expect(store).toContain('id = ${candidate.lancamentoId}');
    expect(store).toContain('clinic_id = ${candidate.clinicId}');
    expect(store).toContain('collection_cases.clinic_id = ${candidate.clinicId}');
    expect(store).toContain('cc.clinic_id = ${clinicId}');
    expect(store).toContain("action: 'financial.collection_case.upserted'");
    expect(store).toContain("action: 'financial.collection_case.resolved'");
    expect(store).toContain('await logAudit(tx');
    expect(store).toContain('correlationId: null');
  });
});
