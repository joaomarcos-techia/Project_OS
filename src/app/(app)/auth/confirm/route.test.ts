import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_CONFIRM_CONTENT_SECURITY_POLICY } from '@/lib/http/auth-confirm-security';

const mocks = vi.hoisted(() => ({
  ensureDraft: vi.fn(),
  ensureReadyOwnedBinding: vi.fn(),
  ensureAuthBinding: vi.fn(),
  validateAuthBinding: vi.fn(),
  readDraft: vi.fn(),
  clearSelector: vi.fn(),
  cookies: vi.fn(),
  cookieSet: vi.fn(),
  createServerClient: vi.fn(),
  loggerWarn: vi.fn(),
  readAuthoritativeProfile: vi.fn(),
  resolvePreTenant: vi.fn(),
  signOut: vi.fn(),
  signRecoveryGrant: vi.fn(),
  signSignupConfirmationGrant: vi.fn(),
  verifyOtp: vi.fn(),
  env: {
    NODE_ENV: 'test',
    APP_BASE_URL: 'https://app.qoro.test',
    VERCEL_ENV: undefined as 'preview' | undefined,
  },
}));

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/contexts/onboarding', () => ({
  ensureSignupDraftForVerifiedEmail: mocks.ensureDraft,
  ensureReadyOwnedSignupAuthBinding: mocks.ensureReadyOwnedBinding,
  ensureVerifiedSignupAuthBinding: mocks.ensureAuthBinding,
  validateVerifiedSignupAuthUserForClaim: mocks.validateAuthBinding,
  readSignupDraft: mocks.readDraft,
}));
vi.mock('@/lib/auth/recovery-grant', () => ({
  RECOVERY_GRANT_COOKIE: 'recovery',
  RECOVERY_GRANT_TTL_SECONDS: 600,
  signRecoveryGrant: mocks.signRecoveryGrant,
}));
vi.mock('@/lib/auth/signup-confirmation-grant', () => ({
  SIGNUP_CONFIRMATION_GRANT_COOKIE: 'qoro_signup_confirm',
  SIGNUP_CONFIRMATION_GRANT_TTL_SECONDS: 900,
  signSignupConfirmationGrant: mocks.signSignupConfirmationGrant,
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
vi.mock('@/lib/env', () => ({
  env: mocks.env,
}));
vi.mock('@/lib/observability/logger', () => ({ logger: { warn: mocks.loggerWarn } }));

import { GET, POST } from './route';

const origin = 'https://app.qoro.test';
const userId = '11111111-1111-4111-8111-111111111111';
const verifiedEmail = 'verified@example.invalid';
const signupRef = 'a'.repeat(64);
const client = {
  auth: { verifyOtp: mocks.verifyOtp, signOut: mocks.signOut },
};

function getRequest(query = ''): NextRequest {
  return new NextRequest(`${origin}/auth/confirm${query ? `?${query}` : ''}`);
}

function postRequest(
  body: string | URLSearchParams,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`${origin}/auth/confirm`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      origin,
      'sec-fetch-site': 'same-origin',
      ...headers,
    },
    body: typeof body === 'string' ? body : body.toString(),
  });
}

function signupBody(type: 'signup' | 'magiclink' | 'recovery' = 'recovery'): URLSearchParams {
  return new URLSearchParams({
    token_hash: 'token-seguro',
    type,
    next: '/cadastro/confirmado',
    signup_ref: signupRef,
  });
}

