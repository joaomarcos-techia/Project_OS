import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const actions = readFileSync(resolve(process.cwd(), 'src/contexts/scheduling/actions.ts'), 'utf8');
const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0060_doctor_absences.sql'),
  'utf8',
);

describe('doctor absence reorganization', () => {
  it('reorganiza somente agenda futura no periodo sob lock', () => {
    expect(actions).toContain("inArray(appointments.status, ['agendado', 'confirmado'])");
    expect(actions).toContain('gte(appointments.scheduledAt, startsAt)');
    expect(actions).toContain(".for('update')");
  });

  it('cancela ou transfere em lote e publica eventos individualizados', () => {
    expect(actions).toContain("cancelReason: 'doctor_absence'");
    expect(actions).toContain("kind: 'transfer'");
    expect(actions).toContain('SCHEDULING_EVENTS.DOCTOR_ABSENCE_CREATED');
    expect(actions).toContain('${idempotencyKey}:${appointment.id}:transferred');
  });

  it('impede ausencias sobrepostas e isola a tabela por tenant', () => {
    expect(migration).toContain('CONSTRAINT doctor_absences_no_overlap');
    expect(migration).toContain('ALTER TABLE doctor_absences FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('doctor_absences_strategy_chk');
  });
});
