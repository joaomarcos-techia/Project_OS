import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

import { logAudit } from './log';

vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));

const values = vi.fn(async () => undefined);
const tx = {
  insert: vi.fn(() => ({ values })),
} as unknown as Tx;

const base = {
  clinicId: '11111111-1111-4111-8111-111111111111',
  userId: null,
  action: 'test.action',
  resourceType: 'test',
  resourceId: null,
  before: null,
  after: null,
};

describe('logAudit correlation_id', () => {
  beforeEach(() => {
    values.mockClear();
  });

  it('preserva correlation UUID válido', async () => {
    const correlationId = '22222222-2222-4222-8222-222222222222';
    await logAudit(tx, {
      ...base,
      requestContext: { ip: null, userAgent: null, requestId: 'vercel::request', correlationId },
    });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ correlationId }));
  });

  it('mantém request_id textual e não o grava na coluna UUID', async () => {
    const requestId = 'proactive-dunning:non-uuid';
    await logAudit(tx, {
      ...base,
      requestContext: { ip: null, userAgent: null, requestId, correlationId: null },
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ requestId, correlationId: null }),
    );
  });
});
