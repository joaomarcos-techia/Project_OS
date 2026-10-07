import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ withTenant: vi.fn(), getUserById: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/tenant', () => ({ withTenant: m.withTenant }));
vi.mock('@/lib/auth/supabase-admin', () => ({
  createAdminClient: () => ({ auth: { admin: { getUserById: m.getUserById } } }),
}));

import { listActiveOwnerEmails } from './queries';

const dialect = new PgDialect();

function stubOwners(rows: Array<{ id: string }>): { where: () => SQL | undefined } {
  let captured: SQL | undefined;
  m.withTenant.mockImplementation((async (_clinicId: string, fn: (tx: unknown) => unknown) =>
    fn({
      select: () => ({
        from: () => ({
          where: (condition: SQL) => {
            captured = condition;
            return { orderBy: async () => rows };
          },
        }),
      }),
    })) as never);
  return { where: () => captured };
}

beforeEach(() => vi.clearAllMocks());

describe('listActiveOwnerEmails', () => {
  it('busca só donos ativos e não removidos da própria clínica, pelo caminho tenant', async () => {
    const stub = stubOwners([]);

    await expect(listActiveOwnerEmails('clinic-1')).resolves.toEqual([]);

    expect(m.withTenant.mock.calls[0]?.[0]).toBe('clinic-1');
    const query = dialect.sqlToQuery(stub.where()!);
    expect(query.sql).toContain('"profiles"."clinic_id" = $1');
    expect(query.sql).toContain('"profiles"."role" = $2');
    expect(query.sql).toContain('"profiles"."ativo" = $3');
    expect(query.sql).toContain('"profiles"."deleted_at" is null');
    expect(query.params).toEqual(['clinic-1', 'owner', true]);
    // Sem dono, nenhuma chamada ao Auth.
    expect(m.getUserById).not.toHaveBeenCalled();
  });

  it('lê o e-mail no Auth e pula dono sem e-mail', async () => {
    stubOwners([{ id: 'owner-1' }, { id: 'owner-2' }, { id: 'owner-3' }]);
    m.getUserById
      .mockResolvedValueOnce({ data: { user: { email: 'dono@clinica.test' } }, error: null })
      .mockResolvedValueOnce({ data: { user: { email: null } }, error: null })
      .mockResolvedValueOnce({ data: { user: { email: 'socia@clinica.test' } }, error: null });

    await expect(listActiveOwnerEmails('clinic-1')).resolves.toEqual([
      'dono@clinica.test',
      'socia@clinica.test',
    ]);
    expect(m.getUserById.mock.calls.map(([id]) => id)).toEqual(['owner-1', 'owner-2', 'owner-3']);
  });
});
