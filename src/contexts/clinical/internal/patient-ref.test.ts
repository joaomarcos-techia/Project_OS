import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

import { ClinicalValidationError } from '../errors';
import { resolvePatientNome } from './patient-ref';

function fakeTx(rows: unknown[]) {
  let where: SQL | null = null;
  const result = Promise.resolve(rows);
  const query = Object.assign(result, {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  });
  query.from.mockReturnValue(query);
  query.where.mockImplementation((clause: SQL) => {
    where = clause;
    return query;
  });
  query.limit.mockReturnValue(query);
  return {
    tx: { select: vi.fn().mockReturnValue(query) } as unknown as Tx,
    getWhere: () => where,
  };
}

describe('resolvePatientNome', () => {
  it('resolve paciente ativo com predicados explícitos de tenant e id', async () => {
    const clinicId = '11111111-1111-4111-8111-111111111111';
    const patientId = '22222222-2222-4222-8222-222222222222';
    const { tx, getWhere } = fakeTx([{ nome: 'Ana Lima', deletedAt: null, obitoEm: null }]);

    await expect(resolvePatientNome(tx, clinicId, patientId)).resolves.toBe('Ana Lima');
    const where = getWhere();
    if (!where) throw new Error('predicado não capturado');
    const compiled = new PgDialect().sqlToQuery(where);
    expect(compiled.sql).toContain('"patients"."id" = $1');
    expect(compiled.sql).toContain('"patients"."clinic_id" = $2');
    expect(compiled.params).toEqual([patientId, clinicId]);
  });

  it('rejeita paciente inexistente ou removido sem revelar outro tenant', async () => {
    const missing = fakeTx([]);
    const deleted = fakeTx([{ nome: 'Ana', deletedAt: new Date(), obitoEm: null }]);

    await expect(resolvePatientNome(missing.tx, 'clinic-a', 'patient-a')).rejects.toBeInstanceOf(
      ClinicalValidationError,
    );
    await expect(resolvePatientNome(deleted.tx, 'clinic-a', 'patient-a')).rejects.toBeInstanceOf(
      ClinicalValidationError,
    );
  });

  it('bloqueia novo artefato para paciente falecido', async () => {
    const { tx } = fakeTx([{ nome: 'Ana', deletedAt: null, obitoEm: '2026-09-01' }]);

    await expect(resolvePatientNome(tx, 'clinic-a', 'patient-a')).rejects.toThrow(/falecido/u);
  });
});
