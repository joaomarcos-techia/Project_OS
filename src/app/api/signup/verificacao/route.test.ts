import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  limit: vi.fn(),
  emit: vi.fn(),
  env: {
    SIGNUP_ENABLED: false,
    APP_BASE_URL: 'https://app.qoro.dev',
    NODE_ENV: 'production',
    VERCEL_ENV: 'production',
  },
}));
vi.mock('@/contexts/onboarding', () => ({ verifySignupTurnstileProbe: mocks.verify }));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupSessionAllowed: mocks.limit,
  getClientIp: () => '203.0.113.9',
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));

import { POST } from './route';

function request(
  body = '{"turnstileToken":"fresh-synthetic-token"}',
  headers: Record<string, string> = {},
) {
  return new Request('https://app.qoro.dev/api/signup/verificacao', {
    method: 'POST',
    body,
    headers: { origin: 'https://app.qoro.dev', 'content-type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime('2026-10-30T22:00:00Z');
  mocks.env.SIGNUP_ENABLED = false;
  mocks.limit.mockResolvedValue({ allowed: true });
  mocks.verify.mockResolvedValue({ ok: true });
});
afterEach(() => vi.useRealTimers());

describe('temporary signup verification endpoint', () => {
  it('verifies through the context and returns proof without account/session cookie', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      runId: expect.any(String),
      accepted: true,
      replayRejected: true,
      invalidRejected: true,
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.verify).toHaveBeenCalledWith(
      'fresh-synthetic-token',
      '203.0.113.9',
      'app.qoro.dev',
    );
    expect(JSON.stringify(mocks.emit.mock.calls)).not.toContain('fresh-synthetic-token');
  });

  it('is absent after reopening, before body/limiter/provider access', async () => {
    mocks.env.SIGNUP_ENABLED = true;
    const req = request('{');
    expect((await POST(req)).status).toBe(404);
    expect(req.bodyUsed).toBe(false);
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('expires even on an older deployment that still has signup closed', async () => {
    vi.setSystemTime('2026-11-02T03:00:00Z');
    expect((await POST(request())).status).toBe(404);
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it.each([
    { origin: 'https://evil.example' },
    { origin: 'null' },
    { origin: 'https://app.qoro.dev/' },
    { origin: 'https://app.qoro.dev', 'sec-fetch-site': 'cross-site' },
  ])('rejects cross-site or malformed origin before provider: %j', async (headers) => {
    expect((await POST(request(undefined, headers))).status).toBe(403);
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('rejects a missing Origin', async () => {
    const req = request();
    req.headers.delete('origin');
    expect((await POST(req)).status).toBe(403);
  });

  it('honors rate limits without consuming a provider token', async () => {
    mocks.limit.mockResolvedValueOnce({ allowed: false });
    expect((await POST(request())).status).toBe(429);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it.each([
    '{',
    '{}',
    '{"turnstileToken":""}',
    '{"turnstileToken":1}',
    '{"turnstileToken":"token","extra":true}',
    JSON.stringify({ turnstileToken: 'x'.repeat(2049) }),
  ])('rejects invalid body: %s', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('caps the declared and actual body and rejects non-JSON input', async () => {
    expect((await POST(request('{}', { 'content-length': String(17 * 1024) }))).status).toBe(413);
    expect((await POST(request(' '.repeat(17 * 1024)))).status).toBe(413);
    expect((await POST(request('{}', { 'content-type': 'text/plain' }))).status).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid', 400],
    ['unreachable', 503],
    ['not_configured', 503],
    ['unexpected_result', 503],
  ])('does not convert %s to a passing probe', async (reason, status) => {
    mocks.verify.mockResolvedValueOnce({ ok: false, reason });
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain('fresh-synthetic-token');
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});
