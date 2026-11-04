import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  recover: vi.fn(),
  limit: vi.fn(),
  settle: vi.fn(),
  env: {
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
  },
}));
vi.mock('@/contexts/onboarding', () => ({ requestSignupRecovery: m.recover }));
vi.mock('@/lib/env', () => ({ env: m.env }));
vi.mock('@/lib/auth/email-hash', () => ({ hashEmail: () => 'email-hmac' }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupResendAllowed: m.limit,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/auth/signup-response-timing', () => ({ settleSignupAccountResponse: m.settle }));
vi.mock('@/lib/observability/logger', () => ({ logger: { warn: vi.fn() } }));
import { POST } from './route';
function req(
  body: unknown = { email: 'synthetic@example.test' },
  origin = 'https://app.qoro.test',
) {
  return new Request('https://app.qoro.test/api/signup/recovery/request', {
    method: 'POST',
    headers: { origin, 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.env.SIGNUP_AUTH_ENABLED = true;
  m.limit.mockResolvedValue({ ok: true });
  m.recover.mockResolvedValue(undefined);
});
describe('recovery request boundary', () => {
  it.each(['unknown', 'sent', 'delivery-error'])(
    'returns the same generic response for %s',
    async (outcome) => {
      if (outcome === 'delivery-error')
        m.recover.mockRejectedValue(new Error('private provider detail'));
      const response = await POST(req());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(m.settle).toHaveBeenCalledOnce();
    },
  );
  it('rejects cross-origin without a lookup', async () => {
    expect((await POST(req(undefined, 'https://evil.test'))).status).toBe(403);
    expect(m.recover).not.toHaveBeenCalled();
  });
  it.each([{ email: 'invalid' }, { email: 'synthetic@example.test', userId: 'forged' }, {}])(
    'rejects invalid input',
    async (body) => {
      expect((await POST(req(body))).status).toBe(400);
      expect(m.recover).not.toHaveBeenCalled();
    },
  );
  it('fails closed when signup authentication is disabled', async () => {
    m.env.SIGNUP_AUTH_ENABLED = false;
    expect((await POST(req())).status).toBe(503);
    expect(m.recover).not.toHaveBeenCalled();
  });
  it('returns cooldown without sending', async () => {
    m.limit.mockResolvedValue({ ok: false, reason: 'rate_limited', retryAfter: 60 });
    const response = await POST(req());
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(m.recover).not.toHaveBeenCalled();
  });
  it('fails closed on distributed limiter outage', async () => {
    m.limit.mockResolvedValue({ ok: false, reason: 'unavailable' });
    expect((await POST(req())).status).toBe(503);
    expect(m.recover).not.toHaveBeenCalled();
  });
  it('caps the body before lookup', async () => {
    expect((await POST(req({ email: 'a'.repeat(5000) }))).status).toBe(413);
    expect(m.recover).not.toHaveBeenCalled();
  });
});
