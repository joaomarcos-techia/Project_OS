import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { SIGNUP_AUTH_ENABLED: true },
  createServerClient: vi.fn(),
  getUser: vi.fn(),
  readAuthoritativeProfile: vi.fn(),
  authenticate: vi.fn(),
  postLoginRedirect: vi.fn(),
}));

vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('./supabase-server', () => ({ createServerClient: mocks.createServerClient }));
vi.mock('./tenant-context', () => ({
  authenticate: mocks.authenticate,
  readAuthoritativeProfile: mocks.readAuthoritativeProfile,
}));
vi.mock('./policies', () => ({ postLoginRedirect: mocks.postLoginRedirect }));

import { resolvePreTenantOnboarding } from './pretenant-onboarding';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const verifiedUser = {
  id: USER_ID,
  email: 'verified@example.invalid',
  email_confirmed_at: '2026-09-16T00:00:00.000Z',
  is_anonymous: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.SIGNUP_AUTH_ENABLED = true;
  mocks.getUser.mockResolvedValue({ data: { user: verifiedUser }, error: null });
  mocks.createServerClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
  mocks.readAuthoritativeProfile.mockResolvedValue(null);
  mocks.authenticate.mockResolvedValue({ ok: false, reason: 'NO_PROFILE' });
  mocks.postLoginRedirect.mockReturnValue('/dashboard');
});

describe('resolvePreTenantOnboarding', () => {
  it('fecha o gate antes de criar cliente Auth', async () => {
    mocks.env.SIGNUP_AUTH_ENABLED = false;
    await expect(resolvePreTenantOnboarding()).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it.each([
    [{ data: { user: null }, error: { message: 'raw provider' } }, 'invalid_session'],
    [{ data: { user: null }, error: null }, 'invalid_session'],
    [{ data: { user: { ...verifiedUser, id: 'not-a-uuid' } }, error: null }, 'invalid_session'],
    [{ data: { user: { ...verifiedUser, is_anonymous: true } }, error: null }, 'anonymous'],
    [
      { data: { user: { ...verifiedUser, email_confirmed_at: null } }, error: null },
      'email_unverified',
    ],
    [
      { data: { user: { ...verifiedUser, email_confirmed_at: 'invalid' } }, error: null },
      'email_unverified',
    ],
    [{ data: { user: { ...verifiedUser, email: 'invalid' } }, error: null }, 'email_unverified'],
  ])('recusa sessão que não prova usuário verificado %#', async (result, reason) => {
    mocks.getUser.mockResolvedValue(result);
    await expect(resolvePreTenantOnboarding()).resolves.toEqual({ ok: false, reason });
    expect(mocks.readAuthoritativeProfile).not.toHaveBeenCalled();
  });

  it('admite somente usuário verificado sem profile, sem criar identidade tenant', async () => {
    await expect(resolvePreTenantOnboarding()).resolves.toEqual({
      ok: true,
      kind: 'pretenant',
      userId: USER_ID,
      email: verifiedUser.email,
    });
    expect(mocks.readAuthoritativeProfile).toHaveBeenCalledWith(USER_ID);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it('revalida profile existente e preserva a política de MFA/role', async () => {
    mocks.readAuthoritativeProfile.mockResolvedValue({ mfaEnrolledAt: new Date('2026-09-01') });
    mocks.authenticate.mockResolvedValue({
      ok: true,
      identity: { userId: USER_ID, role: 'super_admin', aal: 'aal1' },
    });
    mocks.postLoginRedirect.mockReturnValue('/login/mfa');
    await expect(resolvePreTenantOnboarding()).resolves.toEqual({
      ok: true,
      kind: 'redirect',
      route: '/login/mfa',
    });
    expect(mocks.postLoginRedirect).toHaveBeenCalledWith({
      role: 'super_admin',
      mfaEnrolledAt: new Date('2026-09-01'),
      aal: 'aal1',
    });
  });

  it('mantém convite pendente exclusivamente em /convite', async () => {
    mocks.readAuthoritativeProfile.mockResolvedValue({ mfaEnrolledAt: null });
    mocks.authenticate.mockResolvedValue({ ok: false, reason: 'INVITE_PENDING' });
    await expect(resolvePreTenantOnboarding()).resolves.toEqual({
      ok: true,
      kind: 'redirect',
      route: '/convite',
    });
    expect(mocks.postLoginRedirect).not.toHaveBeenCalled();
  });

  it.each(['USER_DISABLED', 'USER_DELETED', 'CLAIMS_OUTDATED', 'TOKEN_INVALID'])(
    'não converte profile impedido em pré-tenant: %s',
    async (reason) => {
      mocks.readAuthoritativeProfile.mockResolvedValue({ mfaEnrolledAt: null });
      mocks.authenticate.mockResolvedValue({ ok: false, reason });
      await expect(resolvePreTenantOnboarding()).resolves.toEqual({
        ok: false,
        reason: 'profile_denied',
      });
    },
  );

  it('recusa divergência entre getUser e identidade autorizada', async () => {
    mocks.readAuthoritativeProfile.mockResolvedValue({ mfaEnrolledAt: null });
    mocks.authenticate.mockResolvedValue({
      ok: true,
      identity: { userId: '22222222-2222-4222-8222-222222222222', role: 'owner', aal: 'aal1' },
    });
    await expect(resolvePreTenantOnboarding()).resolves.toEqual({
      ok: false,
      reason: 'profile_denied',
    });
    expect(mocks.postLoginRedirect).not.toHaveBeenCalled();
  });

  it.each(['auth', 'database', 'guards'])(
    'falha fechada sem propagar exceção operacional: %s',
    async (source) => {
      if (source === 'auth') mocks.createServerClient.mockRejectedValue(new Error('raw auth'));
      if (source === 'database')
        mocks.readAuthoritativeProfile.mockRejectedValue(new Error('raw db'));
      if (source === 'guards') {
        mocks.readAuthoritativeProfile.mockResolvedValue({ mfaEnrolledAt: null });
        mocks.authenticate.mockRejectedValue(new Error('raw guard'));
      }
      await expect(resolvePreTenantOnboarding()).resolves.toEqual({
        ok: false,
        reason: 'unavailable',
      });
    },
  );
});
