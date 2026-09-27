import { beforeEach, describe, expect, it, vi } from 'vitest';

const { config, reserve, readAttemptEpoch, finish, abort, limit, enviar, calls } = vi.hoisted(
  () => ({
    config: {
      SIGNUP_AUTH_ENABLED: true,
      SIGNUP_IDENTITY_ENABLED: true,
      APP_BASE_URL: 'https://app.qoro.test',
      NODE_ENV: 'test',
    },
    reserve: vi.fn(),
    readAttemptEpoch: vi.fn(),
    finish: vi.fn(),
    abort: vi.fn(),
    limit: vi.fn(),
    enviar: vi.fn(),
    calls: [] as string[],
  }),
);
vi.mock('@/lib/env', () => ({ env: config }));
vi.mock('@/lib/db', () => ({ dbAdmin: {} }));
vi.mock('@/contexts/onboarding', async () => {
  const { signupAuthSchema } = await import('@/contexts/onboarding/internal/signup-session');
  return {
    signupAuthSchema,
    reserveSignupAuthAttempt: reserve,
    readReservedSignupAttemptEpoch: readAttemptEpoch,
    finishSignupAuthAttempt: finish,
    abortSignupAuthAttempt: abort,
    sendSignupConfirmation: enviar,
    hashSignupToken: () => 'a'.repeat(64),
  };
});
vi.mock('@/lib/auth/email-hash', () => ({ hashEmail: () => 'b'.repeat(64) }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupAuthAllowed: limit,
  getClientIp: () => '127.0.0.1',
}));

import { POST } from './route';

const token = 'a'.repeat(43);
const input = {
  rowVersion: 3,
  email: 'synthetic@example.invalid',
  password: 'Abcdef1!',
  accepted: true,
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
  readAttemptEpoch.mockImplementation(async () => {
    calls.push('epoch');
    return 1_795_000_000_000;
  });
  enviar.mockImplementation(async () => {
    calls.push('enviar');
    return { kind: 'sent' };
  });
  finish.mockImplementation(async () => {
    calls.push('finish');
    return { ok: true, rowVersion: 5 };
  });
});