function redirectPath(response: Response): string {
  const location = response.headers.get('location');
  if (!location) throw new Error('resposta sem Location');
  const url = new URL(location);
  expect(url.searchParams.has('token_hash')).toBe(false);
  return `${url.pathname}${url.search}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.APP_BASE_URL = origin;
  mocks.env.VERCEL_ENV = undefined;
  mocks.cookies.mockResolvedValue({ set: mocks.cookieSet });
  mocks.createServerClient.mockResolvedValue(client);
  mocks.verifyOtp.mockResolvedValue({
    data: {
      user: {
        id: userId,
        email: verifiedEmail,
        email_confirmed_at: '2026-09-23T12:00:00Z',
      },
    },
    error: null,
  });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.resolvePreTenant.mockResolvedValue({
    ok: true,
    kind: 'pretenant',
    userId,
    email: verifiedEmail,
  });
  mocks.ensureDraft.mockResolvedValue({ ok: true, rowVersion: 7 });
  mocks.ensureReadyOwnedBinding.mockResolvedValue({ ok: true, signupRef });
  mocks.ensureAuthBinding.mockResolvedValue({ ok: true });
  mocks.validateAuthBinding.mockResolvedValue({ ok: true });
  mocks.readDraft.mockResolvedValue({ ok: false, reason: 'gone' });
  mocks.signRecoveryGrant.mockReturnValue('grant-assinado');
  mocks.signSignupConfirmationGrant.mockReturnValue('repair-grant-assinado');
});

describe('GET /auth/confirm — ponte que não consome OTP', () => {
  it('não entrega o segredo ao servidor no formato novo e nunca chama verifyOtp', async () => {
    const response = await GET();
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(response.headers.get('content-security-policy')).toBe(
      AUTH_CONFIRM_CONTENT_SECURITY_POLICY,
    );
    expect(response.headers.get('content-security-policy')).not.toContain('unsafe-inline');
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect(response.headers.get('content-security-policy')).toContain("form-action 'none'");
    expect(html).toContain("fetch('/auth/confirm'");
    expect(html).toContain("credentials: 'same-origin'");
    expect(html).toContain("window.history.replaceState(null, '', '/auth/confirm')");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it('mantém link query antigo como ponte sem consumir nem refletir o bearer no HTML', async () => {
    const response = await GET(
      getRequest(
        `token_hash=segredo-legado-irrepetivel&type=recovery&next=%2Fcadastro%2Fconfirmado&signup_ref=${signupRef}`,
      ),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).not.toContain('segredo-legado-irrepetivel');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.clearSelector).not.toHaveBeenCalled();
  });
});

describe('POST /auth/confirm — envelope estrito', () => {
  it('usa a origem HTTPS do deployment em Preview mesmo com APP_BASE_URL de outro Preview', async () => {
    mocks.env.VERCEL_ENV = 'preview';
    mocks.env.APP_BASE_URL = 'https://preview-antigo.vercel.app';
    const previewOrigin = 'https://project-os-git-branch-owner.vercel.app';
    const request = new NextRequest(`${previewOrigin}/auth/confirm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        origin: previewOrigin,
        'sec-fetch-site': 'same-origin',
      },
      body: signupBody().toString(),
    });

    const response = await POST(request);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${previewOrigin}/cadastro/confirmado`);
    expect(mocks.verifyOtp).toHaveBeenCalledOnce();
  });

  it('não confia em host externo quando VERCEL_ENV é Preview', async () => {
    mocks.env.VERCEL_ENV = 'preview';
    const externalOrigin = 'https://attacker.example';
    const request = new NextRequest(`${externalOrigin}/auth/confirm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        origin: externalOrigin,
        'sec-fetch-site': 'same-origin',
      },
      body: signupBody().toString(),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it('valida a origem pública configurada mesmo atrás de uma origem interna', async () => {
    const request = new NextRequest('http://127.0.0.1:3217/auth/confirm', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        origin,
        'sec-fetch-site': 'same-origin',
      },
      body: signupBody().toString(),
    });

    const response = await POST(request);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${origin}/cadastro/confirmado`);
    expect(mocks.verifyOtp).toHaveBeenCalledOnce();
  });

  it.each([
    ['Origin ausente', { origin: '' }],
    ['Origin externo', { origin: 'https://evil.example' }],
    ['Fetch Metadata externo', { 'sec-fetch-site': 'cross-site' }],
    ['Fetch Metadata divergente', { 'sec-fetch-site': 'same-site' }],
  ])('bloqueia %s antes do Auth', async (_label, headers) => {
    const response = await POST(postRequest(signupBody(), headers));
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it('aceita cliente que omite Fetch Metadata quando Origin prova mesma origem', async () => {
    const request = new NextRequest(`${origin}/auth/confirm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        origin,
      },
      body: signupBody().toString(),
    });

    const response = await POST(request);

    expect(response.status).toBe(303);
    expect(mocks.verifyOtp).toHaveBeenCalledOnce();
  });

  it('recusa content-type que não seja formulário', async () => {
    const response = await POST(
      postRequest(JSON.stringify(Object.fromEntries(signupBody())), {
        'content-type': 'application/json',
      }),
    );
    expect(response.status).toBe(415);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it.each([
    ['campo extra', `${signupBody()}&role=owner`],
    ['token duplicado', `${signupBody()}&token_hash=outro`],
    ['type duplicado', `${signupBody()}&type=signup`],
    ['token com controle', `${signupBody()}&token_hash=%0A`],
  ])('recusa corpo ambíguo: %s', async (_label, body) => {
    const response = await POST(postRequest(body));
    expect(response.status).toBe(400);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it('recusa corpo acima do teto', async () => {
    const response = await POST(postRequest(`token_hash=${'a'.repeat(5_000)}&type=recovery`));
    expect(response.status).toBe(413);
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
});

describe('POST /auth/confirm — confirmação do cadastro', () => {
  it('recusa confirmação sem referência antes de consumir o OTP', async () => {
    const body = signupBody();
    body.delete('signup_ref');
    const response = await POST(postRequest(body));
    expect(response.status).toBe(303);
    expect(redirectPath(response)).toBe('/auth/auth-error?reason=invalid_token');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it.each(['signup', 'magiclink', 'recovery'] as const)(
    'vincula o draft na ordem segura e responde 303: %s',
    async (type) => {
      const response = await POST(postRequest(signupBody(type)));

      expect(response.status).toBe(303);
      expect(redirectPath(response)).toBe('/cadastro/confirmado');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: 'token-seguro', type });
      expect(mocks.resolvePreTenant).not.toHaveBeenCalled();
      expect(mocks.ensureDraft).toHaveBeenCalledWith(userId, verifiedEmail, signupRef);
      expect(mocks.validateAuthBinding).toHaveBeenCalledWith({
        userId,
        email: verifiedEmail,
      });
      expect(mocks.ensureAuthBinding).toHaveBeenCalledWith({
        userId,
        email: verifiedEmail,
        signupRef,
      });
      expect(mocks.validateAuthBinding.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.ensureDraft.mock.invocationCallOrder[0]!,
      );
      expect(mocks.ensureDraft.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.ensureAuthBinding.mock.invocationCallOrder[0]!,
      );
    },
  );

  it('nega antes do claim quando a conta não tem marker pending', async () => {
    mocks.validateAuthBinding.mockResolvedValue({ ok: false, reason: 'obfuscated' });
    const response = await POST(postRequest(signupBody()));
    expect(redirectPath(response)).toBe('/auth/auth-error?reason=invalid_token');
    expect(mocks.ensureDraft).not.toHaveBeenCalled();
    expect(mocks.ensureAuthBinding).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.clearSelector).toHaveBeenCalledTimes(2);
  });

  it('não reata metadata quando outro draft venceu o claim', async () => {
    mocks.ensureDraft.mockResolvedValue({ ok: false, reason: 'gone' });
    const response = await POST(postRequest(signupBody()));
    expect(redirectPath(response)).toBe('/auth/auth-error?reason=invalid_token');
    expect(mocks.ensureAuthBinding).not.toHaveBeenCalled();
  });

  it('preserva a sessão para a página repetir falha transitória', async () => {
    mocks.ensureDraft.mockResolvedValue({ ok: false, reason: 'unavailable' });
    const response = await POST(postRequest(signupBody()));
    expect(redirectPath(response)).toBe('/cadastro/confirmado');
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.signSignupConfirmationGrant).toHaveBeenCalledWith(
      expect.objectContaining({ userId, signupRef }),
    );
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      'qoro_signup_confirm',
      'repair-grant-assinado',
      expect.objectContaining({ httpOnly: true, sameSite: 'strict', maxAge: 900 }),
    );
  });

  it('preserva a sessão para reparar rebind que falhou depois do claim', async () => {
    mocks.ensureAuthBinding.mockResolvedValue({ ok: false, reason: 'unavailable' });

    const response = await POST(postRequest(signupBody()));

    expect(redirectPath(response)).toBe('/cadastro/confirmado');
    expect(mocks.ensureDraft).toHaveBeenCalledOnce();
    expect(mocks.ensureAuthBinding).toHaveBeenCalledOnce();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.signSignupConfirmationGrant).toHaveBeenCalledWith(
      expect.objectContaining({ userId, signupRef }),
    );
  });

  it('preserva guard de magiclink legado com profile', async () => {
    mocks.resolvePreTenant.mockResolvedValue({ ok: true, kind: 'redirect', route: '/login/mfa' });
    const response = await POST(
      postRequest(new URLSearchParams({ token_hash: 'token-seguro', type: 'magiclink' })),
    );
    expect(redirectPath(response)).toBe('/login/mfa');
    expect(mocks.ensureDraft).not.toHaveBeenCalled();
  });
});

