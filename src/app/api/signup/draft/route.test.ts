import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
  },
  resolve: vi.fn(),
  hashUser: vi.fn(),
  readLimit: vi.fn(),
  writeLimit: vi.fn(),
  readDraft: vi.fn(),
  writeDraft: vi.fn(),
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/auth/signup-user-hash', () => ({ hashSignupUserId: mocks.hashUser }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupDraftReadAllowed: mocks.readLimit,
  assertSignupDraftWriteAllowed: mocks.writeLimit,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/db', () => ({ dbAdmin: {} }));
vi.mock('@/contexts/onboarding', async () => {
  const { signupDraftMutationSchema } = await import('@/contexts/onboarding/internal/signup-draft');
  return {
    signupDraftMutationSchema,
    readSignupDraft: mocks.readDraft,
    writeSignupDraft: mocks.writeDraft,
    resolveReadyOwnedSignupOnboarding: mocks.resolve,
  };
});

import { GET, POST } from './route';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const token = 'A'.repeat(42) + '-';
const signupRef = 'd'.repeat(64);
const answers = {
  professionalsBand: '2_5',
  weeklyAppointmentsBand: '21_50',
  currentTooling: 'outro_sistema',
  discoverySource: 'indicacao_colega',
} as const;
const restart = {
  ownerName: 'Pessoa Sintética',
  clinicName: 'Clínica Sintética',
  answers,
  accepted: true,
} as const;
const draft = {
  status: 'email_verified',
  rowVersion: 6,
  ownerName: restart.ownerName,
  clinicName: restart.clinicName,
  answers,
  idleExpiresAt: '2026-09-16T05:15:00.000Z',
  absoluteExpiresAt: '2026-09-16T06:00:00.000Z',
} as const;

