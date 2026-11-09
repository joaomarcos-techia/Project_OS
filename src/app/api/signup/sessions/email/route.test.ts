import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  correct: vi.fn(),
  limit: vi.fn(),
  env: {
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
  },
}));
vi.mock('@/contexts/onboarding', async () => {
  const { z } = await import('zod');
  return {
    correctSignupEmail: m.correct,
    hashSignupToken: () => 'a'.repeat(64),
    signupEmailCorrectionSchema: z
      .object({
        rowVersion: z.number().int().positive(),
        currentEmail: z.string().email(),
        email: z.string().email(),
      })
      .strict()
      .refine((v) => v.currentEmail.toLowerCase() !== v.email.toLowerCase()),
  };
});
vi.mock('@/lib/env', () => ({ env: m.env }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupIdentityAllowed: m.limit,
  getClientIp: () => '127.0.0.1',
}));
import { POST } from './route';
const input = { rowVersion: 5, currentEmail: 'old@example.test', email: 'new@example.test' };
function request(body: unknown = input) {
  return new Request('https://app.qoro.test/api/signup/sessions/email', {
    method: 'POST',
    headers: {
      origin: 'https://app.qoro.test',
      'sec-fetch-site': 'same-origin',
      cookie: `__Host-qoro_signup=${'A'.repeat(43)}`,
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.env.SIGNUP_AUTH_ENABLED = true;
  m.correct.mockResolvedValue({ ok: true, rowVersion: 6 });
  m.limit.mockResolvedValue({ ok: true });
});
describe('session-bound email correction', () => {
  it('only returns version and never modifies Auth or sends mail in the handler', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rowVersion: 6 });
    expect(m.correct).toHaveBeenCalledWith('A'.repeat(43), input);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it.each(['foreign', 'missing', 'cross-site'])(
    'rejects %s origin before mutation',
    async (kind) => {
      const req = request();
      if (kind === 'foreign') req.headers.set('origin', 'https://evil.test');
      if (kind === 'missing') req.headers.delete('origin');
      if (kind === 'cross-site') req.headers.set('sec-fetch-site', 'cross-site');
      expect((await POST(req)).status).toBe(403);
      expect(m.correct).not.toHaveBeenCalled();
      expect(m.limit).not.toHaveBeenCalled();
    },
  );
  it('rejects missing cookie', async () => {
    const req = request();
    req.headers.delete('cookie');
    expect((await POST(req)).status).toBe(410);
    expect(m.correct).not.toHaveBeenCalled();
  });
  it.each([
    { ...input, email: input.currentEmail },
    { ...input, userId: 'forged' },
    { ...input, email: 'invalid' },
  ])('rejects invalid or ownership fields %#', async (value) => {
    expect((await POST(request(value))).status).toBe(400);
    expect(m.correct).not.toHaveBeenCalled();
  });
  it.each([
    ['gone', 410],
    ['conflict', 409],
    ['unavailable', 503],
  ] as const)('maps %s without leaking identities', async (reason, status) => {
    m.correct.mockResolvedValue({ ok: false, reason });
    expect((await POST(request())).status).toBe(status);
  });
  it('respects feature flags and rate limits', async () => {
    m.env.SIGNUP_AUTH_ENABLED = false;
    expect((await POST(request())).status).toBe(503);
    expect(m.correct).not.toHaveBeenCalled();
    m.env.SIGNUP_AUTH_ENABLED = true;
    m.limit.mockResolvedValue({ ok: false, reason: 'rate_limited', retryAfter: 60 });
    const r = await POST(request());
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('60');
    expect(m.correct).not.toHaveBeenCalled();
  });
  it('does not leak an internal error', async () => {
    m.correct.mockRejectedValue(new Error('private context'));
    const r = await POST(request());
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'unavailable' });
  });
});
