import { describe, expect, it } from 'vitest';

import { CreateDoctorAbsenceSchema } from './types';

const DOCTOR = '11111111-1111-4111-8111-111111111111';
const REPLACEMENT = '22222222-2222-4222-8222-222222222222';

describe('CreateDoctorAbsenceSchema', () => {
  it('exige periodo valido e substituto para transferencia', () => {
    expect(
      CreateDoctorAbsenceSchema.safeParse({
        doctorId: DOCTOR,
        startsAt: '2026-08-01T09:00:00-03:00',
        endsAt: '2026-08-02T18:00:00-03:00',
        reason: 'Ferias',
        strategy: 'transfer',
        replacementDoctorId: REPLACEMENT,
      }).success,
    ).toBe(true);

    expect(
      CreateDoctorAbsenceSchema.safeParse({
        doctorId: DOCTOR,
        startsAt: '2026-08-02T18:00:00-03:00',
        endsAt: '2026-08-01T09:00:00-03:00',
        reason: 'Ferias',
        strategy: 'transfer',
      }).success,
    ).toBe(false);
  });
});
