import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as EnvironmentModule from '@/lib/env';
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/db', () => ({ dbAdmin: { execute: mocks.execute } }));
vi.mock('@/lib/env', async (original) => {
  const actual = await original<typeof EnvironmentModule>();
  return {
    ...actual,
    env: {
      ...actual.env,
      ABACATEPAY_STORE_ID: 'store_synthetic',
      ABACATEPAY_ENVIRONMENT: 'production',
      VERCEL_ENV: 'preview',
    },
  };
});
import { getDeferredSubscriptionOverview } from './deferred-checkout';
beforeEach(() => vi.clearAllMocks());
describe('persisted origin before AbacatePay runtime configuration', () => {
  it('keeps legacy Asaas management available when the new provider is disarmed', async () => {
    mocks.execute.mockResolvedValueOnce([{ ready: true }]);
    mocks.execute.mockResolvedValueOnce([{ provider: 'asaas' }]);
    await expect(
      getDeferredSubscriptionOverview('11111111-1111-4111-8111-111111111111'),
    ).resolves.toBeNull();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
  it('keeps the pre-0138 legacy schema independent of new provider configuration', async () => {
    mocks.execute.mockResolvedValueOnce([{ ready: false }]);
    await expect(
      getDeferredSubscriptionOverview('11111111-1111-4111-8111-111111111111'),
    ).resolves.toBeNull();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
  it('leaves an identified AbacatePay contract unavailable when its runtime is invalid', async () => {
    mocks.execute.mockResolvedValueOnce([{ ready: true }]);
    mocks.execute.mockResolvedValueOnce([{ provider: 'abacatepay' }]);
    await expect(
      getDeferredSubscriptionOverview('11111111-1111-4111-8111-111111111111'),
    ).resolves.toBeNull();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
  it('refuses an unknown persisted origin instead of guessing a provider', async () => {
    mocks.execute.mockResolvedValueOnce([{ ready: true }]);
    mocks.execute.mockResolvedValueOnce([{ provider: 'unknown' }]);
    await expect(
      getDeferredSubscriptionOverview('11111111-1111-4111-8111-111111111111'),
    ).rejects.toThrow();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
});
