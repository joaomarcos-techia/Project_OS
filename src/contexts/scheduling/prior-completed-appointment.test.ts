import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withTenant } = vi.hoisted(() => ({ withTenant: vi.fn() }));

vi.mock('@/lib/db/tenant', () => ({ withTenant }));

import { hasPriorCompletedAppointment } from './queries';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const PATIENT = '22222222-2222-4222-8222-222222222222';
const BEFORE = new Date('2026-10-22T18:00:00.000Z');

function captureQuery(rows: Array<{ id: string }>) {
  const seen: { where?: SQL; limit?: number } = {};
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn((clause: SQL) => {
      seen.where = clause;
      return chain;
    }),
    limit: vi.fn(async (limit: number) => {
      seen.limit = limit;
      return rows;
    }),
  };
  withTenant.mockImplementation((_clinicId: string, fn: (tx: unknown) => unknown) =>
    fn({ select: vi.fn(() => chain) }),
  );
  return seen;
}

beforeEach(() => {
  withTenant.mockReset();
});

describe('hasPriorCompletedAppointment', () => {
  it('busca somente consulta atendida anterior do mesmo paciente e clínica', async () => {
    const seen = captureQuery([{ id: 'consulta-anterior' }]);

    await expect(hasPriorCompletedAppointment(CLINIC, PATIENT, BEFORE)).resolves.toBe(true);

    expect(withTenant).toHaveBeenCalledWith(CLINIC, expect.any(Function));
    const where = new PgDialect().sqlToQuery(seen.where!);
    expect(where.sql).toContain('"appointments"."clinic_id" = $1');
    expect(where.sql).toContain('"appointments"."patient_id" = $2');
    expect(where.sql).toContain('"appointments"."status" = $3');
    expect(where.sql).toContain('"appointments"."scheduled_at" < $4');
    expect(where.params).toEqual([CLINIC, PATIENT, 'atendido', BEFORE.toISOString()]);
    expect(seen.limit).toBe(1);
  });

  it('sem consulta concluída anterior, permanece primeira consulta', async () => {
    captureQuery([]);

    await expect(hasPriorCompletedAppointment(CLINIC, PATIENT, BEFORE)).resolves.toBe(false);
  });
});
