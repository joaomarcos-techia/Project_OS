import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RecordPatientDeathSchema } from './types';

const actions = readFileSync(resolve(process.cwd(), 'src/contexts/patient/actions.ts'), 'utf8');
const sender = readFileSync(
  resolve(process.cwd(), 'src/contexts/messaging/internal/sender.ts'),
  'utf8',
);
const schedulingCore = readFileSync(
  resolve(process.cwd(), 'src/contexts/scheduling/internal/appointment-core.ts'),
  'utf8',
);
const lifecycleHandler = readFileSync(
  resolve(process.cwd(), 'src/contexts/scheduling/internal/handlers/patient-deleted.ts'),
  'utf8',
);
const dunning = readFileSync(
  resolve(process.cwd(), 'src/contexts/financial/dunning-candidates.ts'),
  'utf8',
);

describe('patient death workflow', () => {
  it('exige data valida e justificativa operacional', () => {
    expect(
      RecordPatientDeathSchema.safeParse({
        deceasedAt: '2026-07-20',
        reason: 'Comunicado familiar',
      }).success,
    ).toBe(true);
    expect(
      RecordPatientDeathSchema.safeParse({ deceasedAt: '20/07/2026', reason: 'ok' }).success,
    ).toBe(false);
    expect(actions).toContain('now() AT TIME ZONE timezone');
    expect(actions).toContain('isNull(patients.obitoEm)');
    expect(actions).toContain('action: PATIENT_EVENTS.DECEASED');
  });

  it('bloqueia mensagens e cria supressao global ao registrar o falecimento', () => {
    expect(actions).toContain("'patient_deceased'");
    expect(sender).toContain('isNotNull(patients.obitoEm)');
    expect(sender).toContain("return { kind: 'suppressed' as const }");
  });

  it('bloqueia nova agenda e cobranca automatica de paciente falecido', () => {
    expect(schedulingCore).toContain('AND obito_em IS NULL');
    expect(dunning).toContain('AND p.obito_em IS NULL');
  });

  it('cancela agenda futura e lista de espera pelo evento de falecimento', () => {
    expect(lifecycleHandler).toContain("const PATIENT_CORE_DECEASED = 'patient.core.deceased'");
    expect(lifecycleHandler).toContain("cancelFutureForPatient(ctx, 'patient_deceased')");
    expect(lifecycleHandler).toContain("inArray(waitlistEntries.status, ['waiting', 'offered'])");
  });
});
