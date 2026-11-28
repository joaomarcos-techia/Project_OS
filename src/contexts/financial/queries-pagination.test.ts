import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withTenant } = vi.hoisted(() => ({ withTenant: vi.fn() }));

vi.mock('@/lib/db/tenant', () => ({ withTenant }));

import type { LancamentoRow } from './schema';
import { listLancamentosPage } from './queries';

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

function lancamento(index: number, clinicId = 'clinic-a'): LancamentoRow {
  const timestamp = new Date(`2026-08-20T12:${String(index % 60).padStart(2, '0')}:00.000Z`);
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    clinicId,
    unitId: null,
    tipo: 'receber',
    descricao: `Lançamento ${index}`,
    valor: '100.00',
    valorPago: '0.00',
    status: 'pendente',
    dueDate: '2026-08-30',
    paidAt: null,
    patientId: null,
    supplierId: null,
    appointmentId: null,
    sourcePatientChargeId: null,
    financialExpenseKind: null,
    providerEconomicsRevision: null,
    sourceEventId: null,
    providerPaymentId: null,
    sourceHiGuideId: null,
    valorGlosado: '0.00',
    paymentMethod: null,
    createdVia: 'manual',
    reversesLancamentoId: null,
    snapshotProcedureName: null,
    snapshotDoctorNome: null,
    createdBy: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function setup(items: LancamentoRow[], total: number) {
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

describe('listLancamentosPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    { total: 0, visible: 0 },
    { total: 1, visible: 1 },
    { total: 50, visible: 50 },
    { total: 51, visible: 50 },
  ])('retorna total=$total com $visible itens na primeira página', async ({ total, visible }) => {
    const items = Array.from({ length: visible }, (_, index) => lancamento(index + 1));
    const capture = setup(items, total);

    const result = await listLancamentosPage('clinic-a');

    expect(result).toMatchObject({ total, page: 1, pageSize: 50 });
    expect(result.items).toHaveLength(visible);
    expect(capture.limits).toEqual([50]);
    expect(capture.offsets).toEqual([0]);
  });

  it('usa offset determinístico e desempata a ordenação por id na segunda página', async () => {
    const capture = setup([lancamento(51)], 51);

    const result = await listLancamentosPage('clinic-a', { page: 2 });

    expect(result).toMatchObject({ total: 51, page: 2, pageSize: 50 });
    expect(result.items.map((item) => item.id)).toEqual([lancamento(51).id]);
    expect(capture.offsets).toEqual([50]);
    expect(capture.orderBy).toHaveLength(1);

    const dialect = new PgDialect();
    const orderBy = capture.orderBy[0];
    if (!orderBy) throw new Error('ordenação da página não foi capturada');
    const ordering = orderBy.map((clause) => dialect.sqlToQuery(clause).sql);
    const [createdAtOrder, idOrder] = ordering;
    if (!createdAtOrder || !idOrder) throw new Error('ordenação incompleta');
    expect(createdAtOrder).toContain('"lancamentos"."created_at" desc');
    expect(idOrder).toContain('"lancamentos"."id" desc');
  });

  it('aplica o mesmo tenant e os mesmos filtros à página e ao total', async () => {
    const capture = setup([lancamento(1)], 1);

    await listLancamentosPage('clinic-a', { tipo: 'receber', status: 'pendente' });

    expect(withTenant).toHaveBeenCalledWith('clinic-a', expect.any(Function));
    expect(capture.wheres).toHaveLength(2);

    const dialect = new PgDialect();
    const compiled = capture.wheres.map((where) => dialect.sqlToQuery(where));
    const [pageQuery, countQuery] = compiled;
    if (!pageQuery || !countQuery) throw new Error('predicados de paginação incompletos');
    expect(pageQuery.sql).toBe(countQuery.sql);
    expect(pageQuery.params).toEqual(['clinic-a', 'receber', 'pendente']);
    expect(countQuery.params).toEqual(['clinic-a', 'receber', 'pendente']);
    expect(pageQuery.sql).toContain('"lancamentos"."clinic_id" = $1');
  });
});
