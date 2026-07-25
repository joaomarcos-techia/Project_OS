import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const actions = readFileSync(resolve(process.cwd(), 'src/contexts/patient/actions.ts'), 'utf8');
const sender = readFileSync(
  resolve(process.cwd(), 'src/contexts/messaging/internal/sender.ts'),
  'utf8',
);
const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0065_granular_consent_decisions.sql'),
  'utf8',
);

describe('granular consent decisions', () => {
  it('mantem decisoes append-only, serializadas e isoladas por tenant', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS patient_consent_decisions');
    expect(migration).toContain('UNIQUE NULLS NOT DISTINCT');
    expect(migration).toContain('patient consent decision tenant mismatch');
    expect(migration).toContain('ALTER TABLE patient_consent_decisions FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('GRANT SELECT, INSERT ON patient_consent_decisions TO authenticated');
    expect(actions).toContain('pg_advisory_xact_lock');
    expect(actions).not.toContain('.update(patientConsentDecisions)');
  });

  it('migra snapshots e revogacoes tipadas sem revogar outros propositos', () => {
    expect(migration).toContain("o.event_type = 'patient.consent.revoked'");
    expect(migration).toContain("(o.payload->>'consentType')::consent_purpose");
    expect(migration).toContain('PARTITION BY patient_id, purpose, channel');
  });

  it('aplica supressao somente a finalidade correspondente', () => {
    expect(sender).toContain("eq(suppressionList.purpose, 'all')");
    expect(sender).toContain('eq(suppressionList.purpose, input.purpose)');
    expect(actions).toContain("purpose: 'all'");
    expect(actions).toContain("eq(suppressionList.reason, `consent_revoked:${decision.purpose}`)");
  });
});
