import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withTenant } = vi.hoisted(() => ({ withTenant: vi.fn() }));

vi.mock('@/lib/crypto', () => ({
  decryptForTenant: vi.fn(),
  hashForLookup: vi.fn(),
  normalizeCpf: vi.fn(),
  normalizePhone: vi.fn(),
}));
vi.mock('@/lib/db/tenant', () => ({ withTenant }));

import { listPatientsPage } from './queries';

const dialect = new PgDialect();

function query<T>(rows: T[]) {
  const result = Promise.resolve(rows);
  const chain = Object.assign(result, {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  });
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.offset.mockReturnValue(chain);
  return chain;
}

function patientRow(index: number) {
  const instant = new Date('2026-08-20T12:00:00.000Z');
  return {
    id: `patient-${index}`,
    clinicId: 'clinic-a',
    nome: `Paciente ${index}`,
    email: null,
    dataNascimento: null,
    sexo: null,
    obitoEm: null,
    mergedIntoPatientId: null,
    createdAt: instant,
    updatedAt: instant,
    deletedAt: null,
  };
}

function setupPage(rows: ReturnType<typeof patientRow>[], total: number) {
  const itemsQuery = query(rows);
  const countQuery = query([{ total }]);
  const tx = { select: vi.fn().mockReturnValueOnce(itemsQuery).mockReturnValueOnce(countQuery) };
  withTenant.mockImplementation(
    async (_clinicId: string, operation: (transaction: typeof tx) => unknown) => operation(tx),
  );
  return { itemsQuery, countQuery, tx };
}

describe('listPatientsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    { label: 'zero registros', rows: 0, total: 0 },
    { label: 'um registro', rows: 1, total: 1 },
    { label: 'exatamente o tamanho da página', rows: 30, total: 30 },
    { label: 'tamanho da página mais um', rows: 30, total: 31 },
  ])('retorna itens e total para $label', async ({ rows, total }) => {
    const data = Array.from({ length: rows }, (_, index) => patientRow(index));
    const { itemsQuery } = setupPage(data, total);

    const result = await listPatientsPage('clinic-a');

    expect(result).toMatchObject({ total, page: 1, pageSize: 30 });
    expect(result.items).toHaveLength(rows);
    expect(itemsQuery.limit).toHaveBeenCalledWith(30);
    expect(itemsQuery.offset).toHaveBeenCalledWith(0);
  });

  it('calcula a última página em uma clínica com centenas de registros', async () => {
    const data = Array.from({ length: 21 }, (_, index) => patientRow(480 + index));
    const { itemsQuery } = setupPage(data, 501);

    const result = await listPatientsPage('clinic-a', { page: 17 });

    expect(result).toMatchObject({ total: 501, page: 17, pageSize: 30 });
    expect(result.items).toHaveLength(21);
    expect(itemsQuery.offset).toHaveBeenCalledWith(480);
  });

  it('aplica os filtros à lista e ao total sob dupla barreira de tenant', async () => {
    const { itemsQuery, countQuery, tx } = setupPage([], 0);

    await listPatientsPage('clinic-a', {
      search: '  Ana  ',
      onlyDeleted: true,
      page: 2,
    });

    expect(withTenant).toHaveBeenCalledWith('clinic-a', expect.any(Function));
    expect(tx.select).toHaveBeenCalledTimes(2);

    for (const pageQuery of [itemsQuery, countQuery]) {
      const where = pageQuery.where.mock.calls[0]?.[0] as SQL;
      const compiled = dialect.sqlToQuery(where);
      expect(compiled.params).toEqual(expect.arrayContaining(['clinic-a', '%Ana%']));
      expect(compiled.sql).toContain('"patients"."clinic_id" = $1');
      expect(compiled.sql).toContain('"patients"."deleted_at" IS NOT NULL');
      expect(compiled.sql).toContain('"patients"."anonymized_at" is null');
    }
  });
});
