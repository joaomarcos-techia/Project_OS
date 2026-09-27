import { beforeEach, describe, expect, it, vi } from 'vitest';

const { config, reserve, finish, limit, create, resend, calls } = vi.hoisted(() => ({
  config: {
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
  },
  reserve: vi.fn(),
  finish: vi.fn(),
  limit: vi.fn(),
  create: vi.fn(),
  resend: vi.fn(),
  calls: [] as string[],
}));
vi.mock('@/lib/env', () => ({ env: config }));
vi.mock('@/lib/db', () => ({ dbAdmin: {} }));
vi.mock('@/contexts/onboarding', async () => {
  const { signupResendSchema } = await import('@/contexts/onboarding/internal/signup-session');
  return {
    signupResendSchema,
    reserveSignupResendAttempt: reserve,
    finishSignupResendAttempt: finish,
    hashSignupToken: () => 'a'.repeat(64),
  };
});
vi.mock('@/lib/auth/email-hash', () => ({ hashEmail: () => 'b'.repeat(64) }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupResendAllowed: limit,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/auth/supabase-server', () => ({ createServerClient: create }));

import { POST } from './route';

const token = 'a'.repeat(43);
const input = {
  rowVersion: 5,
  email: 'synthetic@example.invalid',
  accepted: true,
  captchaToken: 'fresh-resend',
};
function request(body = JSON.stringify(input), cookie = `__Host-qoro_signup=${token}`): Request {
  return new Request('https://app.qoro.test/api/signup/sessions/resend', {
    method: 'POST',
    body,
    headers: { cookie, origin: 'https://app.qoro.test', 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  Object.assign(config, {
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
  });
  limit.mockImplementation(async () => {
    calls.push('limit');
    return { ok: true };
  });
  reserve.mockImplementation(async () => {
    calls.push('reserve');
    return { ok: true, rowVersion: 6 };
  });
  create.mockImplementation(async () => {
    calls.push('create');
    return { auth: { resend } };
  });
  resend.mockImplementation(async () => {
    calls.push('auth');
    return { data: { user: null, session: null }, error: null };
  });
  finish.mockImplementation(async () => {
    calls.push('finish');
    return { ok: true, rowVersion: 7 };
  });
});

describe('POST signup resend', () => {
  it('limite e CAS precedem resend; retorno é uniforme e não carrega senha', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rowVersion: 7 });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(calls).toEqual(['limit', 'reserve', 'create', 'auth', 'finish']);
    expect(limit).toHaveBeenCalledWith('127.0.0.1', 'a'.repeat(64), 'b'.repeat(64));
    expect(create).toHaveBeenCalledWith({
      cookieWrites: 'required',
      sessionWrites: 'reject',
    });
    expect(resend).toHaveBeenCalledWith({
      type: 'signup',
      email: input.email,
      options: {
        emailRedirectTo: 'https://app.qoro.test/auth/confirm',
        captchaToken: 'fresh-resend',
      },
    });
    expect(JSON.stringify(resend.mock.calls)).not.toContain('password');
    expect(finish).toHaveBeenCalledWith(token, 6, 'completed');
  });

  it.each([
    'auth-gate',
    'identity-gate',
    'configuration',
    'missing-origin',
    'foreign-origin',
    'cross-site',
    'cookie',
  ])('nega cedo, sem ler body nem tocar SDK/DB: %s', async (kind) => {
    const req = request();
    let status = 403;
    if (kind === 'auth-gate') {
      config.SIGNUP_AUTH_ENABLED = false;
      status = 503;
    }
    if (kind === 'identity-gate') {
      config.SIGNUP_IDENTITY_ENABLED = false;
      status = 503;
    }
    if (kind === 'configuration') {
      config.APP_BASE_URL = 'http://evil.test';
      status = 503;
    }
    if (kind === 'missing-origin') req.headers.delete('origin');
    if (kind === 'foreign-origin') req.headers.set('origin', 'https://foreign.test');
    if (kind === 'cross-site') req.headers.set('sec-fetch-site', 'cross-site');
    if (kind === 'cookie') {
      req.headers.set('cookie', '__Host-qoro_signup=%E0%A4');
      status = 410;
    }
    const response = await POST(req);
    expect(response.status).toBe(status);
    expect(req.bodyUsed).toBe(false);
    expect(reserve).not.toHaveBeenCalled();
    expect(resend).not.toHaveBeenCalled();
    if (status === 410) expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it.each([
    '{',
    '{}',
    JSON.stringify({ ...input, accepted: false }),
    JSON.stringify({ ...input, password: 'Abcdef1!' }),
    JSON.stringify({ ...input, authUserId: 'forged' }),
    JSON.stringify({ ...input, captchaToken: 'x'.repeat(2049) }),
  ])('recusa body estrito sem reservar nem enviar: %s', async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_body' });
    expect(reserve).not.toHaveBeenCalled();
    expect(resend).not.toHaveBeenCalled();
  });

  it.each(['limiter', 'rate', 'cas', 'dead', 'cooldown', 'reserve-db'])(
    'mapeia limite/CAS/cooldown antes do SDK: %s',
    async (kind) => {
      const status =
        kind === 'rate' || kind === 'cooldown'
          ? 429
          : kind === 'cas'
            ? 409
            : kind === 'dead'
              ? 410
              : 503;
      if (kind === 'limiter') limit.mockResolvedValue({ ok: false, reason: 'unavailable' });
      if (kind === 'rate')
        limit.mockResolvedValue({ ok: false, reason: 'rate_limited', retryAfter: 45 });
      if (kind === 'cas' || kind === 'dead')
        reserve.mockResolvedValue({ ok: false, reason: kind === 'cas' ? 'conflict' : 'gone' });
      if (kind === 'cooldown')
        reserve.mockResolvedValue({ ok: false, reason: 'cooldown', retryAfter: 37 });
      if (kind === 'reserve-db') reserve.mockRejectedValue(new Error('raw DB body'));
      const response = await POST(request());
      expect(response.status).toBe(status);
      expect(resend).not.toHaveBeenCalled();
      expect(finish).not.toHaveBeenCalled();
      if (kind === 'rate') expect(response.headers.get('retry-after')).toBe('45');
      if (kind === 'cooldown') expect(response.headers.get('retry-after')).toBe('37');
    },
  );

  it.each([
    'timeout',
    'provider-5xx',
    'cookies',
    'unexpected-session',
    'finish-db',
    'finish-conflict',
  ])('incerteza não reenvia nem expõe erro bruto: %s', async (kind) => {
    if (kind === 'timeout') resend.mockRejectedValue(new Error(`raw ${input.email}`));
    if (kind === 'provider-5xx')
      resend.mockResolvedValue({
        data: { user: null, session: null },
        error: { status: 503, message: input.email },
      });
    if (kind === 'cookies') create.mockRejectedValue(new Error('cookie failure'));
    if (kind === 'unexpected-session')
      resend.mockResolvedValue({
        data: { user: null, session: { access_token: 'unsafe' } },
        error: null,
      });
    if (kind === 'finish-db') finish.mockRejectedValue(new Error('raw finalization error'));
    if (kind === 'finish-conflict') finish.mockResolvedValue({ ok: false, reason: 'conflict' });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unavailable' });
    expect(resend.mock.calls.length).toBeLessThanOrEqual(1);
    if (kind !== 'finish-db' && kind !== 'finish-conflict')
      expect(finish).toHaveBeenCalledWith(token, 6, 'uncertain');
  });

  it('aplica teto UTF-8 real e cancela stream excedente', async () => {
    const body = JSON.stringify(input);
    const bytes = Buffer.byteLength(body);
    expect((await POST(request(body + ' '.repeat(16_384 - bytes)))).status).toBe(200);
    resend.mockClear();
    expect((await POST(request(body + ' '.repeat(16_385 - bytes)))).status).toBe(413);
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(new Uint8Array(16_385));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const base = request();
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      body: stream,
      duplex: 'half',
      headers: base.headers,
    };
    expect((await POST(new Request(base.url, init))).status).toBe(413);
    expect(cancelled).toBe(true);
    expect(resend).not.toHaveBeenCalled();
  });
});
