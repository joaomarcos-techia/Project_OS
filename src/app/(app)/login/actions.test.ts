import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertLoginAllowed: vi.fn(),
  assertPasswordResetAllowed: vi.fn(),
  createPasswordResetRedirectUrl: vi.fn(),
  createServerClient: vi.fn(),
  getAal: vi.fn(),
  getClientIp: vi.fn(),
  hashEmail: vi.fn(),
  headers: vi.fn(),
  isRole: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  metricsEmit: vi.fn(),
  postLoginRedirect: vi.fn(),
  readAuthoritativeProfile: vi.fn(),
  recordLoginAttempt: vi.fn(),
  redirect: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/auth/supabase-server', () => ({
  createServerClient: mocks.createServerClient,
}));
vi.mock('@/lib/auth/tenant-context', () => ({
  readAuthoritativeProfile: mocks.readAuthoritativeProfile,
}));
vi.mock('@/lib/auth/email-hash', () => ({ hashEmail: mocks.hashEmail }));
vi.mock('@/lib/auth/login-audit', () => ({ recordLoginAttempt: mocks.recordLoginAttempt }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertLoginAllowed: mocks.assertLoginAllowed,
  assertPasswordResetAllowed: mocks.assertPasswordResetAllowed,
  getClientIp: mocks.getClientIp,
}));
vi.mock('@/lib/auth/policies', () => ({ postLoginRedirect: mocks.postLoginRedirect }));
vi.mock('@/lib/auth/mfa', () => ({ getAal: mocks.getAal }));
vi.mock('@/lib/auth/roles', () => ({ isRole: mocks.isRole }));
vi.mock('@/lib/http/application-url', () => ({
  createPasswordResetRedirectUrl: mocks.createPasswordResetRedirectUrl,
}));
vi.mock('@/lib/observability/logger', () => ({
  logger: { error: mocks.loggerError, warn: mocks.loggerWarn },
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.metricsEmit } }));

import { forgotPasswordAction } from './actions';

const PREVIOUS = { error: null, sent: false };

function form(email: string): FormData {
  const data = new FormData();
  data.set('email', email);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Headers());
  mocks.getClientIp.mockReturnValue('203.0.113.7');
  mocks.hashEmail.mockReturnValue('email-hash');
  mocks.assertPasswordResetAllowed.mockResolvedValue({ ok: true });
  mocks.createPasswordResetRedirectUrl.mockReturnValue('https://app.qoro.test/reset-password');
  mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
  mocks.createServerClient.mockResolvedValue({
    auth: { resetPasswordForEmail: mocks.resetPasswordForEmail },
  });
});

describe('forgotPasswordAction', () => {
  it('recusa sintaxe inválida antes do rate limit ou do provedor', async () => {
    const result = await forgotPasswordAction(PREVIOUS, form('email-invalido'));

    expect(result).toEqual({ error: 'Informe um e-mail válido.', sent: false });
    expect(mocks.assertPasswordResetAllowed).not.toHaveBeenCalled();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it('normaliza o e-mail e solicita recovery com o redirect allowlisted', async () => {
    const result = await forgotPasswordAction(PREVIOUS, form('  PESSOA@EXAMPLE.TEST  '));

    expect(mocks.assertPasswordResetAllowed).toHaveBeenCalledWith('203.0.113.7', 'email-hash');
    expect(mocks.hashEmail).toHaveBeenCalledWith('pessoa@example.test');
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('pessoa@example.test', {
      redirectTo: 'https://app.qoro.test/reset-password',
    });
    expect(result).toEqual({ error: null, sent: true });
  });

  it('responde genericamente quando o limite está esgotado', async () => {
    mocks.assertPasswordResetAllowed.mockResolvedValue({
      ok: false,
      reason: 'rate_limited',
    });

    const result = await forgotPasswordAction(PREVIOUS, form('pessoa@example.test'));

    expect(result).toEqual({ error: null, sent: true });
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.metricsEmit).toHaveBeenCalledWith('auth.ratelimit.tripped', {
      route: 'forgot-password',
    });
  });

  it('não expõe erro devolvido pelo provedor', async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({
      error: { message: 'smtp unavailable' },
    });

    const result = await forgotPasswordAction(PREVIOUS, form('pessoa@example.test'));

    expect(result).toEqual({ error: null, sent: true });
    expect(mocks.loggerWarn).toHaveBeenCalledWith('forgot_password.request_failed', {
      reason: 'provider_rejected',
    });
  });

  it('não expõe exceção operacional nem dados pessoais no log', async () => {
    mocks.createServerClient.mockRejectedValue(new Error('auth unavailable'));

    const result = await forgotPasswordAction(PREVIOUS, form('pessoa@example.test'));

    expect(result).toEqual({ error: null, sent: true });
    expect(mocks.loggerError).toHaveBeenCalledWith('forgot_password.request_failed', {
      reason: 'Error',
    });
  });
});
