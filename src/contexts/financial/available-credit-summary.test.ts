import { PgDialect } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withTenant } = vi.hoisted(() => ({ withTenant: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/tenant', () => ({ withTenant }));

import { getAvailablePatientCreditSummary } from './queries';

function setup(rows: { amount: string; count: number }[]) {
  let selection: { amount: SQL; count: SQL } | undefined;
  let condition: SQL | undefined;
  const query = Object.assign(Promise.resolve(rows), {
    from: vi.fn(),
    where: vi.fn((value: SQL) => {
      condition = value;
      return query;
    }),
  });
  query.from.mockReturnValue(query);
  withTenant.mockImplementation(async (_clinicId: string, callback: (tx: unknown) => unknown) =>
    callback({
      select: (fields: { amount: SQL; count: SQL }) => {
        selection = fields;
        return query;
      },
    }),
  );
  return () => {
    if (!selection || !condition) throw new Error('Consulta financeira não foi construída');
    const dialect = new PgDialect();
    return dialect.sqlToQuery(
      sql`select ${selection.amount}, ${selection.count} from patient_credits where ${condition}`,
    );
  };
}

beforeEach(() => vi.clearAllMocks());

describe('getAvailablePatientCreditSummary', () => {
  it('mostra apenas saldo não alocado da clínica, excluindo estorno e disputa', async () => {
    const inspectQuery = setup([{ amount: '10.00', count: 1 }]);

    await expect(getAvailablePatientCreditSummary('clinic-a')).resolves.toEqual({
      amount: 10,
      count: 1,
    });
    expect(withTenant).toHaveBeenCalledWith('clinic-a', expect.any(Function));

    const compiled = inspectQuery();
    expect(compiled.sql).toContain('"patient_credits"."amount"');
    expect(compiled.sql).toContain('"patient_credits"."allocated_amount"');
    expect(compiled.sql).toContain('"patient_credits"."unallocated_reversed_amount"');
    expect(compiled.sql).toContain('greatest(');
    expect(compiled.sql).toContain('"patient_credits"."clinic_id"');
    expect(compiled.sql).toContain('"patient_credits"."status"');
    expect(compiled.sql).toContain('"patient_credits"."dispute_status"');
    expect(compiled.params).toEqual(
      expect.arrayContaining(['clinic-a', 'available', 'allocated', 'reversed']),
    );
  });

  it('retorna zero quando ainda não há crédito confirmado disponível', async () => {
    setup([{ amount: '0', count: 0 }]);
    await expect(getAvailablePatientCreditSummary('clinic-a')).resolves.toEqual({
      amount: 0,
      count: 0,
    });
  });
});
