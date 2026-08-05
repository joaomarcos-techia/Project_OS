import { describe, expect, it, vi } from 'vitest';

const { execute, transaction } = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
}));
const sqlTag = vi.hoisted(() => vi.fn());

vi.mock('drizzle-orm', () => ({ sql: sqlTag }));
vi.mock('./index', () => ({ db: { transaction } }));

import { withTenant } from './tenant';

describe('withTenant', () => {
  it('sets the request actor GUC only when an actor is supplied', async () => {
    transaction.mockImplementation(async (callback) => callback({ execute }));

    await withTenant('clinic-1', async () => 'without-actor');
    expect(execute).toHaveBeenCalledTimes(2);

    execute.mockClear();
    await withTenant('clinic-1', async () => 'with-actor', 'user-1');

    expect(execute).toHaveBeenCalledTimes(3);
    const actorStatement = sqlTag.mock.calls.at(-1);
    expect(actorStatement?.[1]).toBe('user-1');
  });
});
