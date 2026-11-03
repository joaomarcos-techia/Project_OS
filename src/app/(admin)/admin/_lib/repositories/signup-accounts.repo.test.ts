import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listUsers, select, where, warn } = vi.hoisted(() => ({
  listUsers: vi.fn(),
  select: vi.fn(),
  where: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@/lib/auth/supabase-admin', () => ({
  createAdminClient: () => ({ auth: { admin: { listUsers } } }),
}));
vi.mock('@/lib/db', () => ({ dbAdmin: { select } }));
vi.mock('@/lib/observability/logger', () => ({ logger: { warn } }));
vi.mock('@/contexts/onboarding', () => ({
  readSignupAuthBinding: (user: {
    app_metadata?: { binding?: { signupRef: string; passwordState: 'pending' | 'set' } };
  }) => user.app_metadata?.binding ?? null,
}));

import { SignupAccountRepository } from './signup-accounts.repo';

const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
];
function user(index = 0, confirmed = false, passwordState: 'pending' | 'set' = 'pending') {
  return {
    id: ids[index],
    email: `person${index}@example.com`,
    created_at: '2026-11-03T10:00:00.000Z',
    email_confirmed_at: confirmed ? '2026-11-03T10:01:00.000Z' : null,
    app_metadata: { binding: { signupRef: `ref-${index}`, passwordState } },
    recovery_token: 'must-never-escape',
  };
}
const repo = new SignupAccountRepository();
beforeEach(() => {
  vi.resetAllMocks();
  select.mockImplementation(() => ({ from: () => ({ where }) }));
  listUsers.mockResolvedValue({ data: { users: [], lastPage: 1 }, error: null });
  where.mockResolvedValue([]);
});

describe('self-service account visibility', () => {
  it('retains an unconfirmed account after its transient draft expired; no secrets leave the repository', async () => {
    listUsers.mockResolvedValue({ data: { users: [user()], lastPage: 1 }, error: null });
    const result = await repo.list();
    expect(result).toEqual({
      ok: true,
      page: 1,
      hasNextPage: false,
      items: [
        {
          id: ids[0],
          maskedEmail: 'pe***@example.com',
          createdAt: '2026-11-03T10:00:00.000Z',
          stage: 'email_pending',
          liveDraft: false,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/person0|must-never-escape|app_metadata|ref-0/u);
  });

  it('never counts an invited account or an already provisioned/deactivated profile as a new pending clinic', async () => {
    listUsers.mockResolvedValue({
      data: { users: [user(0), { ...user(1), app_metadata: {} }, user(2)], lastPage: 1 },
      error: null,
    });
    where.mockResolvedValueOnce([{ id: ids[2] }]).mockResolvedValueOnce([]);
    const result = await repo.list();
    expect(result.ok && result.items.map((item) => item.id)).toEqual([ids[0]]);
  });

  it('distinguishes confirmation, password, plan and Checkout, and finds a pre-confirmation draft by its server-owned reference', async () => {
    listUsers.mockResolvedValue({
      data: {
        users: [user(0), user(1, true), user(2, true, 'set'), user(3, true, 'set')],
        lastPage: 1,
      },
      error: null,
    });
    const future = new Date(Date.now() + 60_000);
    where.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        userId: null,
        signupRef: 'ref-0',
        checkoutId: null,
        idleExpiresAt: future,
        absoluteExpiresAt: future,
      },
      {
        userId: ids[3],
        signupRef: 'ref-3',
        checkoutId: 'checkout-private',
        idleExpiresAt: future,
        absoluteExpiresAt: future,
      },
    ]);
    const result = await repo.list();
    expect(result.ok && result.items.map((item) => item.stage)).toEqual([
      'email_pending',
      'password_pending',
      'plan_pending',
      'checkout_pending',
    ]);
    expect(result.ok && result.items.map((item) => item.liveDraft)).toEqual([
      true,
      false,
      false,
      true,
    ]);
    expect(JSON.stringify(result)).not.toContain('checkout-private');
  });

  it('does not use a draft already bound to a different identity', async () => {
    listUsers.mockResolvedValue({
      data: { users: [user(0, true, 'set')], lastPage: 1 },
      error: null,
    });
    const future = new Date(Date.now() + 60_000);
    where.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        userId: ids[1],
        signupRef: 'ref-0',
        checkoutId: 'other',
        idleExpiresAt: future,
        absoluteExpiresAt: future,
      },
    ]);
    const result = await repo.list();
    expect(result.ok && result.items[0]).toMatchObject({ stage: 'plan_pending', liveDraft: false });
  });

  it('supports further Auth pages even if the current filtered page is empty', async () => {
    listUsers.mockResolvedValue({ data: { users: [], lastPage: 4 }, error: null });
    expect(await repo.list(2)).toEqual({ ok: true, items: [], page: 2, hasNextPage: true });
    expect(listUsers).toHaveBeenCalledWith({ page: 2, perPage: 100 });
    expect(select).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, -1, 1.1, 10001])('bounds untrusted pagination %s', async (page) => {
    await repo.list(page);
    expect(listUsers).toHaveBeenCalledWith({ page: 1, perPage: 100 });
  });

  it.each(['provider', 'database', 'malformed'])(
    'reports %s failure as unavailable rather than an empty success',
    async (failure) => {
      listUsers.mockResolvedValue({
        data: { users: [user()], lastPage: 1 },
        error: failure === 'provider' ? new Error('sensitive') : null,
      });
      if (failure === 'database') where.mockRejectedValue(new Error('sensitive'));
      if (failure === 'malformed')
        listUsers.mockResolvedValue({
          data: { users: [{ ...user(), email: 'invalid' }], lastPage: 1 },
          error: null,
        });
      expect(await repo.list()).toEqual({ ok: false });
      expect(warn).toHaveBeenCalledWith('admin.signup_accounts.unavailable', {});
    },
  );
});
