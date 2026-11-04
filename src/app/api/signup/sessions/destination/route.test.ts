import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  read: vi.fn(),
  limit: vi.fn(),
  env: { SIGNUP_AUTH_ENABLED: true, SIGNUP_IDENTITY_ENABLED: true },
}));
vi.mock('@/contexts/onboarding', () => ({ readSignupCodeDestination: m.read }));
vi.mock('@/lib/env', () => ({ env: m.env }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupReadAllowed: m.limit,
  getClientIp: () => '127.0.0.1',
}));
import { GET } from './route';
function req(cookie = 'A'.repeat(43), site = 'same-origin') {
  return new Request('https://app.qoro.test/api/signup/sessions/destination', {
    headers: { cookie: `__Host-qoro_signup=${cookie}`, 'sec-fetch-site': site },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.env.SIGNUP_AUTH_ENABLED = true;
  m.limit.mockResolvedValue({ ok: true });
  m.read.mockResolvedValue('synthetic@example.test');
});
describe('own browser destination', () => {
  it('returns only the exact cookie-bound address without cache or referrer', async () => {
    const response = await GET(req());
    expect(await response.json()).toEqual({ email: 'synthetic@example.test' });
    expect(m.read).toHaveBeenCalledWith('A'.repeat(43));
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
  it('rejects cross-site reads before touching the database', async () => {
    expect((await GET(req('A'.repeat(43), 'cross-site'))).status).toBe(403);
    expect(m.read).not.toHaveBeenCalled();
  });
  it('does not disclose an address for a gone cookie', async () => {
    m.read.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(410);
  });
  it('fails closed on feature disablement', async () => {
    m.env.SIGNUP_AUTH_ENABLED = false;
    expect((await GET(req())).status).toBe(503);
    expect(m.read).not.toHaveBeenCalled();
  });
  it('limits before lookup', async () => {
    m.limit.mockResolvedValue({ ok: false });
    expect((await GET(req())).status).toBe(429);
    expect(m.read).not.toHaveBeenCalled();
  });
  it('does not expose provider details on failure', async () => {
    m.read.mockRejectedValue(new Error('sensitive detail'));
    const response = await GET(req());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unavailable' });
  });
});
