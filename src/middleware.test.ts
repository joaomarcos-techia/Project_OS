import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SUPABASE_SESSION_SELECTOR_COOKIE } from './lib/auth/supabase-session-cookie';
import { config, middleware } from './middleware';

const LEGACY_COOKIE_NAME = 'sb-project-auth-token';
const COOKIE_PREFIX = 'sb-project-auth-token-v2';
const GENERATION_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const GENERATION_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function cookieName(generation: string): string {
  return `${COOKIE_PREFIX}-${generation}`;
}

function runsMiddlewareOn(pathname: string): boolean {
  return config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(pathname));
}

function encodedSession(expiresAt: number): string {
  return `base64-${Buffer.from(JSON.stringify({ expires_at: expiresAt })).toString('base64url')}`;
}

function activeSessionCookie(
  expiresAt: number,
  generation = GENERATION_A,
  chunked = false,
): string {
  const name = cookieName(generation);
  const value = encodedSession(expiresAt);
  const selector = `${SUPABASE_SESSION_SELECTOR_COOKIE}=${generation}`;
  if (!chunked) return `${selector}; ${name}=${value}`;
  const middle = Math.floor(value.length / 2);
  return `${selector}; ${name}.0=${value.slice(0, middle)}; ${name}.1=${value.slice(middle)}`;
}

function legacySessionCookie(expiresAt: number, chunked = false): string {
  const value = encodedSession(expiresAt);
  if (!chunked) return `${LEGACY_COOKIE_NAME}=${value}`;
  const middle = Math.floor(value.length / 2);
  return `${LEGACY_COOKIE_NAME}.0=${value.slice(0, middle)}; ${LEGACY_COOKIE_NAME}.1=${value.slice(middle)}`;
}

function request(path: string, cookie?: string, method = 'GET'): NextRequest {
  return new NextRequest(`https://qoro.test${path}`, {
    method,
    ...(cookie ? { headers: { cookie } } : {}),
  });
}

function expectOnlyExpirations(setCookies: string[], expectedNames: string[]): void {
  expect(setCookies).toHaveLength(expectedNames.length);
  for (const name of expectedNames) {
    const header = setCookies.find((cookie) => cookie.startsWith(`${name}=`));
    expect(header).toBeDefined();
    expect(header).toMatch(/Max-Age=0/i);
    expect(header).toMatch(/Expires=Thu, 01 Jan 1970 00:00:00 GMT/i);
    expect(header).not.toMatch(new RegExp(`^${name}=[^;]+`));
  }
}

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co'));
afterEach(() => vi.unstubAllEnvs());

