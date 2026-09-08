import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import type { Tx } from '@/lib/db';

import { ClinicalValidationError } from '../errors';
import {
  assertAppointmentMatchesPatient,
  assertProntuarioMatchesPatient,
} from './tenant-references';

const clinicId = '11111111-1111-4111-8111-111111111111';
const patientId = '22222222-2222-4222-8222-222222222222';
const referenceId = '33333333-3333-4333-8333-333333333333';

function fakeTx(rows: Array<{ ok: number }>) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const tx = {
    execute(query: SQL) {
      const compiled = new PgDialect().sqlToQuery(query);
      calls.push({ text: compiled.sql, params: compiled.params });
      return Promise.resolve(rows);
    },
  } as unknown as Tx;
  return { tx, calls };
}

describe('referências clínicas tenant-scoped', () => {
  it('aceita consulta somente quando tenant e paciente coincidem', async () => {
    const { tx, calls } = fakeTx([{ ok: 1 }]);

    await expect(
      assertAppointmentMatchesPatient(tx, clinicId, referenceId, patientId),
    ).resolves.toBeUndefined();
    expect(calls[0]!.text).toContain('FROM appointments');
    expect(calls[0]!.text).toContain('clinic_id = $2::uuid');
    expect(calls[0]!.text).toContain('patient_id = $3::uuid');
    expect(calls[0]!.params).toEqual([referenceId, clinicId, patientId]);
  });

  it('rejeita consulta ausente, cross-tenant ou de outro paciente', async () => {
    const { tx } = fakeTx([]);

    await expect(
      assertAppointmentMatchesPatient(tx, clinicId, referenceId, patientId),
    ).rejects.toBeInstanceOf(ClinicalValidationError);
  });

  it('aceita prontuário somente quando tenant e paciente coincidem', async () => {
    const { tx, calls } = fakeTx([{ ok: 1 }]);

    await expect(
      assertProntuarioMatchesPatient(tx, clinicId, referenceId, patientId),
    ).resolves.toBeUndefined();
    expect(calls[0]!.text).toContain('FROM prontuarios');
    expect(calls[0]!.params).toEqual([referenceId, clinicId, patientId]);
  });

  it('rejeita prontuário ausente, cross-tenant ou de outro paciente', async () => {
    const { tx } = fakeTx([]);

    await expect(
      assertProntuarioMatchesPatient(tx, clinicId, referenceId, patientId),
    ).rejects.toBeInstanceOf(ClinicalValidationError);
  });
});