function request(
  method: 'GET' | 'POST',
  body: string | undefined = method === 'POST' ? JSON.stringify(restart) : undefined,
  cookie: string | null = token,
): Request {
  return new Request('https://app.qoro.test/api/signup/draft', {
    method,
    ...(body === undefined ? {} : { body }),
    headers: {
      origin: mocks.env.APP_BASE_URL,
      ...(cookie === null ? {} : { cookie: `__Host-qoro_signup=${cookie}` }),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.env, {
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
  });
  mocks.resolve.mockResolvedValue({
    ok: true,
    kind: 'pretenant',
    userId: USER_ID,
    email: 'verified@example.invalid',
    signupRef,
  });
  mocks.hashUser.mockReturnValue('c'.repeat(64));
  mocks.readLimit.mockResolvedValue({ ok: true });
  mocks.writeLimit.mockResolvedValue({ ok: true });
  mocks.readDraft.mockResolvedValue({ ok: true, draft });
  mocks.writeDraft.mockResolvedValue({ ok: true, rowVersion: 6 });
});

describe('GET /api/signup/draft', () => {
  it('revalida owner, limita por HMAC e retorna somente o draft sanitizado sem renovar TTL', async () => {
    const response = await GET(request('GET'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(draft);
    expect(mocks.readLimit).toHaveBeenCalledWith('127.0.0.1', 'c'.repeat(64));
    expect(mocks.readDraft).toHaveBeenCalledWith(USER_ID, signupRef);
    expect(JSON.stringify(await (await GET(request('GET'))).json())).not.toContain(
      'verified@example.invalid',
    );
  });

  it.each([
    ['cookie anônimo antigo', token],
    ['sem cookie anônimo', null],
  ])('usa a referência autoritativa mesmo com %s', async (_case, cookie) => {
    const response = await GET(request('GET', undefined, cookie));

    expect(response.status).toBe(200);
    expect(mocks.readDraft).toHaveBeenCalledWith(USER_ID, signupRef);
  });

  it('não vincula por navegação cross-site, mesmo com sessão verificada', async () => {
    const cross = new Request('https://app.qoro.test/api/signup/draft', {
      headers: { 'sec-fetch-site': 'cross-site', cookie: `__Host-qoro_signup=${token}` },
    });

    expect((await GET(cross)).status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.readDraft).not.toHaveBeenCalled();
  });

  it('mantém 410 quando não há draft do usuário nem candidato pelo e-mail verificado', async () => {
    mocks.readDraft.mockResolvedValue({ ok: false, reason: 'gone' });
    const response = await GET(request('GET'));

    expect(response.status).toBe(410);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each([
    ['invalid_session', 401],
    ['anonymous', 401],
    ['email_unverified', 401],
    ['profile_denied', 403],
    ['credentials_pending', 403],
    ['credentials_invalid', 403],
    ['unavailable', 503],
  ] as const)('mapeia seam %s sem tocar limiter/DB', async (reason, status) => {
    mocks.resolve.mockResolvedValue({ ok: false, reason });
    expect((await GET(request('GET'))).status).toBe(status);
    expect(mocks.readLimit).not.toHaveBeenCalled();
    expect(mocks.readDraft).not.toHaveBeenCalled();
  });

  it('recusa profile existente e fecha limiter/reader indisponíveis', async () => {
    mocks.resolve.mockResolvedValue({ ok: true, kind: 'redirect', route: '/dashboard' });
    expect((await GET(request('GET'))).status).toBe(403);
    mocks.resolve.mockResolvedValue({
      ok: true,
      kind: 'pretenant',
      userId: USER_ID,
      email: 'verified@example.invalid',
    });
    mocks.readLimit.mockResolvedValue({ ok: false, reason: 'unavailable' });
    expect((await GET(request('GET'))).status).toBe(503);
    mocks.readLimit.mockResolvedValue({ ok: false, reason: 'rate_limited', retryAfter: 45 });
    const rate = await GET(request('GET'));
    expect(rate.status).toBe(429);
    expect(rate.headers.get('retry-after')).toBe('45');
    mocks.readLimit.mockResolvedValue({ ok: true });
    mocks.readDraft.mockResolvedValue({ ok: false, reason: 'unavailable' });
    expect((await GET(request('GET'))).status).toBe(503);
  });
});

describe('POST /api/signup/draft', () => {
  it('cria o draft do usuário verificado e limpa o bootstrap só depois do commit', async () => {
    const response = await POST(request('POST'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rowVersion: 6 });
    // Nenhum token do navegador atravessa a fronteira: a autoridade é a
    // identidade verificada, e o corpo não carrega id, versão nem modo.
    expect(mocks.writeDraft).toHaveBeenCalledWith({
      userId: USER_ID,
      email: 'verified@example.invalid',
      input: restart,
    });
    expect(response.headers.get('set-cookie')).toContain('__Host-qoro_signup=');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('não exige cookie anônimo nenhum para recomeçar em outro aparelho', async () => {
    const response = await POST(request('POST', JSON.stringify(restart), null));
    expect(response.status).toBe(200);
    expect(mocks.writeDraft).toHaveBeenCalledWith({
      userId: USER_ID,
      email: 'verified@example.invalid',
      input: restart,
    });
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it.each([
    ['conflict', 409],
    ['unavailable', 503],
  ] as const)('mapeia writer %s sem limpar cookie', async (reason, status) => {
    mocks.writeDraft.mockResolvedValue({ ok: false, reason });
    const response = await POST(request('POST'));
    expect(response.status).toBe(status);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each(['missing', 'foreign', 'cross-site'])(
    'nega %s antes de Auth/body/limiter',
    async (kind) => {
      const req = request('POST');
      if (kind === 'missing') req.headers.delete('origin');
      if (kind === 'foreign') req.headers.set('origin', 'https://evil.test');
      if (kind === 'cross-site') req.headers.set('sec-fetch-site', 'cross-site');
      const response = await POST(req);
      expect(response.status).toBe(403);
      expect(req.bodyUsed).toBe(false);
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(mocks.writeLimit).not.toHaveBeenCalled();
    },
  );

  it.each([
    '{',
    '{}',
    JSON.stringify({ ...restart, accepted: false }),
    JSON.stringify({ ...restart, role: 'owner' }),
    JSON.stringify({ ...restart, authUserId: USER_ID }),
    JSON.stringify({ ...restart, mode: 'link', rowVersion: 5 }),
    JSON.stringify({ ...restart, answers: { ...answers, discoverySource: 'livre' } }),
  ])('recusa body estrito depois do limite, sem writer: %s', async (body) => {
    const response = await POST(request('POST', body));
    expect(response.status).toBe(400);
    expect(mocks.writeLimit).toHaveBeenCalled();
    expect(mocks.writeDraft).not.toHaveBeenCalled();
  });

  it('limita antes de ler PII e fecha em exceções', async () => {
    mocks.writeLimit.mockResolvedValue({ ok: false, reason: 'rate_limited', retryAfter: 30 });
    const req = request('POST');
    const rate = await POST(req);
    expect(rate.status).toBe(429);
    expect(rate.headers.get('retry-after')).toBe('30');
    expect(req.bodyUsed).toBe(false);
    mocks.writeLimit.mockRejectedValue(new Error('raw redis'));
    expect((await POST(request('POST'))).status).toBe(503);
    mocks.writeLimit.mockResolvedValue({ ok: true });
    mocks.writeDraft.mockRejectedValue(new Error('raw DB PII'));
    expect((await POST(request('POST'))).status).toBe(503);
  });

  it('aplica teto real UTF-8 e cancela stream excedente', async () => {
    const body = JSON.stringify(restart);
    expect(
      (await POST(request('POST', body + ' '.repeat(4096 - Buffer.byteLength(body))))).status,
    ).toBe(200);
    mocks.writeDraft.mockClear();
    expect(
      (await POST(request('POST', body + ' '.repeat(4097 - Buffer.byteLength(body))))).status,
    ).toBe(413);
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(new Uint8Array(4097));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const streamed = request('POST');
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      body: stream,
      duplex: 'half',
      headers: streamed.headers,
    };
    expect((await POST(new Request(streamed.url, init))).status).toBe(413);
    expect(cancelled).toBe(true);
    expect(mocks.writeDraft).not.toHaveBeenCalled();
  });
});
