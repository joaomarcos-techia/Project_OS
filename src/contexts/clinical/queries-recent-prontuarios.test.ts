import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withTenant } = vi.hoisted(() => ({ withTenant: vi.fn() }));

vi.mock('@/lib/db/tenant', () => ({ withTenant }));

import { listProntuariosByPatient, listRecentProntuariosByPatient } from './queries';

interface QueryCapture {
  where: SQL | null;
  orderBy: SQL[];
  limit: number | null;
}

function prontuarioRow(index: number) {
  const createdAt = new Date(`2026-08-${String(index).padStart(2, '0')}T10:00:00.000Z`);
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    clinicId: '00000000-0000-4000-8000-00000000000a',
    patientId: '00000000-0000-4000-8000-00000000000b',
    doctorId: '00000000-0000-4000-8000-00000000000c',
    appointmentId: null,
    status: 'rascunho' as const,
    contentEncrypted: 'ciphertext',
    rowVersion: 1,
    version: 1,
    signedAt: null,
    signedBy: null,
    signedDoctorNome: null,
    signedDoctorCrm: null,
    signedDoctorCrmUf: null,
    signedDoctorEspecialidade: null,
    needsReturn: false,
    returnDays: null,
    createdBy: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function setup(rows: Array<ReturnType<typeof prontuarioRow>>) {
  const capture: QueryCapture = { where: null, orderBy: [], limit: null };
  const result = Promise.resolve(rows);
  const query = Object.assign(result, {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  });
  query.from.mockReturnValue(query);
  query.where.mockImplementation((clause: SQL) => {
    capture.where = clause;
    return query;
  });
  query.orderBy.mockImplementation((...clauses: SQL[]) => {
    capture.orderBy = clauses;
    return query;
  });
  query.limit.mockImplementation((value: number) => {
    capture.limit = value;
    return query;
  });
  const tx = { select: vi.fn().mockReturnValue(query) };
  withTenant.mockImplementation(
    async (_clinicId: string, operation: (transaction: typeof tx) => unknown) => operation(tx),
  );
  return capture;
}

describe('listRecentProntuariosByPatient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mantém a dupla barreira de tenant e limita o rail aos oito mais recentes', async () => {
    const clinicId = '00000000-0000-4000-8000-00000000000a';
    const patientId = '00000000-0000-4000-8000-00000000000b';
    const capture = setup([prontuarioRow(1)]);

    const result = await listRecentProntuariosByPatient(clinicId, patientId);

    expect(result).toHaveLength(1);
    expect(withTenant).toHaveBeenCalledWith(clinicId, expect.any(Function));
    expect(capture.limit).toBe(8);
    if (!capture.where) throw new Error('predicado não capturado');
    const where = new PgDialect().sqlToQuery(capture.where);
    expect(where.sql).toContain('"prontuarios"."clinic_id" = $1');
    expect(where.sql).toContain('"prontuarios"."patient_id" = $2');
    expect(where.params).toEqual([clinicId, patientId]);
  });

  it('ordena pelo instante exibido na atividade e fecha empates por id', async () => {
    const capture = setup([]);

    await listRecentProntuariosByPatient(
      '00000000-0000-4000-8000-00000000000a',
      '00000000-0000-4000-8000-00000000000b',
    );

    expect(capture.orderBy).toHaveLength(2);
    const order = capture.orderBy.map((clause) =>
      new PgDialect().sqlToQuery(clause).sql.toLowerCase(),
    );
    expect(order[0]).toContain('case');
    expect(order[0]).toContain('"prontuarios"."status" = \'assinado\'');
    expect(order[0]).toContain('coalesce("prontuarios"."signed_at", "prontuarios"."updated_at")');
    expect(order[0]).toContain('else "prontuarios"."updated_at"');
    expect(order[0]).toContain('end desc');
    expect(order[1]).toContain('"prontuarios"."id" desc');
  });

  it('não introduz limite na consulta da aba completa', async () => {
    const capture = setup([]);

    await listProntuariosByPatient(
      '00000000-0000-4000-8000-00000000000a',
      '00000000-0000-4000-8000-00000000000b',
    );

    expect(capture.limit).toBeNull();
  });
});
