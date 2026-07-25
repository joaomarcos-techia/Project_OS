import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const appActions = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/pacientes/actions.ts'),
  'utf8',
);
const card = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/pacientes/[id]/patient-relationships-card.tsx'),
  'utf8',
);
const page = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/pacientes/[id]/page.tsx'),
  'utf8',
);

describe('patient relationship candidate search', () => {
  it('busca sob tenant e permissão em lotes pequenos', () => {
    expect(appActions).toContain('export async function buscarPacientesRelacionamento');
    expect(appActions).toContain('requireCachedPermission(PERMISSIONS.VIEW_PATIENT)');
    expect(appActions).toContain('listPatients(clinicId, { search: normalized, limit: 10 })');
    expect(appActions).toContain('patient.id !== excluded.data');
  });

  it('reutiliza o combobox assíncrono em vínculo e merge', () => {
    expect(card.match(/<Combobox\s/g)?.length).toBe(2);
    expect(card).toContain('name="responsiblePatientId"');
    expect(card).toContain('name="targetPatientId"');
    expect(card).toContain('disabled={!responsible}');
    expect(card).toContain('disabled={!mergeTarget}');
  });

  it('não pré-carrega uma lista truncada de pacientes', () => {
    expect(page).not.toContain('listPatients');
    expect(page).not.toContain('limit: 200');
  });
});
