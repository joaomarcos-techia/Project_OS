import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
  },
  resolve: vi.fn(),
  complete: vi.fn(),
  limit: vi.fn(),
  hash: vi.fn(),
}));

vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/contexts/onboarding', () => ({
  resolveReadyOwnedSignupOnboarding: mocks.resolve,
  completeSignupHostedCheckout: mocks.complete,
}));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupDraftReadAllowed: mocks.limit,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/auth/signup-user-hash', () => ({ hashSignupUserId: mocks.hash }));

import { POST } from './route';

function request(origin = 'https://app.qoro.test'): Request {
  return new Request('https://app.qoro.test/api/signup/checkout/status', {
    method: 'POST',
    headers: { origin, 'sec-fetch-site': 'same-origin' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.SIGNUP_AUTH_ENABLED = true;
  mocks.env.SIGNUP_IDENTITY_ENABLED = true;
  mocks.resolve.mockResolvedValue({
    ok: true,
    kind: 'pretenant',
    userId: '11111111-1111-4111-8111-111111111111',
    email: 'dona@example.invalid',
  });
  mocks.limit.mockResolvedValue({ ok: true });
  mocks.hash.mockReturnValue('user-hmac');
  mocks.complete.mockResolvedValue({ ok: true, state: 'pending' });
});

describe('POST /api/signup/checkout/status', () => {
  it('mantém 202 enquanto o provider ainda não expõe a assinatura', async () => {
    const response = await POST(request());

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ state: 'pending' });
    expect(mocks.limit).toHaveBeenCalledWith('127.0.0.1', 'user-hmac');
  });

  it('só libera depois que a conciliação provisiona', async () => {
    mocks.complete.mockResolvedValue({ ok: true, state: 'provisioned' });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'provisioned' });
  });

  it('tenant já criado é sucesso idempotente', async () => {
    mocks.resolve.mockResolvedValue({ ok: true, kind: 'redirect', route: '/dashboard' });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'provisioned' });
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('bloqueia origem externa antes de consultar estado', async () => {
    const response = await POST(request('https://evil.test'));

    expect(response.status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('divergência autoritativa não libera o dashboard', async () => {
    mocks.complete.mockResolvedValue({ ok: false, reason: 'conflict' });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'conflict' });
  });
});
