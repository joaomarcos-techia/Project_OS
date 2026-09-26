import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
  },
  resolve: vi.fn(),
  abandon: vi.fn(),
  limit: vi.fn(),
  hash: vi.fn(),
}));

vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/contexts/onboarding', () => ({
  resolveReadyOwnedSignupOnboarding: mocks.resolve,
  abandonSignupHostedCheckout: mocks.abandon,
}));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupDraftWriteAllowed: mocks.limit,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/auth/signup-user-hash', () => ({ hashSignupUserId: mocks.hash }));

import { POST } from './route';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function request(
  body = JSON.stringify({ reason: 'cancelled' }),
  origin = 'https://app.qoro.test',
): Request {
  return new Request('https://app.qoro.test/api/signup/checkout/cancel', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'sec-fetch-site': 'same-origin',
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.SIGNUP_AUTH_ENABLED = true;
  mocks.env.SIGNUP_IDENTITY_ENABLED = true;
  mocks.resolve.mockResolvedValue({
    ok: true,
    kind: 'pretenant',
    userId: USER_ID,
    email: 'dona@example.invalid',
  });
  mocks.limit.mockResolvedValue({ ok: true });
  mocks.hash.mockReturnValue('user-hmac');
  mocks.abandon.mockResolvedValue({ ok: true, state: 'reset' });
});

describe('POST /api/signup/checkout/cancel', () => {
  it('só libera nova tentativa depois da orquestração do cancelamento', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'reset' });
    expect(mocks.abandon).toHaveBeenCalledWith({ userId: USER_ID, reason: 'cancelled' });
  });

  it('preserva uma conclusão concorrente', async () => {
    mocks.abandon.mockResolvedValue({ ok: true, state: 'already_completed' });

    const response = await POST(request(JSON.stringify({ reason: 'expired' })));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'already_completed' });
  });

  it.each([
    JSON.stringify({ reason: 'other' }),
    JSON.stringify({ reason: 'cancelled', checkoutId: 'forged' }),
    '',
  ])('recusa corpo fora do contrato estrito', async (body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(mocks.abandon).not.toHaveBeenCalled();
  });

  it('bloqueia origem externa antes de qualquer efeito', async () => {
    const response = await POST(request(undefined, 'https://evil.test'));

    expect(response.status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.abandon).not.toHaveBeenCalled();
  });

  it('não libera retry se a conciliação divergir', async () => {
    mocks.abandon.mockResolvedValue({ ok: false, reason: 'conflict' });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'conflict' });
  });
});
