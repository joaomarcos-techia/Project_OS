import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  confirm: vi.fn(),
  set: vi.fn(),
  sign: vi.fn(),
  limit: vi.fn(),
  env: {
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
  },
}));
vi.mock('@/lib/env', () => ({ env: m.env }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: m.set }) }));
vi.mock('@/lib/auth/signup-confirmation-grant', () => ({
  signSignupConfirmationGrant: m.sign,
  SIGNUP_CONFIRMATION_GRANT_COOKIE: 'qoro_signup_confirm',
  SIGNUP_CONFIRMATION_GRANT_TTL_SECONDS: 900,
}));
vi.mock('@/contexts/onboarding', async () => {
  const { z } = await import('zod');
  return {
    confirmSignupEmailCode: m.confirm,
    hashSignupToken: () => 'ref',
    signupEmailCodeSchema: z
      .object({ email: z.string().email(), code: z.string().regex(/^\d{8}$/u) })
      .strict(),
  };
});
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupContinuationAllowed: m.limit,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/auth/email-hash', () => ({ hashEmail: () => 'email-hmac' }));
import { POST } from './route';
const input = { email: 'synthetic@example.test', code: '12345678' };
function req(
  body: unknown = input,
  origin = 'https://app.qoro.test',
  cookie: string | null = 'A'.repeat(43),
) {
  const headers = new Headers({
    origin,
    'content-type': 'application/json',
    'sec-fetch-site': 'same-origin',
  });
  if (cookie !== null) headers.set('cookie', `__Host-qoro_signup=${cookie}`);
  return new Request('https://app.qoro.test/api/signup/sessions/verify', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.env.SIGNUP_AUTH_ENABLED = true;
  m.env.SIGNUP_IDENTITY_ENABLED = true;
  m.limit.mockResolvedValue({ ok: true });
  m.confirm.mockResolvedValue({ ok: true, next: '/cadastro/plano' });
});
describe('email code HTTP boundary', () => {
  it('keeps a valid code proof server-only when a legacy credential still needs completion', async () => {
    m.sign.mockReturnValue('signed-mail-proof');
    m.confirm.mockResolvedValue({
      ok: true,
      next: '/cadastro/confirmado',
      mailProof: { userId: 'id', signupRef: 'ref' },
    });
    const response = await POST(req());
    expect(await response.json()).toEqual({ next: '/cadastro/confirmado' });
    expect(m.set).toHaveBeenCalledWith('qoro_signup_confirm', 'signed-mail-proof', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 900,
    });
  });
  it('uses the verification budget, not the account-creation budget', async () => {
    const response = await POST(req());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ next: '/cadastro/plano' });
    expect(m.limit).toHaveBeenCalledWith('127.0.0.1', 'ref', 'email-hmac');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it.each([null, 'short', '%E0%A4%A'])(
    'rejects missing/malformed browser authority %s',
    async (cookie) => {
      expect((await POST(req(input, 'https://app.qoro.test', cookie))).status).toBe(410);
      expect(m.confirm).not.toHaveBeenCalled();
    },
  );
  it('rejects cross-origin before looking up the code', async () => {
    expect((await POST(req(input, 'https://evil.example'))).status).toBe(403);
    expect(m.limit).not.toHaveBeenCalled();
    expect(m.confirm).not.toHaveBeenCalled();
  });
  it.each([
    { ...input, userId: 'forged' },
    { ...input, password: 'unexpected' },
    { ...input, code: '0000' },
  ])('rejects unsupported client input', async (body) => {
    expect((await POST(req(body))).status).toBe(400);
    expect(m.confirm).not.toHaveBeenCalled();
  });
  it.each([
    ['invalid', 422],
    ['expired', 422],
    ['locked', 429],
    ['conflict', 409],
    ['gone', 410],
    ['unavailable', 503],
  ] as const)('maps %s without provider details', async (reason, status) => {
    m.confirm.mockResolvedValue({ ok: false, reason });
    const response = await POST(req());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: reason });
  });
  it('fails closed on distributed limiter outage', async () => {
    m.limit.mockResolvedValue({ ok: false, reason: 'unavailable' });
    expect((await POST(req())).status).toBe(503);
    expect(m.confirm).not.toHaveBeenCalled();
  });
  it('returns retry-after for temporary rate limiting', async () => {
    m.limit.mockResolvedValue({ ok: false, reason: 'rate_limited', retryAfter: 60 });
    const response = await POST(req());
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
  });
});
