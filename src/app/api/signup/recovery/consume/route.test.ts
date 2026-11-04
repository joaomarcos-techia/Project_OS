import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  consume: vi.fn(),
  limit: vi.fn(),
  set: vi.fn(),
  sign: vi.fn(),
  env: {
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
  },
}));
vi.mock('@/lib/env', () => ({ env: m.env }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: m.set }) }));
vi.mock('@/contexts/onboarding', async () => {
  const { z } = await import('zod');
  return {
    consumeSignupRecovery: m.consume,
    hashSignupToken: () => 'token-hmac',
    SIGNUP_RECOVERY_COOKIE: 'qoro_signup_recovery',
    signupRecoveryInputSchema: z
      .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) })
      .strict(),
  };
});
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupContinuationAllowed: m.limit,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/auth/signup-confirmation-grant', () => ({
  signSignupConfirmationGrant: m.sign,
  SIGNUP_CONFIRMATION_GRANT_TTL_SECONDS: 900,
}));
vi.mock('@/lib/observability/logger', () => ({ logger: { warn: vi.fn() } }));
import { POST } from './route';
function req(body: unknown = { token: 'A'.repeat(43) }, origin = 'https://app.qoro.test') {
  return new Request('https://app.qoro.test/api/signup/recovery/consume', {
    method: 'POST',
    headers: { origin, 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.env.SIGNUP_AUTH_ENABLED = true;
  m.limit.mockResolvedValue({ ok: true });
  m.sign.mockReturnValue('synthetic-signed-grant');
  m.consume.mockResolvedValue({
    ok: true,
    next: '/cadastro/plano',
    userId: 'user',
    signupRef: 'ref',
  });
});
describe('recovery consumption HTTP boundary', () => {
  it('writes only a short server-only continuation cookie after successful mail proof', async () => {
    const response = await POST(req());
    expect(await response.json()).toEqual({ next: '/cadastro/plano' });
    expect(m.set).toHaveBeenCalledWith('qoro_signup_recovery', 'synthetic-signed-grant', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 900,
    });
  });
  it('rejects cross-origin before mutation', async () => {
    expect((await POST(req(undefined, 'https://evil.test'))).status).toBe(403);
    expect(m.consume).not.toHaveBeenCalled();
  });
  it.each([{ token: 'short' }, { token: 'A'.repeat(43), userId: 'forged' }])(
    'rejects invalid authority',
    async (body) => {
      expect((await POST(req(body))).status).toBe(400);
      expect(m.consume).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['invalid', 410],
    ['unavailable', 503],
  ] as const)('does not write a cookie on %s', async (reason, status) => {
    m.consume.mockResolvedValue({ ok: false, reason });
    expect((await POST(req())).status).toBe(status);
    expect(m.set).not.toHaveBeenCalled();
  });
  it('does not consume when the limiter is unavailable', async () => {
    m.limit.mockResolvedValue({ ok: false, reason: 'unavailable' });
    expect((await POST(req())).status).toBe(503);
    expect(m.consume).not.toHaveBeenCalled();
  });
});