describe('matcher de sessão e cutover HttpOnly', () => {
  it.each([
    '/api/webhooks/asaas',
    '/api/webhooks/meta',
    '/api/cron/outbox',
    '/api/health',
    '/monitoring',
    '/favicon.ico',
    '/_next/static/chunk.js',
  ])('não intercepta %s', (path) => {
    expect(runsMiddlewareOn(path)).toBe(false);
  });

  it.each([
    '/login',
    '/convite',
    '/reset-password',
    '/auth/confirm',
    '/auth/session-refresh',
    '/join/legacy',
    '/cadastro',
    '/api/signup/sessions',
    '/account/security',
  ])('mantém %s público sem inventar sessão', (path) => {
    expect(runsMiddlewareOn(path)).toBe(true);
    expect(middleware(request(path)).status).toBe(200);
  });

  it('redireciona página protegida sem sessão para login', () => {
    const response = middleware(request('/dashboard'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://qoro.test/login');
  });

  it.each(['/documentação', '/documenta%C3%A7%C3%A3o', '/documenta%c3%a7%c3%a3o'])(
    'mapeia %s sem perder a sessão, a consulta ou o endereço visível',
    (root) => {
      const cookie = activeSessionCookie(Math.floor(Date.now() / 1000) + 3600);
      const response = middleware(request(`${root}/agenda?origem=ajuda`, cookie));
      expect(response.status).toBe(200);
      expect(response.headers.get('x-middleware-rewrite')).toBe(
        'https://qoro.test/documentacao/agenda?origem=ajuda',
      );
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('x-request-id')).toBeTruthy();
    },
  );

  it('encaminha o endereço anterior para a URL solicitada, sem loop', () => {
    const cookie = activeSessionCookie(Math.floor(Date.now() / 1000) + 3600);
    const response = middleware(request('/documentacao/agenda?origem=antiga', cookie));
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(
      'https://qoro.test/documenta%C3%A7%C3%A3o/agenda?origem=antiga',
    );
  });

  it('não aplica o mapeamento a prefixos parecidos', () => {
    const cookie = activeSessionCookie(Math.floor(Date.now() / 1000) + 3600);
    const response = middleware(request('/documentacao-externa', cookie));
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('location')).toBeNull();
  });

  it.each(['/documentação', '/documenta%C3%A7%C3%A3o/agenda', '/documentacao'])(
    'mantém a ajuda dentro da conta, sem tornar o shell público: %s',
    (path) => {
      const response = middleware(request(path));
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('https://qoro.test/login');
    },
  );

  it.each(['success', 'cancelled', 'expired'])(
    'permite retorno público de pagamento %s sem sessão',
    (result) => {
      const response = middleware(request(`/?payment=${result}`));
      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
    },
  );

  it('não torna a raiz ou outros parâmetros públicos', () => {
    expect(middleware(request('/')).headers.get('location')).toBe('https://qoro.test/login');
    expect(middleware(request('/?payment=paid')).headers.get('location')).toBe(
      'https://qoro.test/login',
    );
  });

  it('invalida todos os fragmentos legados e exige novo login em rota protegida', () => {
    const response = middleware(
      request('/dashboard', legacySessionCookie(Date.now() / 1000 + 3600, true)),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://qoro.test/login');
    expectOnlyExpirations(response.headers.getSetCookie(), [
      `${LEGACY_COOKIE_NAME}.0`,
      `${LEGACY_COOKIE_NAME}.1`,
    ]);
  });

  it('invalida legado em página pública sem copiar o bearer para o nome novo', () => {
    const response = middleware(
      request('/login', legacySessionCookie(Date.now() / 1000 + 3600, true)),
    );
    expect(response.status).toBe(200);
    const setCookies = response.headers.getSetCookie();
    expectOnlyExpirations(setCookies, [`${LEGACY_COOKIE_NAME}.0`, `${LEGACY_COOKIE_NAME}.1`]);
    expect(setCookies.some((cookie) => cookie.startsWith(COOKIE_PREFIX))).toBe(false);
  });

  it('encaminha sessão v2 perto do vencimento sem reemitir o snapshot', () => {
    const response = middleware(
      request('/dashboard?tab=hoje', activeSessionCookie(Date.now() / 1000 + 60)),
    );
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/auth/session-refresh');
    expect(location.searchParams.get('next')).toBe('/dashboard?tab=hoje');
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });

  it('mantém sessão v2 longe do vencimento sem nenhum Set-Cookie no middleware', () => {
    const response = middleware(
      request('/dashboard', activeSessionCookie(Date.now() / 1000 + 3600)),
    );
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });

  it('não bloqueia cadastro público por causa de uma sessão legada expirada', () => {
    const response = middleware(request('/cadastro', legacySessionCookie(Date.now() / 1000 - 60)));
    expect(response.status).toBe(200);
    expectOnlyExpirations(response.headers.getSetCookie(), [LEGACY_COOKIE_NAME]);
  });

  it.each([
    '/convite?token_hash=novo&type=invite',
    '/convite?token_hash=novo&type=recovery',
    '/reset-password?token_hash=novo&type=recovery',
  ])('preserva token de e-mail novo e elimina sessão legada em %s', (path) => {
    const response = middleware(request(path, legacySessionCookie(Date.now() / 1000 - 60)));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expectOnlyExpirations(response.headers.getSetCookie(), [LEGACY_COOKIE_NAME]);
  });

  it('mantém a geração selecionada e remove cookies v2 inativos', () => {
    const active = activeSessionCookie(Date.now() / 1000 + 3600, GENERATION_B);
    const staleName = cookieName(GENERATION_A);
    const response = middleware(request('/dashboard', `${active}; ${staleName}=stale`));
    expect(response.status).toBe(200);
    expectOnlyExpirations(response.headers.getSetCookie(), [staleName]);
  });

  it('não confunde cookies de outro projeto com a sessão configurada', () => {
    const response = middleware(
      request(
        '/dashboard',
        `${SUPABASE_SESSION_SELECTOR_COOKIE}=${GENERATION_A}; sb-other-auth-token-v2-${GENERATION_A}=abc`,
      ),
    );
    expect(response.headers.get('location')).toBe('https://qoro.test/login');
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });

  it('uma GET antiga não consegue sobrescrever seletor ou cookie de uma sessão posterior', () => {
    const oldName = cookieName(GENERATION_A);
    const newName = cookieName(GENERATION_B);
    const stale = middleware(
      request('/dashboard', activeSessionCookie(Date.now() / 1000 + 3600, GENERATION_A)),
    );
    const staleHeaders = stale.headers.getSetCookie().join('\n');
    expect(staleHeaders).not.toContain(SUPABASE_SESSION_SELECTOR_COOKIE);
    expect(staleHeaders).not.toContain(oldName);
    expect(staleHeaders).not.toContain(newName);
  });

  it('não reemite geração ativa durante logout ou confirmação de identidade', () => {
    const cookie = activeSessionCookie(Date.now() / 1000 + 3600);
    const logout = middleware(request('/logout', cookie, 'POST'));
    expect(logout.headers.getSetCookie()).toHaveLength(0);
    const confirm = middleware(request('/auth/confirm', cookie));
    expect(confirm.headers.getSetCookie()).toHaveLength(0);
  });

  it('preserva x-request-id na resposta', () => {
    const response = middleware(request('/dashboard'));
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });
});
