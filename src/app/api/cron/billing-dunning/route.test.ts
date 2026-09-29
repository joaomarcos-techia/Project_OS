import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn(async (_query: unknown) => []) }));

vi.mock('@/lib/http/cron', () => ({ withCron: (_options: unknown, handler: unknown) => handler }));
vi.mock('@/lib/cron-heartbeat', () => ({ recordHeartbeat: vi.fn() }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent: vi.fn() }));
vi.mock('@/contexts/billing/internal/subscriptions', () => ({ setClinicAccess: vi.fn() }));
vi.mock('@/lib/db', () => ({ dbAdmin: { execute, transaction: vi.fn() } }));

import { GET } from './route';

describe('billing-dunning', () => {
  it('não persegue assinatura cancelada', async () => {
    // Uma parcela que sobrava no Asaas depois do cancelamento vencia e levava a
    // clínica cancelada pela régua de cobrança. Quem saiu não é inadimplente.
    await GET(new Request('http://localhost/api/cron/billing-dunning'));

    const query = execute.mock.calls[0]?.[0] as SQL;
    const text = new PgDialect().sqlToQuery(query).sql.replace(/\s+/gu, ' ');
    expect(text).toContain("i.status = 'overdue'");
    expect(text).toContain("s.billing_status <> 'cancelled'");
  });
});
