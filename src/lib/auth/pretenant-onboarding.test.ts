import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { SIGNUP_AUTH_ENABLED: true },
  createServerClient: vi.fn(),
  getUser: vi.fn(),
  readAuthoritativeProfile: vi.fn(),
  authenticate: vi.fn(),
  postLoginRedirect: vi.fn(),
  cookie: vi.fn(),
  proof: vi.fn(),
}));

vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('./supabase-server', () => ({ createServerClient: mocks.createServerClient }));
vi.mock('./tenant-context', () => ({
  authenticate: mocks.authenticate,
  readAuthoritativeProfile: mocks.readAuthoritativeProfile,
}));
vi.mock('./policies', () => ({ postLoginRedirect: mocks.postLoginRedirect }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.cookie }) }));
vi.mock('./signup-confirmation-grant', () => ({
  readSignupConfirmationGrant: mocks.proof,
  SIGNUP_CONFIRMATION_GRANT_COOKIE: 'qoro_signup_confirm',
  SIGNUP_RECOVERY_COOKIE: 'qoro_signup_recovery',
}));

import {
  resolvePreTenantOnboarding,
  resolveReadyPreTenantOnboarding,
} from './pretenant-onboarding';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const verifiedUser = {
  id: USER_ID,
  email: 'verified@example.invalid',
  email_confirmed_at: '2026-09-16T00:00:00.000Z',
  is_anonymous: false,
  app_metadata: {
    qoro_self_service_signup: {
      version: 1,
      kind: 'self_service',
      signup_ref: 'a'.repeat(64),
      password_state: 'set',
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.SIGNUP_AUTH_ENABLED = true;
  mocks.getUser.mockResolvedValue({ data: { user: verifiedUser }, error: null });
  mocks.createServerClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
  mocks.readAuthoritativeProfile.mockResolvedValue(null);
  mocks.authenticate.mockResolvedValue({ ok: false, reason: 'NO_PROFILE' });
  mocks.postLoginRedirect.mockReturnValue('/dashboard');
  mocks.cookie.mockReturnValue(undefined);
  mocks.proof.mockReturnValue(null);
});

describe('resolvePreTenantOnboarding', () => {
  it.each(['missing', 'other-user', 'other-ref', 'valid'])(
    'requires independent mailbox proof for an initial pending password: %s',
    async (kind) => {
      mocks.getUser.mockResolvedValue({
        data: {
          user: {
            ...verifiedUser,
            app_metadata: {
              qoro_self_service_signup: {
                ...verifiedUser.app_metadata.qoro_self_service_signup,
                password_state: 'pending',
                initial_password_ref: 'b'.repeat(64),
              },
            },
          },
        },
        error: null,
      });
      if (kind !== 'missing')
        mocks.proof.mockReturnValue({
          userId: kind === 'other-user' ? 'other' : USER_ID,
          signupRef: kind === 'other-ref' ? 'b'.repeat(64) : 'a'.repeat(64),
        });
      const result = await resolvePreTenantOnboarding();
      if (kind === 'valid')
        expect(result).toMatchObject({
          ok: true,
          kind: 'pretenant',
          pendingSignupRef: 'a'.repeat(64),
        });
      else expect(result).toEqual({ ok: false, reason: 'credentials_pending' });
    },
  );
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
      signupRef: 'a'.repeat(64),
      pendingSignupRef: null,
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

describe('resolveReadyPreTenantOnboarding', () => {
  it('admite pré-tenant somente depois de a credencial ficar pronta', async () => {
    await expect(resolveReadyPreTenantOnboarding()).resolves.toEqual({
      ok: true,
      kind: 'pretenant',
      userId: USER_ID,
      email: verifiedUser.email,
      signupRef: 'a'.repeat(64),
      pendingSignupRef: null,
    });
  });

  it('recusa com razão tipada a sessão confirmada cujo handoff segue pendente', async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          ...verifiedUser,
          app_metadata: {
            qoro_self_service_signup: {
              ...verifiedUser.app_metadata.qoro_self_service_signup,
              password_state: 'pending',
            },
          },
        },
      },
      error: null,
    });

    await expect(resolveReadyPreTenantOnboarding()).resolves.toEqual({
      ok: false,
      reason: 'credentials_pending',
    });
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    {},
    { qoro_self_service_signup: { password_state: 'set' } },
    {
      qoro_self_service_signup: {
        version: 1,
        kind: 'self_service',
        signup_ref: 'not-a-reference',
        password_state: 'set',
      },
    },
  ])('falha fechada para marcador ausente ou inválido %#', async (appMetadata) => {
    mocks.getUser.mockResolvedValue({
      data: { user: { ...verifiedUser, app_metadata: appMetadata } },
      error: null,
    });

    await expect(resolveReadyPreTenantOnboarding()).resolves.toEqual({
      ok: false,
      reason: 'credentials_invalid',
    });
  });

  it('preserva o redirecionamento de perfil existente sem exigir marcador de cadastro', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { ...verifiedUser, app_metadata: {} } },
      error: null,
    });
    mocks.readAuthoritativeProfile.mockResolvedValue({ mfaEnrolledAt: null });
    mocks.authenticate.mockResolvedValue({
      ok: true,
      identity: { userId: USER_ID, role: 'owner', aal: 'aal1' },
    });
    mocks.postLoginRedirect.mockReturnValue('/dashboard');

    await expect(resolveReadyPreTenantOnboarding()).resolves.toEqual({
      ok: true,
      kind: 'redirect',
      route: '/dashboard',
    });
  });
});
