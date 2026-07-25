import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const agendaActions = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/agenda/actions.ts'),
  'utf8',
);
const calendar = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/agenda/agenda-calendar.tsx'),
  'utf8',
);
const correctionDialog = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/agenda/appointment-correction-dialog.tsx'),
  'utf8',
);
const absencePage = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/agenda/ausencias/page.tsx'),
  'utf8',
);
const absenceForm = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/agenda/ausencias/doctor-absence-form.tsx'),
  'utf8',
);
const queries = readFileSync(resolve(process.cwd(), 'src/contexts/scheduling/queries.ts'), 'utf8');

describe('agenda operational correction and absence UI', () => {
  it('liga a correção da agenda à action auditável existente', () => {
    expect(agendaActions).toContain('export async function corrigirAtendimentoAction');
    expect(agendaActions).toContain('await recoverAppointment(');
    expect(calendar).toContain('a.recoveryKinds.length > 0');
    expect(correctionDialog).toContain('name="idempotencyKey"');
    expect(correctionDialog).toContain('name="reason"');
  });

  it('converte o período local no fuso da clínica e chama a reorganização atômica', () => {
    expect(agendaActions).toContain('localDateTimeToIso');
    expect(agendaActions).toContain('await createDoctorAbsence(');
    expect(absenceForm).toContain('name="startsAt"');
    expect(absenceForm).toContain('name="replacementDoctorId"');
    expect(absenceForm).toContain('A agenda será reorganizada imediatamente');
  });

  it('protege a tela por permissão e lista ausências pelo read-side tenant scoped', () => {
    expect(absencePage).toContain('PERMISSIONS.MANAGE_AVAILABILITY');
    expect(absencePage).toContain('listDoctorAbsences');
    expect(queries).toContain('eq(doctorAbsences.clinicId, clinicId)');
    expect(queries).toContain('return withTenant(clinicId');
  });
});
