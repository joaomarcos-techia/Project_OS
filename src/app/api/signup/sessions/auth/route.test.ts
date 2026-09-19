import { beforeEach, describe, expect, it, vi } from 'vitest';

const { config, reserve, finish, abort, limit, create, signUp, calls } = vi.hoisted(() => ({
  config: {
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
  },
  reserve: vi.fn(),
  finish: vi.fn(),
  abort: vi.fn(),
  limit: vi.fn(),
  create: vi.fn(),
  signUp: vi.fn(),
  calls: [] as string[],
}));
vi.mock('@/lib/env', () => ({ env: config }));
vi.mock('@/lib/db', () => ({ dbAdmin: {} }));
vi.mock('@/contexts/onboarding', async () => {
  const { signupAuthSchema } = await import('@/contexts/onboarding/internal/signup-session');
  return {
    signupAuthSchema,
    reserveSignupAuthAttempt: reserve,
    finishSignupAuthAttempt: finish,
    abortSignupAuthAttempt: abort,
    hashSignupToken: () => 'a'.repeat(64),
  };
});
vi.mock('@/lib/auth/email-hash', () => ({ hashEmail: () => 'b'.repeat(64) }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupAuthAllowed: limit,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/auth/supabase-server', () => ({ createServerClient: create }));

import { POST } from './route';

const token = 'a'.repeat(43);
const input = {
  rowVersion: 3,
  email: 'synthetic@example.invalid',
  password: 'Abcdef1!',
  accepted: true,
  captchaToken: 'fresh-signup',
};
function request(body = JSON.stringify(input), cookie = `__Host-qoro_signup=${token}`): Request {
  return new Request('https://app.qoro.test/api/signup/sessions/auth', {
    method: 'POST',
    body,
    headers: { cookie, origin: 'https://app.qoro.test', 'content-type': 'application/json' },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  config.SIGNUP_AUTH_ENABLED = true;
  config.SIGNUP_IDENTITY_ENABLED = true;
  config.APP_BASE_URL = 'https://app.qoro.test';
  limit.mockImplementation(async () => {
    calls.push('limit');
    return { ok: true };
  });
  reserve.mockImplementation(async () => {
    calls.push('reserve');
    return { ok: true, rowVersion: 4 };
  });
  create.mockImplementation(async () => {
    calls.push('create');
    return { auth: { signUp } };
  });
  signUp.mockImplementation(async () => {
    calls.push('auth');
    return { data: { user: { id: 'unsafe-returned-uuid' }, session: null }, error: null };
  });
  finish.mockImplementation(async () => {
    calls.push('finish');
    return { ok: true, rowVersion: 5 };
  });
});

describe('POST signup auth', () => {
  it('limites e CAS precedem SDK; retorno só versão, required/new generation e captcha novo', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rowVersion: 5 });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(calls).toEqual(['limit', 'reserve', 'create', 'auth', 'finish']);
    expect(limit).toHaveBeenCalledWith('127.0.0.1', 'a'.repeat(64), 'b'.repeat(64));
    expect(create).toHaveBeenCalledWith({
      newSession: true,
      cookieWrites: 'required',
      sessionWrites: 'reject',
    });
    expect(signUp).toHaveBeenCalledWith({
      email: input.email,
      password: input.password,
      options: {
        emailRedirectTo: 'https://app.qoro.test/auth/confirm',
        captchaToken: 'fresh-signup',
      },
    });
    expect(finish).toHaveBeenCalledWith(token, 4, 'completed');
  });
  it.each(['new', 'verified', 'unverified', 'user_already_exists', 'email_exists', 'user_banned'])(
    'resposta pública uniforme: %s',
    async (kind) => {
      signUp.mockResolvedValue({
        data: { user: { id: kind, email: input.email, identities: [] }, session: null },
        error: kind.includes('_') ? { code: kind, message: `raw provider ${input.email}` } : null,
      });
      const response = await POST(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ rowVersion: 5 });
      expect(finish).toHaveBeenCalledWith(token, 4, 'completed');
    },
  );

  it('devolve a reserva e pede outra senha quando o provider recusa a senha', async () => {
    // Recusa por senha não depende de conta: o GoTrue avalia o valor enviado
    // antes de olhar o usuário. Tratá-la como desfecho uniforme deixava a pessoa
    // numa espera que nunca terminaria, porque e-mail nenhum havia saído.
    signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'weak_password', message: `raw provider ${input.email}` },
    });
    abort.mockResolvedValue({ ok: true, rowVersion: 5 });

    const response = await POST(request());

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'weak_password' });
    expect(abort).toHaveBeenCalledWith(token, 4);
    // A tentativa volta ao estado anterior: nada de `completed`/`uncertain`,
    // que gastariam a reserva e jogariam a pessoa no cooldown de reenvio.
    expect(finish).not.toHaveBeenCalled();
  });

  it('não vaza e-mail nem texto do provider na recusa de senha', async () => {
    signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'weak_password', message: `raw provider ${input.email} pwned` },
    });
    abort.mockResolvedValue({ ok: true, rowVersion: 5 });

    const body = JSON.stringify(await (await POST(request())).json());

    expect(body).not.toContain(input.email);
    expect(body).not.toContain('pwned');
    expect(body).not.toContain(input.password);
  });

  it('fecha em 503 quando a devolução da reserva perde o CAS', async () => {
    signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'weak_password', message: 'weak' },
    });
    abort.mockResolvedValue({ ok: false, reason: 'conflict' });

    const response = await POST(request());

    // Reserva ainda de pé: o caminho conservador não pode afirmar envio nem
    // liberar uma nova tentativa sobre um estado que não voltou.
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unavailable' });
    expect(finish).not.toHaveBeenCalled();
  });

  it('sessão inesperada com senha fraca continua sendo resultado incerto', async () => {
    // Se o provider devolveu sessão, a premissa "nada foi enviado" caiu por
    // terra; não há reserva a devolver.
    signUp.mockResolvedValue({
      data: {
        user: { id: 'u', email: input.email, identities: [] },
        session: { access_token: 'x' },
      },
      error: { code: 'weak_password', message: 'weak' },
    });

    const response = await POST(request());

    expect(abort).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(token, 4, 'uncertain');
    expect(response.status).toBe(503);
  });

  it.each([
    'auth-gate',
    'identity-gate',
    'configuration',
    'missing-origin',
    'foreign-origin',
    'cross-site',
    'cookie',
  ])('nega cedo, zero SDK/DB: %s', async (kind) => {
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
    expect(signUp).not.toHaveBeenCalled();
    if (status === 410) expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
  it.each([
    '{',
    '{}',
    JSON.stringify({ ...input, accepted: false }),
    JSON.stringify({ ...input, authUserId: 'forged' }),
    JSON.stringify({ ...input, password: 'abcdefgh' }),
    JSON.stringify({ ...input, captchaToken: 'x'.repeat(2049) }),
  ])('entrada inválida não chama Auth nem staging: %s', async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_body' });
    expect(reserve).not.toHaveBeenCalled();
    expect(signUp).not.toHaveBeenCalled();
  });
  it.each(['limiter', 'rate', 'cas', 'dead', 'reserve-db'])(
    'nega limite/CAS/TTL antes de Auth: %s',
    async (kind) => {
      const status = kind === 'rate' ? 429 : kind === 'cas' ? 409 : kind === 'dead' ? 410 : 503;
      if (kind === 'limiter') limit.mockResolvedValue({ ok: false, reason: 'unavailable' });
      if (kind === 'rate')
        limit.mockResolvedValue({ ok: false, reason: 'rate_limited', retryAfter: 45 });
      if (kind === 'cas' || kind === 'dead')
        reserve.mockResolvedValue({ ok: false, reason: kind === 'cas' ? 'conflict' : 'gone' });
      if (kind === 'reserve-db') reserve.mockRejectedValue(new Error('raw DB body'));
      const response = await POST(request());
      expect(response.status).toBe(status);
      expect(signUp).not.toHaveBeenCalled();
      expect(finish).not.toHaveBeenCalled();
      if (kind === 'rate') expect(response.headers.get('retry-after')).toBe('45');
    },
  );
  it.each([
    'timeout',
    'provider-5xx',
    'cookies',
    'unexpected-session',
    'finish-db',
    'finish-conflict',
  ])('incerteza sem sucesso/retry e sem erro bruto: %s', async (kind) => {
    if (kind === 'timeout') signUp.mockRejectedValue(new Error(`raw ${input.password}`));
    if (kind === 'provider-5xx')
      signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: { status: 503, message: input.email },
      });
    if (kind === 'cookies') create.mockRejectedValue(new Error('cookie failure'));
    if (kind === 'unexpected-session')
      signUp.mockResolvedValue({
        data: { user: null, session: { access_token: 'unsafe' } },
        error: null,
      });
    if (kind === 'finish-db') finish.mockRejectedValue(new Error('raw finalization error'));
    if (kind === 'finish-conflict') finish.mockResolvedValue({ ok: false, reason: 'conflict' });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unavailable' });
    expect(signUp.mock.calls.length).toBeLessThanOrEqual(1);
    if (kind !== 'finish-db' && kind !== 'finish-conflict')
      expect(finish).toHaveBeenCalledWith(token, 4, 'uncertain');
  });
  it('teto exato/multibyte e Content-Length falso', async () => {
    const body = JSON.stringify(input),
      bytes = Buffer.byteLength(body);
    expect((await POST(request(body + ' '.repeat(16384 - bytes)))).status).toBe(200);
    signUp.mockClear();
    const oversized = request(body + ' '.repeat(16385 - bytes));
    oversized.headers.set('content-length', '1');
    expect((await POST(oversized)).status).toBe(413);
    expect((await POST(request(JSON.stringify({ data: '😀'.repeat(4096) })))).status).toBe(413);
    expect(signUp).not.toHaveBeenCalled();
  });
  it('cancela stream acima do teto no primeiro chunk', async () => {
    let cancelled = false,
      chunks = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          chunks++;
          controller.enqueue(new Uint8Array(16385));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      body: stream,
      duplex: 'half',
      headers: request().headers,
    };
    expect((await POST(new Request(request().url, init))).status).toBe(413);
    expect(cancelled).toBe(true);
    expect(chunks).toBe(1);
    expect(signUp).not.toHaveBeenCalled();
  });
});
