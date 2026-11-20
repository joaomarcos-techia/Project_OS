import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ enabled: true, provision: vi.fn(), limit: vi.fn(), emit: vi.fn() }));
vi.mock('@/contexts/onboarding', async () => {
  const { PilotSignupError } =
    await import('@/contexts/onboarding/internal/signup-pilot-repository');
  return {
    PilotSignupError,
    provisionPilotSignup: m.provision,
    PILOT_INVITE_COOKIE: '__Host-qoro_pilot',
    hashSignupToken: () => 'hashed',
  };
});
vi.mock('@/lib/db', () => ({ dbAdmin: {} }));
vi.mock('@/lib/env', () => ({
  env: {
    APP_BASE_URL: 'https://app.qoro.test',
    get ABACATEPAY_PILOT_PROVISIONING_ENABLED() {
      return m.enabled;
    },
  },
}));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupDraftWriteAllowed: m.limit,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: m.emit } }));
import { POST } from './route';
import { PilotSignupError } from '@/contexts/onboarding/internal/signup-pilot-repository';
function req(body: unknown = {}, origin = 'https://app.qoro.test', cookie = true) {
  return new Request('https://app.qoro.test/api/signup/pilot/provision', {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      ...(cookie ? { cookie: '__Host-qoro_pilot=' + 'a'.repeat(64) } : {}),
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.enabled = true;
  m.limit.mockResolvedValue({ ok: true });
  m.provision.mockResolvedValue({ state: 'provisioned' });
});
describe('restricted provisioning HTTP boundary', () => {
  it('is disabled before reading authority when the gate is off', async () => {
    m.enabled = false;
    expect((await POST(req())).status).toBe(503);
    expect(m.limit).not.toHaveBeenCalled();
    expect(m.provision).not.toHaveBeenCalled();
  });
  it('refuses cross-origin and missing-cookie requests', async () => {
    expect((await POST(req({}, 'https://evil.test'))).status).toBe(403);
    expect((await POST(req({}, undefined, false))).status).toBe(403);
    expect(m.provision).not.toHaveBeenCalled();
  });
  it('rejects client-selected clinic, price, amount or roles', async () => {
    expect((await POST(req({ clinicId: 'wrong', amount: 1, role: 'owner' }))).status).toBe(400);
    expect(m.provision).not.toHaveBeenCalled();
  });
  it('caps request size', async () => {
    expect((await POST(req({ large: 'x'.repeat(300) }))).status).toBe(413);
    expect(m.provision).not.toHaveBeenCalled();
  });
  it.each([
    ['forbidden', 403],
    ['expired', 410],
    ['conflict', 409],
  ] as const)('preserves %s without artificial success', async (code, status) => {
    m.provision.mockRejectedValue(new PilotSignupError(code));
    expect((await POST(req())).status).toBe(status);
  });
  it('rate limits before authentication or writes', async () => {
    m.limit.mockResolvedValue({ ok: false, reason: 'rate_limited' });
    expect((await POST(req())).status).toBe(429);
    expect(m.provision).not.toHaveBeenCalled();
  });
  it('delegates an empty DTO to the authenticated transactional service', async () => {
    const r = await POST(req());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ state: 'provisioned' });
    expect(m.provision).toHaveBeenCalledExactlyOnceWith('a'.repeat(64));
  });
  it('reports unexpected failure with no sensitive details', async () => {
    m.provision.mockRejectedValue(new Error('secret'));
    const r = await POST(req());
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain('secret');
    expect(m.emit).toHaveBeenCalledWith('signup.pilot.failed', {
      stage: 'provision',
      code: 'unexpected',
    });
  });
});
