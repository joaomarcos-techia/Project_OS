import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  limit: vi.fn(),
  env: { SIGNUP_AUTH_ENABLED: true, SIGNUP_IDENTITY_ENABLED: true },
  onboarding: vi.fn(),
}));
// Se a rota voltar a consultar o cadastro ou a conta, este mock acusa.
vi.mock('@/contexts/onboarding', () => new Proxy({}, { get: () => m.onboarding }));
vi.mock('@/lib/env', () => ({ env: m.env }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupReadAllowed: m.limit,
  getClientIp: () => '127.0.0.1',
}));
import { GET } from './route';
function req(cookie: string | null = 'A'.repeat(43), site = 'same-origin') {
  return new Request('https://app.qoro.test/api/signup/sessions/destination', {
    headers: {
      ...(cookie ? { cookie: `__Host-qoro_signup=${cookie}` } : {}),
      'sec-fetch-site': site,
    },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.env.SIGNUP_AUTH_ENABLED = true;
  m.limit.mockResolvedValue({ ok: true });
});
describe('destination route without account disclosure', () => {
  it('answers the same for any cookie and never reads the signup or the account', async () => {
    const withCookie = await GET(req());
    const otherCookie = await GET(req('B'.repeat(43)));
    const noCookie = await GET(req(null));
    for (const response of [withCookie, otherCookie, noCookie]) {
      expect(response.status).toBe(410);
      expect(await response.json()).toEqual({ error: 'gone' });
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    }
    expect(m.onboarding).not.toHaveBeenCalled();
  });
  it('rejects cross-site reads', async () => {
    expect((await GET(req('A'.repeat(43), 'cross-site'))).status).toBe(403);
  });
  it('fails closed on feature disablement', async () => {
    m.env.SIGNUP_AUTH_ENABLED = false;
    expect((await GET(req())).status).toBe(503);
  });
  it('keeps the read limit', async () => {
    m.limit.mockResolvedValue({ ok: false });
    expect((await GET(req())).status).toBe(429);
  });
});
