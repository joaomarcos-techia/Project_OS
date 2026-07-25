import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const actions = readFileSync(resolve(process.cwd(), 'src/contexts/scheduling/actions.ts'), 'utf8');
const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0059_appointment_recovery.sql'),
  'utf8',
);

describe('appointment recovery integration', () => {
  it('exige edit:agenda, motivo e grava trilha excepcional', () => {
    expect(actions).toContain('RecoverAppointmentSchema.parse(input)');
    expect(actions).toContain('requireFreshPermission(PERMISSIONS.EDIT_AGENDA)');
    expect(actions).toContain('.insert(appointmentCorrections)');
    expect(actions).toContain('eventType: SCHEDULING_EVENTS.CORRECTED');
  });

  it('mantem correcoes append-only e isoladas por clinica', () => {
    expect(migration).toContain('ALTER TABLE appointment_corrections FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('GRANT SELECT, INSERT ON appointment_corrections TO authenticated');
    expect(migration).toContain('appointment_corrections_reason_chk');
    expect(migration).not.toContain('GRANT SELECT, INSERT, UPDATE');
  });
});