describe('POST /auth/confirm — recuperação e convite', () => {
  it('emite grant de profile e redireciona com 303', async () => {
    mocks.readAuthoritativeProfile.mockResolvedValue({ claimsVersion: 4 });
    const response = await POST(
      postRequest(
        new URLSearchParams({
          token_hash: 'token-seguro',
          type: 'recovery',
          next: '/reset-password',
        }),
      ),
    );

    expect(response.status).toBe(303);
    expect(redirectPath(response)).toBe('/reset-password');
    expect(mocks.signRecoveryGrant).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'profile', userId, epoch: 4 }),
    );
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      'recovery',
      'grant-assinado',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', maxAge: 600 }),
    );
  });

  it('emite grant pretenant preso a ref e row_version', async () => {
    mocks.readAuthoritativeProfile.mockResolvedValue(null);
    mocks.readDraft.mockResolvedValue({ ok: true, draft: { rowVersion: 9 } });
    const response = await POST(
      postRequest(
        new URLSearchParams({
          token_hash: 'token-seguro',
          type: 'recovery',
          next: '/reset-password',
        }),
      ),
    );

    expect(redirectPath(response)).toBe('/reset-password');
    expect(mocks.readDraft).toHaveBeenCalledWith(userId, signupRef);
    expect(mocks.ensureReadyOwnedBinding).toHaveBeenCalledWith({
      userId,
      email: verifiedEmail,
    });
    expect(mocks.signRecoveryGrant).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'pretenant', userId, epoch: 9, signupRef }),
    );
  });

  it('emite grant pretenant pelo epoch Auth quando o draft ja expirou', async () => {
    const orphanEpoch = Date.parse('2026-09-23T12:00:00.000Z');
    mocks.readAuthoritativeProfile.mockResolvedValue(null);
    mocks.ensureReadyOwnedBinding.mockResolvedValue({ ok: true, signupRef, orphanEpoch });

    const response = await POST(
      postRequest(
        new URLSearchParams({
          token_hash: 'token-seguro',
          type: 'recovery',
          next: '/reset-password',
        }),
      ),
    );

    expect(redirectPath(response)).toBe('/reset-password');
    expect(mocks.readDraft).not.toHaveBeenCalled();
    expect(mocks.signRecoveryGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'pretenant_orphan',
        userId,
        epoch: orphanEpoch,
        signupRef,
      }),
    );
  });

  it('aceita recovery de convite emitido pelo builder sem criar grant', async () => {
    const response = await POST(
      postRequest(
        new URLSearchParams({
          token_hash: 'token-seguro',
          type: 'recovery',
          next: '/convite',
        }),
      ),
    );
    expect(response.status).toBe(303);
    expect(redirectPath(response)).toBe('/convite');
    expect(mocks.signRecoveryGrant).not.toHaveBeenCalled();
  });

  it('falha fechado se recovery não corresponde a draft nem profile', async () => {
    mocks.readAuthoritativeProfile.mockResolvedValue(null);
    const response = await POST(
      postRequest(
        new URLSearchParams({
          token_hash: 'token-seguro',
          type: 'recovery',
          next: '/reset-password',
        }),
      ),
    );
    expect(redirectPath(response)).toBe('/auth/auth-error?reason=invalid_token');
    expect(mocks.signRecoveryGrant).not.toHaveBeenCalled();
  });
});

describe('POST /auth/confirm — falha sanitizada', () => {
  it.each([
    ['Token has expired for person@example.invalid', 'expired'],
    ['provider rejected person@example.invalid', 'invalid_token'],
  ])('registra somente motivo categorizado: %s', async (message, reason) => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: null }, error: { message } });
    const response = await POST(postRequest(signupBody('signup')));
    expect(response.status).toBe(303);
    expect(redirectPath(response)).toBe(`/auth/auth-error?reason=${reason}`);
    expect(mocks.loggerWarn).toHaveBeenCalledWith('auth.confirm.verify_failed', {
      type: 'signup',
      reason,
    });
    expect(JSON.stringify(mocks.loggerWarn.mock.calls)).not.toContain('person@example.invalid');
  });
});
