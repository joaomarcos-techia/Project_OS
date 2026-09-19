import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearSelector: vi.fn(),
  createServerClient: vi.fn(),
  loggerWarn: vi.fn(),
  readAuthoritativeProfile: vi.fn(),
  redirect: vi.fn(),
  resolvePreTenant: vi.fn(),
  signOut: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/auth/recovery-grant', () => ({
  RECOVERY_GRANT_COOKIE: 'recovery',
  RECOVERY_GRANT_TTL_SECONDS: 600,
  signRecoveryGrant: vi.fn(),
}));
vi.mock('@/lib/auth/supabase-server', () => ({
  clearSupabaseSessionSelector: mocks.clearSelector,
  createServerClient: mocks.createServerClient,
}));
vi.mock('@/lib/auth/pretenant-onboarding', () => ({
  resolvePreTenantOnboarding: mocks.resolvePreTenant,
}));
vi.mock('@/lib/auth/tenant-context', () => ({
  readAuthoritativeProfile: mocks.readAuthoritativeProfile,
}));
vi.mock('@/lib/env', () => ({ env: { NODE_ENV: 'test' } }));
vi.mock('@/lib/observability/logger', () => ({ logger: { warn: mocks.loggerWarn } }));

import { GET } from './route';

const client = {
  auth: { verifyOtp: mocks.verifyOtp, signOut: mocks.signOut },
};
const request = (query: string) => new NextRequest(`https://app.qoro.test/auth/confirm?${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  });
  mocks.createServerClient.mockResolvedValue(client);
  mocks.verifyOtp.mockResolvedValue({
    data: { user: { id: '11111111-1111-4111-8111-111111111111' } },
    error: null,
  });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.resolvePreTenant.mockResolvedValue({
    ok: true,
    kind: 'pretenant',
    userId: '11111111-1111-4111-8111-111111111111',
    email: 'verified@example.invalid',
  });
});

describe('GET /auth/confirm — signup', () => {
  it.each([
    'next=%2Fdashboard',
    'next=%2Fcadastro%2Fcontinuar%3Fdraft%3Dsecret',
    'next=https%3A%2F%2Fevil.example',
    '',
  ])('fixa o destino, verifica OTP e revalida a sessão: %s', async (next) => {
    await expect(GET(request(`token_hash=token&type=signup&${next}`))).rejects.toThrow(
      'REDIRECT:/cadastro/continuar',
    );
    expect(mocks.clearSelector).toHaveBeenCalledTimes(1);
    expect(mocks.createServerClient).toHaveBeenCalledWith({
      cookieWrites: 'required',
      newSession: true,
    });
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: 'token', type: 'signup' });
    expect(mocks.resolvePreTenant).toHaveBeenCalledWith(client);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('preserva o redirect decidido pelos guards de profile/MFA', async () => {
    mocks.resolvePreTenant.mockResolvedValue({ ok: true, kind: 'redirect', route: '/login/mfa' });
    await expect(GET(request('token_hash=token&type=signup'))).rejects.toThrow(
      'REDIRECT:/login/mfa',
    );
  });

  it.each(['invalid_session', 'anonymous', 'email_unverified', 'profile_denied', 'unavailable'])(
    'remove a sessão nova e falha fechado: %s',
    async (reason) => {
      mocks.resolvePreTenant.mockResolvedValue({ ok: false, reason });
      await expect(GET(request('token_hash=token&type=signup'))).rejects.toThrow(
        'REDIRECT:/auth/auth-error?reason=invalid_token',
      );
      expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(mocks.clearSelector).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ['Token has expired for person@example.invalid', 'expired'],
    ['provider rejected person@example.invalid', 'invalid_token'],
  ])('registra somente motivo categorizado: %s', async (message, reason) => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: null }, error: { message } });
    await expect(GET(request('token_hash=token&type=signup'))).rejects.toThrow(
      `REDIRECT:/auth/auth-error?reason=${reason}`,
    );
    expect(mocks.loggerWarn).toHaveBeenCalledWith('auth.confirm.verify_failed', {
      type: 'signup',
      reason,
    });
    expect(JSON.stringify(mocks.loggerWarn.mock.calls)).not.toContain('person@example.invalid');
    expect(mocks.resolvePreTenant).not.toHaveBeenCalled();
  });

  it('nega token/type ausentes antes de tocar cookies ou Auth', async () => {
    await expect(GET(request('type=signup'))).rejects.toThrow(
      'REDIRECT:/auth/auth-error?reason=missing_token',
    );
    await expect(GET(request('token_hash=token&type=bogus'))).rejects.toThrow(
      'REDIRECT:/auth/auth-error?reason=invalid_type',
    );
    expect(mocks.clearSelector).not.toHaveBeenCalled();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});
