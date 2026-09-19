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
  resolvePreTenantOnboarding: vi.fn(),
  recordLoginAttempt: vi.fn(),
  redirect: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/auth/supabase-server', () => ({
  createServerClient: mocks.createServerClient,
}));
vi.mock('@/lib/auth/tenant-context', () => ({
  readAuthoritativeProfile: mocks.readAuthoritativeProfile,
}));
vi.mock('@/lib/auth/pretenant-onboarding', () => ({
  resolvePreTenantOnboarding: mocks.resolvePreTenantOnboarding,
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

/* ===================================================================== */
/* Captcha do Supabase (ADR-060, O-2b)                                    */
/* ===================================================================== */

describe('repasse do captchaToken', () => {
  function loginForm(over: Record<string, string> = {}): FormData {
    const data = new FormData();
    data.set('email', 'pessoa@example.test');
    data.set('password', 'senha-correta-123');
    for (const [k, v] of Object.entries(over)) data.set(k, v);
    return data;
  }

  beforeEach(() => {
    mocks.assertLoginAllowed.mockResolvedValue({ ok: true });
    mocks.createServerClient.mockResolvedValue({
      auth: {
        resetPasswordForEmail: mocks.resetPasswordForEmail,
        signInWithPassword: mocks.signInWithPassword,
        signOut: mocks.signOut,
      },
    });
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });
  });

  it('OMITE options quando não há token — não manda captchaToken vazio', async () => {
    const { loginAction } = await import('./actions');
    await loginAction({ error: null }, loginForm());

    // `{ captchaToken: '' }` seria token INVÁLIDO para o GoTrue, não ausente:
    // com o captcha ligado, todo login falharia.
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'pessoa@example.test',
      password: 'senha-correta-123',
    });
  });

  it('repassa o token quando o widget produziu um', async () => {
    const { loginAction } = await import('./actions');
    await loginAction({ error: null }, loginForm({ captchaToken: '0.tok-do-widget' }));

    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'pessoa@example.test',
      password: 'senha-correta-123',
      options: { captchaToken: '0.tok-do-widget' },
    });
  });

  it('captcha reprovado NÃO conta como tentativa de credencial', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { code: 'captcha_failed', message: 'captcha protection: request disallowed' },
    });

    const { loginAction } = await import('./actions');
    const result = await loginAction({ error: null }, loginForm({ captchaToken: 'gasto' }));

    // O ponto: contar isto em login_attempts deixaria um widget expirado
    // bloquear a conta de quem digitou a senha CERTA, e envenenaria o sinal de
    // brute-force com ruído de configuração.
    expect(mocks.recordLoginAttempt).not.toHaveBeenCalled();
    expect(mocks.metricsEmit).toHaveBeenCalledWith('auth.login.failed', {
      reason: 'captcha_failed',
    });
    expect(result.error).toMatch(/verificação de segurança/i);
    expect(result.error).not.toMatch(/senha/i);
  });

  it('credencial inválida continua contando e com a mensagem genérica', async () => {
    const { loginAction } = await import('./actions');
    const result = await loginAction({ error: null }, loginForm());

    expect(mocks.recordLoginAttempt).toHaveBeenCalledWith('email-hash', '203.0.113.7', false);
    expect(mocks.metricsEmit).toHaveBeenCalledWith('auth.login.failed', {
      reason: 'invalid_credentials',
    });
    expect(result).toEqual({ error: 'Email ou senha inválidos.' });
  });

  it('recuperação repassa o token e mantém a resposta indistinguível', async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({
      error: { code: 'captcha_failed', message: 'captcha protection: request disallowed' },
    });

    const data = new FormData();
    data.set('email', 'pessoa@example.test');
    data.set('captchaToken', '0.tok-recovery');
    const result = await forgotPasswordAction(PREVIOUS, data);

    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith(
      'pessoa@example.test',
      expect.objectContaining({ captchaToken: '0.tok-recovery' }),
    );
    // Resposta idêntica ao sucesso: um erro visível de captcha aqui seria um
    // oráculo a menos de ruído para quem enumera contas.
    expect(result).toEqual({ error: null, sent: true });
    expect(mocks.loggerWarn).toHaveBeenCalledWith('forgot_password.request_failed', {
      reason: 'captcha_failed',
    });
  });
});

describe('login de usuário verificado pré-tenant', () => {
  function loginForm(): FormData {
    const data = new FormData();
    data.set('email', 'verified@example.invalid');
    data.set('password', 'senha-correta-123');
    return data;
  }

  beforeEach(() => {
    mocks.assertLoginAllowed.mockResolvedValue({ ok: true });
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: '11111111-1111-4111-8111-111111111111' } },
      error: null,
    });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.createServerClient.mockResolvedValue({
      auth: {
        signInWithPassword: mocks.signInWithPassword,
        signOut: mocks.signOut,
      },
    });
    mocks.readAuthoritativeProfile.mockResolvedValue(null);
    mocks.resolvePreTenantOnboarding.mockResolvedValue({
      ok: true,
      kind: 'pretenant',
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'verified@example.invalid',
    });
    mocks.isRole.mockReturnValue(true);
    mocks.getAal.mockResolvedValue('aal1');
    mocks.postLoginRedirect.mockReturnValue('/dashboard');
    mocks.redirect.mockImplementation((destination: string) => {
      throw new Error(`REDIRECT:${destination}`);
    });
  });

  it('retoma cadastro somente depois da seam server-only', async () => {
    const { loginAction } = await import('./actions');
    await expect(loginAction({ error: null }, loginForm())).rejects.toThrow(
      'REDIRECT:/cadastro/continuar',
    );
    expect(mocks.resolvePreTenantOnboarding).toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('preserva redirect de profile/MFA decidido pela seam em caso de corrida', async () => {
    mocks.resolvePreTenantOnboarding.mockResolvedValue({
      ok: true,
      kind: 'redirect',
      route: '/login/mfa',
    });
    const { loginAction } = await import('./actions');
    await expect(loginAction({ error: null }, loginForm())).rejects.toThrow('REDIRECT:/login/mfa');
  });

  it.each(['unavailable', 'invalid_session', 'email_unverified', 'profile_denied'])(
    'fecha sessão quando a seam recusa: %s',
    async (reason) => {
      mocks.resolvePreTenantOnboarding.mockResolvedValue({ ok: false, reason });
      const { loginAction } = await import('./actions');
      await expect(loginAction({ error: null }, loginForm())).resolves.toEqual({
        error: 'Profile inválido. Contate o administrador.',
      });
      expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    },
  );

  it('mantém o caminho existente de profile válido e MFA', async () => {
    mocks.readAuthoritativeProfile.mockResolvedValue({
      role: 'owner',
      ativo: true,
      deletedAt: null,
      mfaEnrolledAt: null,
    });
    const { loginAction } = await import('./actions');
    await expect(loginAction({ error: null }, loginForm())).rejects.toThrow('REDIRECT:/dashboard');
    expect(mocks.resolvePreTenantOnboarding).not.toHaveBeenCalled();
    expect(mocks.getAal).toHaveBeenCalled();
    expect(mocks.postLoginRedirect).toHaveBeenCalledWith({
      role: 'owner',
      mfaEnrolledAt: null,
      aal: 'aal1',
    });
  });
});
