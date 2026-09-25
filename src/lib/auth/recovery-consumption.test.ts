import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ dbAdmin: { transaction: mocks.transaction } }));

import {
  isOrphanRecoveryEpochConsumed,
  markOrphanRecoveryEpochConsumed,
  withOrphanRecoveryLock,
} from './recovery-consumption';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(
    async (work: (tx: { execute: typeof mocks.execute }) => Promise<unknown>) =>
      work({ execute: mocks.execute }),
  );
  mocks.execute.mockResolvedValue(undefined);
});

describe('consumo de recovery órfão', () => {
  it('mantém o I/O dentro de advisory xact lock por usuário', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const work = vi.fn(async () => 'done');

    await expect(withOrphanRecoveryLock(userId, work)).resolves.toBe('done');

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.invocationCallOrder[0]).toBeLessThan(
      work.mock.invocationCallOrder[0]!,
    );
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0]![0] as SQL);
    expect(query.sql).toContain('pg_advisory_xact_lock');
    expect(query.params).toEqual([`qoro:password-recovery:${userId}`]);
  });

  it('marca e reconhece exatamente o epoch consumido sem apagar metadata', () => {
    const marked = markOrphanRecoveryEpochConsumed({ existing: 'kept' }, 1_795_000_000_000);

    expect(marked).toEqual({
      existing: 'kept',
      qoro_password_recovery_epoch: 1_795_000_000_000,
    });
    expect(isOrphanRecoveryEpochConsumed(marked, 1_795_000_000_000)).toBe(true);
    expect(isOrphanRecoveryEpochConsumed(marked, 1_795_000_000_001)).toBe(false);
    expect(isOrphanRecoveryEpochConsumed(null, 1_795_000_000_000)).toBe(false);
  });
});
