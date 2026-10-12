/**
 * `listAppointments({ ids })` — lote por id para a Agenda achar a consulta de
 * cada mensagem que não chegou, mesmo fora da faixa exibida (EC-32).
 *
 * O lote continua tenant-scoped (withTenant + predicado da clínica), e lista
 * vazia não vai ao banco.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withTenant } = vi.hoisted(() => ({ withTenant: vi.fn() }));

vi.mock('@/lib/db/tenant', () => ({ withTenant }));

import { listAppointments } from './queries';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const A = '55555555-5555-4555-8555-555555555555';
const B = '66666666-6666-4666-8666-666666666666';

function captureWhere() {
  const seen: { where?: SQL; limit?: number } = {};
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn((clause: SQL) => {
      seen.where = clause;
      return chain;
    }),
    orderBy: vi.fn(() => chain),
    limit: vi.fn((n: number) => {
      seen.limit = n;
      return chain;
    }),
    offset: vi.fn(async () => []),
  };
  withTenant.mockImplementation((_clinicId: string, fn: (tx: unknown) => unknown) =>
    fn({ select: vi.fn(() => chain) }),
  );
  return seen;
}

beforeEach(() => {
  withTenant.mockReset();
});

describe('listAppointments({ ids })', () => {
  it('filtra pelos ids, na clínica', async () => {
    const seen = captureWhere();

    await listAppointments(CLINIC, { ids: [A, B], limit: 2 });

    expect(withTenant).toHaveBeenCalledWith(CLINIC, expect.any(Function));
    const where = new PgDialect().sqlToQuery(seen.where!);
    expect(where.sql).toBe('("appointments"."clinic_id" = $1 and "appointments"."id" in ($2, $3))');
    expect(where.params).toEqual([CLINIC, A, B]);
    expect(seen.limit).toBe(2);
  });

  it('lista vazia devolve vazio sem consultar', async () => {
    await expect(listAppointments(CLINIC, { ids: [] })).resolves.toEqual([]);
    expect(withTenant).not.toHaveBeenCalled();
  });

  it('sem ids, o filtro não aparece (os chamadores de antes não mudam)', async () => {
    const seen = captureWhere();

    await listAppointments(CLINIC, { limit: 10 });

    // `and()` com uma condição só não abre parênteses.
    expect(new PgDialect().sqlToQuery(seen.where!).sql).toBe('"appointments"."clinic_id" = $1');
  });
});
