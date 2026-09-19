import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withTenant } = vi.hoisted(() => ({ withTenant: vi.fn() }));

vi.mock('@/lib/db/tenant', () => ({ withTenant }));

import type { DoctorAbsenceRow } from './schema';
import { listDoctorAbsencesPage } from './queries';

interface QueryCapture {
  wheres: SQL[];
  orderBy: SQL[][];
  limits: number[];
  offsets: number[];
}

function query<T>(rows: T[], capture: QueryCapture) {
  const result = Promise.resolve(rows);
  const chain = Object.assign(result, {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  });
  chain.from.mockReturnValue(chain);
  chain.where.mockImplementation((clause: SQL) => {
    capture.wheres.push(clause);
    return chain;
  });
  chain.orderBy.mockImplementation((...clauses: SQL[]) => {
    capture.orderBy.push(clauses);
    return chain;
  });
  chain.limit.mockImplementation((value: number) => {
    capture.limits.push(value);
    return chain;
  });
  chain.offset.mockImplementation((value: number) => {
    capture.offsets.push(value);
    return chain;
  });
  return chain;
}

function absence(index: number, clinicId = '00000000-0000-4000-8000-00000000000a') {
  const startsAt = new Date(`2026-08-${String((index % 20) + 1).padStart(2, '0')}T12:00:00.000Z`);
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    clinicId,
    doctorId: '00000000-0000-4000-8000-00000000000d',
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3_600_000),
    reason: `Ausência ${index}`,
    strategy: 'cancel',
    replacementDoctorId: null,
    affectedAppointments: index,
    createdBy: null,
    createdAt: startsAt,
    updatedAt: startsAt,
  } satisfies DoctorAbsenceRow;
}

function setup(items: DoctorAbsenceRow[], total: number) {
  const capture: QueryCapture = { wheres: [], orderBy: [], limits: [], offsets: [] };
  const tx = { select: vi.fn() };
  tx.select
    .mockReturnValueOnce(query(items, capture))
    .mockReturnValueOnce(query([{ total }], capture));
  withTenant.mockImplementation(
    async (_clinicId: string, callback: (transaction: typeof tx) => unknown) => callback(tx),
  );
  return capture;
}

describe('listDoctorAbsencesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    { total: 0, visible: 0 },
    { total: 1, visible: 1 },
    { total: 30, visible: 30 },
    { total: 31, visible: 30 },
  ])('retorna total=$total com $visible itens na primeira página', async ({ total, visible }) => {
    const capture = setup(
      Array.from({ length: visible }, (_, index) => absence(index + 1)),
      total,
    );

    const result = await listDoctorAbsencesPage('00000000-0000-4000-8000-00000000000a', {
      asOf: new Date('2026-08-20T00:00:00.000Z'),
    });

    expect(result).toMatchObject({ total, page: 1, pageSize: 30 });
    expect(result.items).toHaveLength(visible);
    expect(capture.limits).toEqual([30]);
    expect(capture.offsets).toEqual([0]);
  });

  it('usa offset e desempate por id na segunda página', async () => {
    const capture = setup([absence(31)], 31);

    const result = await listDoctorAbsencesPage('00000000-0000-4000-8000-00000000000a', {
      page: 2,
      asOf: new Date('2026-08-20T00:00:00.000Z'),
    });

    expect(result).toMatchObject({ total: 31, page: 2, pageSize: 30 });
    expect(capture.offsets).toEqual([30]);
    const order = capture.orderBy[0];
    if (!order) throw new Error('ordenação não capturada');
    const compiled = order.map((clause) => new PgDialect().sqlToQuery(clause).sql);
    expect(compiled[0]).toContain('"doctor_absences"."starts_at" asc');
    expect(compiled[1]).toContain('"doctor_absences"."id" asc');
  });

  it('aplica o mesmo tenant, profissional e período à página e ao total', async () => {
    const capture = setup([absence(1)], 1);
    const asOf = new Date('2026-08-20T00:00:00.000Z');

    await listDoctorAbsencesPage('00000000-0000-4000-8000-00000000000a', {
      doctorId: '00000000-0000-4000-8000-00000000000d',
      period: 'past',
      asOf,
    });

    expect(withTenant).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-00000000000a',
      expect.any(Function),
    );
    expect(capture.wheres).toHaveLength(2);
    const [pageWhere, countWhere] = capture.wheres.map((where) =>
      new PgDialect().sqlToQuery(where),
    );
    if (!pageWhere || !countWhere) throw new Error('predicados incompletos');
    expect(pageWhere.sql).toBe(countWhere.sql);
    expect(pageWhere.params).toEqual([
      '00000000-0000-4000-8000-00000000000a',
      '00000000-0000-4000-8000-00000000000d',
      asOf.toISOString(),
    ]);
    expect(countWhere.params).toEqual(pageWhere.params);
    expect(pageWhere.sql).toContain('"doctor_absences"."clinic_id" = $1');
    expect(pageWhere.sql).toContain('"doctor_absences"."doctor_id" = $2');
    expect(pageWhere.sql).toContain('"doctor_absences"."ends_at" < $3');
  });

  it('lista todas em ordem recente sem adicionar corte temporal', async () => {
    const capture = setup([], 0);

    await listDoctorAbsencesPage('00000000-0000-4000-8000-00000000000a', {
      period: 'all',
    });

    const where = capture.wheres[0];
    const order = capture.orderBy[0];
    if (!where || !order) throw new Error('consulta não capturada');
    expect(new PgDialect().sqlToQuery(where).params).toEqual([
      '00000000-0000-4000-8000-00000000000a',
    ]);
    const compiled = order.map((clause) => new PgDialect().sqlToQuery(clause).sql);
    expect(compiled[0]).toContain('"doctor_absences"."starts_at" desc');
    expect(compiled[1]).toContain('"doctor_absences"."id" desc');
  });
});
