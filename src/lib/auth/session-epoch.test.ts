import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  returning: vi.fn(),
  where: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  dbAdmin: {
    update: () => ({
      set: () => ({
        where: (condition: unknown) => {
          mocks.where(condition);
          return { returning: mocks.returning };
        },
      }),
    }),
  },
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));

import { bumpSessionEpochIfCurrent } from './session-epoch';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.returning.mockResolvedValue([{ claimsVersion: 5 }]);
});

describe('bumpSessionEpochIfCurrent', () => {
  it('faz CAS pelo usuário e claims_version antes de declarar revogação', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';

    await expect(bumpSessionEpochIfCurrent(userId, 4, 'password_reset')).resolves.toBe(true);

    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0]![0] as SQL);
    expect(query.params).toEqual([userId, 4]);
    expect(mocks.emit).toHaveBeenCalledWith('auth.session.revoked', {
      reason: 'password_reset',
    });
  });

  it('não emite revogação quando outro consumidor venceu o CAS', async () => {
    mocks.returning.mockResolvedValue([]);

    await expect(
      bumpSessionEpochIfCurrent('11111111-1111-4111-8111-111111111111', 4, 'password_reset'),
    ).resolves.toBe(false);
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});
