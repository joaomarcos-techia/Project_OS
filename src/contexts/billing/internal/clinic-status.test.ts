import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/db', () => ({ dbAdmin: { execute } }));

import { reopenClinicAfterReactivation, reopenReactivatedClinics } from './clinic-status';

function rendered(): string {
  const query = execute.mock.calls[0]?.[0] as SQL;
  return new PgDialect().sqlToQuery(query).sql.replace(/\s+/gu, ' ');
}

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue([{ id: 'clinic_1' }]);
});

/**
 * `dbAdmin` ignora RLS: a condição de segurança deste comando mora no SQL. Estes
 * testes travam as três guardas; a prova de que o SQL faz o que diz contra um
 * Postgres de verdade está registrada no qorov2 §38.
 */
describe.each([
  ['reabertura imediata', () => reopenClinicAfterReactivation('clinic_1')],
  ['backstop do cron', () => reopenReactivatedClinics()],
])('%s', (_nome, run) => {
  it('só reabre clínica cancelada, com billing ativo e reativação como último evento', async () => {
    await run();
    const text = rendered();
    expect(text).toContain("SET status = 'active'::clinic_status");
    expect(text).toContain("c.status = 'cancelled'::clinic_status");
    expect(text).toContain("s.billing_status = 'active'");
    expect(text).toContain('ORDER BY h.created_at DESC LIMIT 1');
    expect(text).toContain("= 'subscription_reactivated'");
  });
});

describe('reopenClinicAfterReactivation', () => {
  it('mira UMA clínica, pelo id', async () => {
    await reopenClinicAfterReactivation('clinic_1');
    const query = execute.mock.calls[0]?.[0] as SQL;
    expect(new PgDialect().sqlToQuery(query).params).toContain('clinic_1');
  });

  it('diz se abriu', async () => {
    await expect(reopenClinicAfterReactivation('clinic_1')).resolves.toBe(true);
    execute.mockResolvedValue([]);
    await expect(reopenClinicAfterReactivation('clinic_1')).resolves.toBe(false);
  });
});
