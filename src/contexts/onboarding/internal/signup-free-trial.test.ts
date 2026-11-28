import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  getUser: vi.fn(),
  transaction: vi.fn(),
  env: {
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
    ABACATEPAY_STORE_ID: 'store_synthetic',
  },
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock(import('@/lib/payments/saas/acquisition'), async (importOriginal) => ({
  ...(await importOriginal()),
  deferredSaasSignupEnabled: mocks.enabled,
}));
vi.mock('@/lib/auth/supabase-server', () => ({
  createServerClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('@/lib/db', () => ({ dbAdmin: { transaction: mocks.transaction } }));
import { provisionFreeSignupTrial } from './signup-free-trial';

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'synthetic@example.invalid',
  created_at: '2026-11-01T12:00:00Z',
  email_confirmed_at: '2026-11-01T12:01:00Z',
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.env.SIGNUP_AUTH_ENABLED = true;
  mocks.env.SIGNUP_IDENTITY_ENABLED = true;
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  mocks.transaction.mockResolvedValue({ ok: true, state: 'provisioned', clinicId: 'synthetic' });
});
const start = () => provisionFreeSignupTrial({ userId: user.id, verifiedEmail: user.email });
describe('free signup requires a live verified Auth identity', () => {
  it('opens the transaction only after reading the matching verified identity', async () => {
    expect((await start()).ok).toBe(true);
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });
  it.each([
    null,
    { ...user, id: '22222222-2222-4222-8222-222222222222' },
    { ...user, email: 'other@example.invalid' },
    { ...user, email_confirmed_at: null },
    { ...user, email_confirmed_at: 'invalid' },
    { ...user, invited_at: '2026-11-01T00:00:00Z' },
    { ...user, banned_until: '2099-01-01T00:00:00Z' },
  ])('rejects an absent, mismatched, unverified, invited or banned identity', async (value) => {
    mocks.getUser.mockResolvedValue({ data: { user: value }, error: null });
    expect(await start()).toEqual({ ok: false, reason: 'forbidden' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('does not trust a locally retained Auth user when the authoritative call failed', async () => {
    mocks.getUser.mockResolvedValue({ data: { user }, error: new Error('synthetic unavailable') });
    expect(await start()).toEqual({ ok: false, reason: 'forbidden' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('does not provision with a malformed Auth creation timestamp', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { ...user, created_at: 'invalid' } },
      error: null,
    });
    expect(await start()).toEqual({ ok: false, reason: 'unavailable' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('does not contact Auth or the database when the acquisition cohort is disabled', async () => {
    mocks.enabled.mockReturnValue(false);
    expect(await start()).toEqual({ ok: false, reason: 'unavailable' });
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
