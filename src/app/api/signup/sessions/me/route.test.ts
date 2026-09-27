import { beforeEach, describe, expect, it, vi } from 'vitest';

const { read, limit } = vi.hoisted(() => ({ read: vi.fn(), limit: vi.fn() }));
vi.mock('@/contexts/onboarding', () => ({ readSignupSession: read }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupReadAllowed: limit,
  getClientIp: () => '127.0.0.1',
}));

import { GET } from './route';

const request = (token?: string) =>
  new Request('https://localhost/api/signup/sessions/me', {
    headers: token === undefined ? {} : { cookie: `__Host-qoro_signup=${token}` },
  });

describe('GET signup session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limit.mockResolvedValue({ ok: true });
    read.mockResolvedValue(null);
  });

  it.each([undefined, '', '%', '%E0%A4', 'unknown'])(
    'uniformly clears invalid cookie %s',
    async (token) => {
      const res = await GET(request(token));
      expect(res.status).toBe(410);
      expect(await res.json()).toEqual({ error: 'gone' });
      expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
      if (token !== 'unknown') expect(read).not.toHaveBeenCalled();
    },
  );

  it('returns only the state of the cookie session', async () => {
    const state = {
      status: 'initiated',
      rowVersion: 1,
      riskLevel: 0,
      expiresAt: '2026-09-14T15:00:00Z',
      answers: null,
    };
    read.mockResolvedValue(state);
    const res = await GET(request('valid%2Dtoken'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ session: state });
    expect(read).toHaveBeenCalledWith('valid-token');
  });

  it('limits before looking up or renewing a session', async () => {
    limit.mockResolvedValue({ ok: false });
    const res = await GET(request('valid'));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(read).not.toHaveBeenCalled();
  });

  it('does not disguise database unavailability as an expired session', async () => {
    read.mockRejectedValue(new Error('database unavailable'));
    await expect(GET(request('valid'))).rejects.toThrow('database unavailable');
  });
});
