import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CreateAppointmentSchema, CreateWalkInSchema, HistoricalAppointmentImportSchema } from './types';

const actions = readFileSync(resolve(process.cwd(), 'src/contexts/scheduling/actions.ts'), 'utf8');
const api = readFileSync(resolve(process.cwd(), 'src/contexts/scheduling/api.ts'), 'utf8');
const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0067_appointment_import_provenance.sql'),
  'utf8',
);
const importPage = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/agenda/importar/page.tsx'),
  'utf8',
);

const appointment = {
  doctorId: '00000000-0000-4000-8000-000000000001',
  patientId: '00000000-0000-4000-8000-000000000002',
  procedureId: '00000000-0000-4000-8000-000000000003',
  scheduledAt: '2025-07-24T10:00:00-03:00',
};

describe('appointment historical import provenance', () => {
  it('remove controles de origem dos contratos comuns', () => {
    expect(CreateAppointmentSchema.parse({ ...appointment, createdVia: 'super_admin', isHistoricalImport: true }))
      .not.toHaveProperty('createdVia');
    expect(CreateAppointmentSchema.parse({ ...appointment, isHistoricalImport: true }))
      .not.toHaveProperty('isHistoricalImport');
    expect(CreateWalkInSchema.parse({ ...appointment, createdVia: 'ai_agent' })).not.toHaveProperty(
      'createdVia',
    );
    expect(api).not.toContain('input.createdVia');
  });

  it('exige origem, justificativa e estado terminal em lote limitado', () => {
    expect(
      HistoricalAppointmentImportSchema.safeParse({
        source: 'Sistema legado',
        justification: 'Migracao inicial autorizada',
        items: [{ ...appointment, historicalStatus: 'atendido', externalReference: 'LEG-1' }],
      }).success,
    ).toBe(true);
    expect(
      HistoricalAppointmentImportSchema.safeParse({
        source: '',
        justification: '',
        items: [{ ...appointment, historicalStatus: 'agendado' }],
      }).success,
    ).toBe(false);
  });

  it('exige permissao dedicada e grava lote atomico auditavel', () => {
    expect(actions).toContain('requireFreshPermission(PERMISSIONS.IMPORT_AGENDA)');
    expect(actions).toContain('.insert(appointmentImportBatches)');
    expect(actions).toContain('eventType: SCHEDULING_EVENTS.IMPORT_COMPLETED');
    expect(actions).toContain("createdVia: 'import'");
  });

  it('protege proveniencia e tenant tambem no banco', () => {
    expect(migration).toContain('imported appointment requires an import batch');
    expect(migration).toContain('appointment import batch tenant mismatch');
    expect(migration).toContain('non-imported appointment cannot declare import provenance');
    expect(migration).toContain("('owner', 'import:agenda')");
    expect(migration).toContain("('gestor', 'import:agenda')");
  });

  it('expoe o fluxo separado na agenda com gate dedicado', () => {
    expect(importPage).toContain('requireFreshPermission(PERMISSIONS.IMPORT_AGENDA)');
    expect(importPage).toContain('<HistoryImporter />');
    expect(importPage).toContain('historicalStatus');
  });
});
