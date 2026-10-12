/**
 * EC-32 — leituras do painel sobre jobs `failed` (`listFailedSince`,
 * `countFailedSince`, `findFailedJob`).
 *
 * Toda leitura roda em `withTenant` da clínica E carrega o predicado da
 * clínica. Só `failed` entra: `pending` com `meta_<código>` é reenvio agendado
 * e `cancelled` é decisão deliberada, e nenhum dos dois é falha a mostrar.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withTenant } = vi.hoisted(() => ({ withTenant: vi.fn() }));

vi.mock('@/lib/db', () => ({ dbAdmin: {} }));
vi.mock('@/lib/db/tenant', () => ({ withTenant }));

import { countFailedSince, findFailedJob, listFailedSince } from './repository';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const JOB = '33333333-3333-4333-8333-333333333333';
const SINCE = new Date('2026-10-01T12:00:00.000Z');

function fakeTx(rows: unknown[]) {
  const seen: { columns?: unknown; where?: SQL; orderBy?: SQL[]; limit?: number } = {};
  const chain = Object.assign(Promise.resolve(rows), {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  });
  chain.from.mockReturnValue(chain);
  chain.where.mockImplementation((clause: SQL) => {
    seen.where = clause;
    return chain;
  });
  chain.orderBy.mockImplementation((...clauses: SQL[]) => {
    seen.orderBy = clauses;
    return chain;
  });
  chain.limit.mockImplementation((n: number) => {
    seen.limit = n;
    return chain;
  });
  const tx = {
    select: vi.fn((columns: unknown) => {
      seen.columns = columns;
      return chain;
    }),
  };
  return { tx, seen };
}

function useTx(rows: unknown[]) {
  const fake = fakeTx(rows);
  withTenant.mockImplementation((_clinicId: string, fn: (tx: unknown) => unknown) => fn(fake.tx));
  return fake.seen;
}

const compile = (clause: SQL | undefined) => {
  if (!clause) throw new Error('predicado não capturado');
  return new PgDialect().sqlToQuery(clause);
};

beforeEach(() => {
  withTenant.mockReset();
});

describe('listFailedSince', () => {
  it('lê só jobs failed da clínica desde o início da janela, no withTenant dela', async () => {
    const row = {
      id: JOB,
      type: 'deposit_link',
      payload: {},
      failedReason: 'meta_131042',
      lastAttemptAt: new Date('2026-10-08T11:01:00.000Z'),
    };
    const seen = useTx([row]);

    await expect(listFailedSince(CLINIC, SINCE, 100)).resolves.toEqual([row]);

    expect(withTenant).toHaveBeenCalledWith(CLINIC, expect.any(Function));
    const where = compile(seen.where);
    expect(where.sql).toBe(
      '("ai_proactive_jobs"."clinic_id" = $1 and "ai_proactive_jobs"."status" = $2 and "ai_proactive_jobs"."last_attempt_at" >= $3)',
    );
    expect(where.params.slice(0, 2)).toEqual([CLINIC, 'failed']);
    expect(new Date(where.params[2] as string | Date).toISOString()).toBe(SINCE.toISOString());
  });

  it('do mais recente ao mais antigo, com id para desempatar, e respeita o teto', async () => {
    const seen = useTx([]);

    await listFailedSince(CLINIC, SINCE, 25);

    expect(seen.orderBy?.map((clause) => compile(clause).sql)).toEqual([
      '"ai_proactive_jobs"."last_attempt_at" desc',
      '"ai_proactive_jobs"."id" desc',
    ]);
    expect(seen.limit).toBe(25);
  });

  it('não seleciona colunas de lease nem de agendamento', async () => {
    const seen = useTx([]);

    await listFailedSince(CLINIC, SINCE, 10);

    expect(Object.keys(seen.columns as object).sort()).toEqual([
      'failedReason',
      'id',
      'lastAttemptAt',
      'payload',
      'type',
    ]);
  });
});

describe('countFailedSince', () => {
  it('conta com o mesmo predicado da lista', async () => {
    const seen = useTx([{ total: 3 }]);

    await expect(countFailedSince(CLINIC, SINCE)).resolves.toBe(3);

    const where = compile(seen.where);
    expect(where.sql).toContain('"ai_proactive_jobs"."clinic_id" = $1');
    expect(where.sql).toContain('"ai_proactive_jobs"."status" = $2');
    expect(where.sql).toContain('"ai_proactive_jobs"."last_attempt_at" >= $3');
    expect(where.params.slice(0, 2)).toEqual([CLINIC, 'failed']);
  });

  it('o driver pode devolver a contagem como texto; sem linha, zero', async () => {
    useTx([{ total: '7' }]);
    await expect(countFailedSince(CLINIC, SINCE)).resolves.toBe(7);

    useTx([]);
    await expect(countFailedSince(CLINIC, SINCE)).resolves.toBe(0);
  });
});

describe('findFailedJob', () => {
  it('acha o job pelo id, na clínica, e só se ele falhou', async () => {
    const row = {
      id: JOB,
      type: 'remainder_link',
      payload: {},
      failedReason: 'meta_failed',
      lastAttemptAt: null,
    };
    const seen = useTx([row]);

    await expect(findFailedJob(CLINIC, JOB)).resolves.toEqual(row);

    expect(withTenant).toHaveBeenCalledWith(CLINIC, expect.any(Function));
    const where = compile(seen.where);
    expect(where.sql).toBe(
      '("ai_proactive_jobs"."id" = $1 and "ai_proactive_jobs"."clinic_id" = $2 and "ai_proactive_jobs"."status" = $3)',
    );
    expect(where.params).toEqual([JOB, CLINIC, 'failed']);
    expect(seen.limit).toBe(1);
  });

  it('nenhuma linha (outro tenant, outro status, id qualquer) → null', async () => {
    useTx([]);
    await expect(findFailedJob(CLINIC, JOB)).resolves.toBeNull();
  });
});