describe('POST signup auth', () => {
  it('limites e CAS precedem o envio; só e-mail e senha atravessam', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rowVersion: 5 });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(calls).toEqual(['limit', 'reserve', 'epoch', 'enviar', 'finish']);
    expect(limit).toHaveBeenCalledWith('127.0.0.1', 'a'.repeat(64), 'b'.repeat(64));
    // O envio recebe EXATAMENTE o par de que precisa. `rowVersion`, `accepted` e
    // Campos do CAS são assunto desta rota, não do emissor do link.
    expect(enviar).toHaveBeenCalledWith({
      email: input.email,
      password: input.password,
      signupRef: 'a'.repeat(64),
      attemptEpoch: 1_795_000_000_000,
    });
    expect(finish).toHaveBeenCalledWith(token, 4, 'completed');
  });
  it.each(['sent', 'obfuscated', 'uncertain'])('resposta pública uniforme: %s', async (kind) => {
    // `obfuscated` é conta que já existe, já confirmada ou banida: nada saiu, e a
    // resposta precisa ser indistinguível do envio — distinguir contaria a um
    // terceiro se aquele endereço tem conta aqui (§6).
    enviar.mockResolvedValue({ kind });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rowVersion: 5 });
    expect(finish).toHaveBeenCalledWith(token, 4, kind === 'uncertain' ? 'uncertain' : 'completed');
  });

  it('devolve a reserva e pede outra senha quando o provider recusa a senha', async () => {
    // Recusa por senha não depende de conta: o GoTrue avalia o valor enviado
    // antes de olhar o usuário. Tratá-la como desfecho uniforme deixava a pessoa
    // numa espera que nunca terminaria, porque e-mail nenhum havia saído.
    enviar.mockResolvedValue({ kind: 'weak_password' });
    abort.mockResolvedValue({ ok: true, rowVersion: 5 });

    const response = await POST(request());

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'weak_password', rowVersion: 5 });
    expect(abort).toHaveBeenCalledWith(token, 4);
    // A tentativa volta ao estado anterior: nada de `completed`/`uncertain`,
    // que gastariam a reserva e jogariam a pessoa no cooldown de reenvio.
    expect(finish).not.toHaveBeenCalled();
  });

  it('devolve a reserva quando o HIBP falha antes de qualquer efeito externo', async () => {
    enviar.mockResolvedValue({ kind: 'retryable' });
    abort.mockResolvedValue({ ok: true, rowVersion: 5 });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unavailable' });
    expect(abort).toHaveBeenCalledWith(token, 4);
    expect(finish).not.toHaveBeenCalled();
  });

  it('não vaza e-mail nem texto do provider na recusa de senha', async () => {
    enviar.mockResolvedValue({ kind: 'weak_password' });
    abort.mockResolvedValue({ ok: true, rowVersion: 5 });

    const body = JSON.stringify(await (await POST(request())).json());

    expect(body).not.toContain(input.email);
    expect(body).not.toContain(input.password);
  });

  it('fecha em 503 quando a devolução da reserva perde o CAS', async () => {
    enviar.mockResolvedValue({ kind: 'weak_password' });
    abort.mockResolvedValue({ ok: false, reason: 'conflict' });

    const response = await POST(request());

    // Reserva ainda de pé: o caminho conservador não pode afirmar envio nem
    // liberar uma nova tentativa sobre um estado que não voltou.
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unavailable' });
    expect(finish).not.toHaveBeenCalled();
  });

  it('resultado incerto nunca devolve a reserva nem enumera por status', async () => {
    // `uncertain` significa que algum efeito pode ter acontecido. Em qualquer
    // indeterminação o token pode já existir do lado do GoTrue, e devolver a
    // reserva liberaria uma segunda tentativa sobre um estado desconhecido.
    enviar.mockResolvedValue({ kind: 'uncertain' });

    const response = await POST(request());

    expect(abort).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(token, 4, 'uncertain');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rowVersion: 5 });
  });
  it.each([
    'auth-gate',
    'identity-gate',
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
    expect(enviar).not.toHaveBeenCalled();
    if (status === 410) expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
  it.each([
    '{',
    '{}',
    JSON.stringify({ ...input, accepted: false }),
    JSON.stringify({ ...input, authUserId: 'forged' }),
    JSON.stringify({ ...input, password: 'abcdefgh' }),
    JSON.stringify({ ...input, captchaToken: 'token-sem-efeito' }),
  ])('entrada inválida não chama Auth nem staging: %s', async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_body' });
    expect(reserve).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
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
      expect(enviar).not.toHaveBeenCalled();
      expect(finish).not.toHaveBeenCalled();
      if (kind === 'rate') expect(response.headers.get('retry-after')).toBe('45');
    },
  );
  it.each(['throw', 'uncertain', 'finish-db', 'finish-conflict'])(
    'incerteza sem sucesso/retry e sem erro bruto: %s',
    async (kind) => {
      if (kind === 'throw') enviar.mockRejectedValue(new Error(`raw ${input.password}`));
      if (kind === 'uncertain') enviar.mockResolvedValue({ kind: 'uncertain' });
      if (kind === 'finish-db') finish.mockRejectedValue(new Error('raw finalization error'));
      if (kind === 'finish-conflict') finish.mockResolvedValue({ ok: false, reason: 'conflict' });
      const response = await POST(request());
      const finalized = kind === 'throw' || kind === 'uncertain';
      expect(response.status).toBe(finalized ? 200 : 503);
      expect(await response.json()).toEqual(
        finalized ? { rowVersion: 5 } : { error: 'unavailable' },
      );
      expect(enviar.mock.calls.length).toBeLessThanOrEqual(1);
      if (kind !== 'finish-db' && kind !== 'finish-conflict')
        expect(finish).toHaveBeenCalledWith(token, 4, 'uncertain');
    },
  );
  it('teto exato/multibyte e Content-Length falso', async () => {
    const body = JSON.stringify(input),
      bytes = Buffer.byteLength(body);
    expect((await POST(request(body + ' '.repeat(16384 - bytes)))).status).toBe(200);
    enviar.mockClear();
    const oversized = request(body + ' '.repeat(16385 - bytes));
    oversized.headers.set('content-length', '1');
    expect((await POST(oversized)).status).toBe(413);
    expect((await POST(request(JSON.stringify({ data: '😀'.repeat(4096) })))).status).toBe(413);
    expect(enviar).not.toHaveBeenCalled();
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
    expect(enviar).not.toHaveBeenCalled();
  });
});
