import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transactionMock, execute, emit, recordHeartbeat } = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  execute: vi.fn(),
  emit: vi.fn(),
  recordHeartbeat: vi.fn(),
}));

vi.mock('@/lib/http/cron', () => ({ withCron: (_options: unknown, handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({ dbAdmin: { transaction: transactionMock } }));
vi.mock('@/lib/db/tenant', () => ({ withTenant: vi.fn() }));
vi.mock('@/lib/cron-heartbeat', () => ({ recordHeartbeat }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent: vi.fn() }));
vi.mock('@/contexts/financial', () => ({
  FINANCIAL_EVENTS: { FATURAMENTO_PENDENTE: 'financial.faturamento.pendente' },
  faturamentoPendencias: {},
}));

import { GET } from './route';

const dialect = new PgDialect();

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue([]);
  transactionMock.mockImplementation(
    async (callback: (tx: { execute: typeof execute }) => unknown) => callback({ execute }),
  );
});

describe('financial reconcile', () => {
  it('restaura o papel administrativo antes do scan cross-tenant', async () => {
    const response = await GET(new Request('https://app.qoro.dev/api/cron/financial-reconcile'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, opened: 0, clinics: 0 });
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);

    const statements = execute.mock.calls.map(([query]) => dialect.sqlToQuery(query as SQL).sql);
    expect(statements[0]).toMatch(/^RESET ROLE$/i);
    expect(statements[1]).toMatch(/from appointments/i);
    expect(statements[1]).toMatch(/not exists \(select 1 from lancamentos/i);
  });
});
