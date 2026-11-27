import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  limit: vi.fn(),
  provision: vi.fn(),
  emit: vi.fn(),
}));
vi.mock('@/contexts/onboarding', async () => {
  const { PilotSignupError } =
    await import('@/contexts/onboarding/internal/signup-pilot-repository');
  return {
    bootstrapPilotSignup: m.bootstrap,
    provisionPilotSignup: m.provision,
    PilotSignupError,
    PILOT_INVITE_COOKIE: '__Host-qoro_pilot',
    hashSignupToken: () => 'hashed-reference',
  };
});
vi.mock('@/lib/db', () => ({ dbAdmin: {} }));
vi.mock('@/lib/env', () => ({
  env: { APP_BASE_URL: 'https://app.qoro.test', ABACATEPAY_PILOT_PROVISIONING_ENABLED: true },
}));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupReadAllowed: m.limit,
  assertSignupDraftWriteAllowed: m.limit,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: m.emit } }));
import { POST as bootstrap } from './route';
import { POST as provision } from './provision/route';
const token = 'a'.repeat(64);
function request(body: unknown, options: { origin?: string; cookie?: boolean } = {}) {
  return new Request('https://app.qoro.test/api/signup/pilot', {
    method: 'POST',
    headers: {
      origin: options.origin ?? 'https://app.qoro.test',
      'content-type': 'application/json',
      ...(options.cookie ? { cookie: '__Host-qoro_pilot=' + token } : {}),
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.limit.mockResolvedValue({ ok: true });
  m.provision.mockResolvedValue({ state: 'provisioned' });
  m.bootstrap.mockResolvedValue({
    ok: true,
    rawToken: 'b'.repeat(43),
    state: { status: 'initiated' },
    identity: { ownerName: 'Owner', clinicName: 'Clinic', email: 'owner@example.test' },
  });
});
describe('private admission HTTP boundary', () => {
  it('does not accept cross-site requests or issue a session', async () => {
    expect(
      (await bootstrap(request({ inviteToken: token }, { origin: 'https://evil.test' }))).status,
    ).toBe(403);
    expect(m.bootstrap).not.toHaveBeenCalled();
  });
  it.each([{}, { inviteToken: 'bad' }, { inviteToken: token, role: 'owner' }])(
    'refuses missing or altered authority %#',
    async (body) => {
      expect((await bootstrap(request(body))).status).toBeGreaterThanOrEqual(400);
      expect(m.bootstrap).not.toHaveBeenCalled();
    },
  );
  it('rate limits before resolving the invitation', async () => {
    m.limit.mockResolvedValue({ ok: false });
    expect((await bootstrap(request({ inviteToken: token }))).status).toBe(429);
    expect(m.bootstrap).not.toHaveBeenCalled();
  });
  it('keeps both raw secrets out of the JSON and sets secure HttpOnly cookies', async () => {
    const r = await bootstrap(request({ inviteToken: token }));
    expect(r.status).toBe(201);
    const text = await r.text();
    expect(text).not.toContain(token);
    expect(text).not.toContain('b'.repeat(43));
    expect(r.headers.get('set-cookie')).toContain('HttpOnly');
    expect(r.headers.get('set-cookie')).toContain('Secure');
    expect(r.headers.get('cache-control')).toContain('no-store');
  });
  it('can resume using its HttpOnly invitation instead of putting the token in a URL', async () => {
    m.bootstrap.mockResolvedValue({
      ok: true,
      rawToken: 'b'.repeat(43),
      state: { status: 'initiated' },
      identity: {},
      resumed: true,
    });
    const response = await bootstrap(request({}, { cookie: true }));
    expect(response.status).toBe(201);
    expect((await response.json()).resumed).toBe(true);
    expect(m.bootstrap.mock.calls[0]?.[0].inviteToken).toBe(token);
  });
  it('preserves a conflict without issuing another session', async () => {
    const { PilotSignupError } =
      await import('@/contexts/onboarding/internal/signup-pilot-repository');
    m.bootstrap.mockRejectedValue(new PilotSignupError('conflict'));
    expect((await bootstrap(request({ inviteToken: token }))).status).toBe(409);
  });
  it('does not hide unexpected bootstrap failures from observability', async () => {
    m.bootstrap.mockRejectedValue(new Error('sensitive-details'));
    expect((await bootstrap(request({ inviteToken: token }))).status).toBe(503);
    expect(m.emit).toHaveBeenCalledWith('signup.pilot.failed', {
      stage: 'bootstrap',
      code: 'unexpected',
    });
  });
  it('requires the invitation and a strictly empty provisioning DTO', async () => {
    expect((await provision(request({}))).status).toBe(403);
    expect(
      (await provision(request({ clinicId: 'forged', amount: 1 }, { cookie: true }))).status,
    ).toBe(400);
    expect(m.provision).not.toHaveBeenCalled();
  });
  it('delegates authentication and transactional provisioning without creating a checkout', async () => {
    expect((await provision(request({}, { cookie: true }))).status).toBe(200);
    expect(m.provision).toHaveBeenCalledTimes(1);
    expect(m.provision).toHaveBeenCalledWith(token);
    expect(m.bootstrap).not.toHaveBeenCalled();
  });
});
