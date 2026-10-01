import { beforeEach, describe, expect, it, vi } from 'vitest';

const { record, limit, config, hash } = vi.hoisted(() => ({
  record: vi.fn(),
  limit: vi.fn(),
  hash: vi.fn(),
  config: {
    SIGNUP_IDENTITY_ENABLED: true,
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
    VERCEL_ENV: undefined as 'preview' | undefined,
    VERCEL_URL: undefined as string | undefined,
    VERCEL_BRANCH_URL: undefined as string | undefined,
  },
}));
vi.mock('@/contexts/onboarding', async () => {
  const { signupIdentitySchema } = await import('@/contexts/onboarding/internal/signup-session');
  return { signupIdentitySchema, recordSignupIdentity: record, hashSignupToken: hash };
});
vi.mock('@/lib/env', () => ({ env: config }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupIdentityAllowed: limit,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/db', () => ({ dbAdmin: {} }));
import { POST } from './route';

const token = 'A'.repeat(42) + '-';
const data = {
  rowVersion: 1,
  ownerName: 'Alice',
  clinicName: 'Clínica',
  email: 'alice@example.test',
  accepted: true,
};
function request(body = JSON.stringify(data), cookie: string | undefined = token): Request {
  return new Request('https://app.qoro.test/api/signup/sessions/identity', {
    method: 'POST',
    body,
    headers: {
      origin: config.APP_BASE_URL,
      ...(cookie === undefined ? {} : { cookie: `__Host-qoro_signup=${cookie}` }),
    },
  });
}
describe('POST signup identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.SIGNUP_IDENTITY_ENABLED = true;
    config.APP_BASE_URL = 'https://app.qoro.test';
    config.NODE_ENV = 'test';
    config.VERCEL_ENV = undefined;
    config.VERCEL_URL = undefined;
    config.VERCEL_BRANCH_URL = undefined;
    limit.mockResolvedValue({ ok: true });
    hash.mockReturnValue('a'.repeat(64));
    record.mockResolvedValue({ ok: true, rowVersion: 2 });
  });
  it('uses decoded cookie and strict schema; exposes only version', async () => {
    const res = await POST(request(JSON.stringify(data), token.replace('-', '%2D')));
    expect(await res.json()).toEqual({ rowVersion: 2 });
    expect(record).toHaveBeenCalledWith(token, data);
    expect(limit).toHaveBeenCalledWith('127.0.0.1', 'a'.repeat(64));
  });
  it('clears absent cookie before reading the body', async () => {
    const req = request();
    req.headers.delete('cookie');
    const res = await POST(req);
    expect(res.status).toBe(410);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(req.bodyUsed).toBe(false);
    expect(limit).not.toHaveBeenCalled();
  });
  it('allows configured insecure localhost only outside production', async () => {
    config.APP_BASE_URL = 'http://localhost:3000';
    expect((await POST(request())).status).toBe(200);
    config.NODE_ENV = 'production';
    expect((await POST(request())).status).toBe(503);
    config.NODE_ENV = 'test';
  });
  it('aceita o alias auto-injetado da branch Preview mesmo com APP_BASE_URL antigo', async () => {
    const previewOrigin = 'https://project-os-git-branch-owner.vercel.app';
    config.VERCEL_ENV = 'preview';
    config.VERCEL_BRANCH_URL = new URL(previewOrigin).hostname;
    config.APP_BASE_URL = 'https://preview-antigo.vercel.app';
    const req = new Request(`${previewOrigin}/api/signup/sessions/identity`, {
      method: 'POST',
      body: JSON.stringify(data),
      headers: {
        origin: previewOrigin,
        'sec-fetch-site': 'same-origin',
        cookie: `__Host-qoro_signup=${token}`,
      },
    });

    expect((await POST(req)).status).toBe(200);
    expect(record).toHaveBeenCalledWith(token, data);
  });
  it.each(['missing', 'foreign', 'cross-site', 'spoofed-host'])(
    'blocks %s origin before body/limiter/writer',
    async (kind) => {
      const req = request();
      if (kind === 'missing') req.headers.delete('origin');
      if (kind === 'foreign' || kind === 'spoofed-host')
        req.headers.set('origin', 'https://evil.test');
      if (kind === 'spoofed-host') req.headers.set('host', 'evil.test');
      if (kind === 'cross-site') req.headers.set('sec-fetch-site', 'cross-site');
      expect((await POST(req)).status).toBe(403);
      expect(req.bodyUsed).toBe(false);
      expect(limit).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    },
  );
  it.each(['', '%', '%E0%A4', 'short', 'A'.repeat(44), '.'.repeat(43)])(
    'clears malformed cookie %s',
    async (cookie) => {
      const res = await POST(request(undefined, cookie));
      expect(res.status).toBe(410);
      expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
      expect(record).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['gone', 410],
    ['conflict', 409],
    ['unavailable', 503],
  ] as const)('maps writer %s safely', async (reason, status) => {
    record.mockResolvedValue({ ok: false, reason });
    const res = await POST(request());
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: reason });
    expect(res.headers.get('set-cookie')?.includes('Max-Age=0') ?? false).toBe(reason === 'gone');
  });
  it.each([
    '{',
    '{}',
    JSON.stringify({ ...data, accepted: false }),
    JSON.stringify({ ...data, clinicId: 'foreign' }),
    JSON.stringify({ ...data, ownerName: 'Alice\n' }),
  ])('rejects invalid input', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(record).not.toHaveBeenCalled();
  });
  it.each(['gate', 'configuration', 'limiter', 'hash', 'database'])(
    'fails closed on %s failure',
    async (kind) => {
      if (kind === 'gate') config.SIGNUP_IDENTITY_ENABLED = false;
      if (kind === 'configuration') config.APP_BASE_URL = 'http://evil.test';
      if (kind === 'limiter') limit.mockResolvedValue({ ok: false, reason: 'unavailable' });
      if (kind === 'hash')
        hash.mockImplementation(() => {
          throw new Error('secret unavailable');
        });
      if (kind === 'database') record.mockRejectedValue(new Error('raw PII database failure'));
      const req = request();
      const res = await POST(req);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'unavailable' });
      if (kind !== 'database') expect(record).not.toHaveBeenCalled();
      if (kind === 'gate' || kind === 'configuration' || kind === 'limiter')
        expect(req.bodyUsed).toBe(false);
    },
  );
  it('limits before reading PII and returns Retry-After', async () => {
    limit.mockResolvedValue({ ok: false, reason: 'rate_limited', retryAfter: 45 });
    const req = request();
    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('45');
    expect(req.bodyUsed).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });
  it('caps exact UTF-8 bytes with and without Content-Length', async () => {
    const body = JSON.stringify(data);
    const bytes = Buffer.byteLength(body);
    expect((await POST(request(body + ' '.repeat(4096 - bytes)))).status).toBe(200);
    record.mockClear();
    const req = request(body + ' '.repeat(4097 - bytes));
    req.headers.set('content-length', '1');
    expect((await POST(req)).status).toBe(413);
    expect((await POST(request(JSON.stringify({ name: 'é'.repeat(2048) })))).status).toBe(413);
    expect(record).not.toHaveBeenCalled();
  });
  it('cancels oversized streams early without Content-Length', async () => {
    let cancelled = false;
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          chunks++;
          controller.enqueue(new Uint8Array(4097));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      body,
      duplex: 'half',
      headers: request().headers,
    };
    expect(
      (await POST(new Request('https://app.qoro.test/api/signup/sessions/identity', init))).status,
    ).toBe(413);
    expect(cancelled).toBe(true);
    expect(chunks).toBe(1);
    expect(record).not.toHaveBeenCalled();
  });
});
