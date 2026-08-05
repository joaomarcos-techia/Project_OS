import { describe, expect, it } from 'vitest';

import { assertApplyArgs, parseCleanupArgs } from '../../../scripts/delete-test-clinics-prod';

const CLINIC_A = '11111111-1111-4111-8111-111111111111';
const CLINIC_B = '22222222-2222-4222-8222-222222222222';

describe('delete-test-clinics-prod argument guards', () => {
  it('defaults to a read-only dry run and de-duplicates explicit clinic IDs', () => {
    const args = parseCleanupArgs(['--clinic-id', CLINIC_A, `--clinic-id=${CLINIC_A}`]);

    expect(args).toEqual({
      apply: false,
      cancelAsaas: false,
      databaseOnly: false,
      clinicIds: [CLINIC_A],
      confirmation: null,
      help: false,
    });
  });

  it('requires an exact confirmation and at least one clinic ID before apply', () => {
    expect(() => assertApplyArgs(parseCleanupArgs(['--apply']))).toThrow(
      'pelo menos um --clinic-id',
    );
    expect(() =>
      assertApplyArgs(parseCleanupArgs(['--apply', '--clinic-id', CLINIC_A, '--confirm=wrong'])),
    ).toThrow('Confirmação inválida');

    expect(() =>
      assertApplyArgs(
        parseCleanupArgs([
          '--apply',
          '--clinic-id',
          CLINIC_A,
          '--clinic-id',
          CLINIC_B,
          '--confirm=DELETE_TEST_CLINICS',
        ]),
      ),
    ).not.toThrow();
  });

  it('rejects malformed or unknown arguments', () => {
    expect(() => parseCleanupArgs(['--clinic-id', 'not-a-uuid'])).toThrow('clinic_id inválido');
    expect(() => parseCleanupArgs(['--all-clinics'])).toThrow('Argumento desconhecido');
  });

  it('keeps the database-only scope separate from Asaas cancellation', () => {
    const databaseOnly = parseCleanupArgs([
      '--apply',
      '--database-only',
      '--clinic-id',
      CLINIC_A,
      '--confirm=DELETE_TEST_CLINICS',
    ]);

    expect(databaseOnly.databaseOnly).toBe(true);
    expect(() => assertApplyArgs(databaseOnly)).not.toThrow();
    expect(() =>
      assertApplyArgs(
        parseCleanupArgs([
          '--apply',
          '--database-only',
          '--cancel-asaas',
          '--clinic-id',
          CLINIC_A,
          '--confirm=DELETE_TEST_CLINICS',
        ]),
      ),
    ).toThrow('não pode ser combinado');
  });
});
