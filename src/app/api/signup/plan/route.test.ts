import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
  },
  resolve: vi.fn(),
  hashUser: vi.fn(),
  readLimit: vi.fn(),
  writeLimit: vi.fn(),
  readPlan: vi.fn(),
  writePlan: vi.fn(),
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/auth/signup-user-hash', () => ({ hashSignupUserId: mocks.hashUser }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupDraftReadAllowed: mocks.readLimit,
  assertSignupDraftWriteAllowed: mocks.writeLimit,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/db', () => ({ dbAdmin: {} }));
vi.mock('@/contexts/onboarding', async () => {
  const { signupPlanMutationSchema } = await import('@/contexts/onboarding/internal/signup-draft');
  return {
    signupPlanMutationSchema,
    readSignupPlan: mocks.readPlan,
    writeSignupPlan: mocks.writePlan,
    resolveReadyOwnedSignupOnboarding: mocks.resolve,
  };
});

import { GET, PUT } from './route';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const input = { rowVersion: 7, planId: PLAN_ID };
const state = {
  status: 'email_verified',
  rowVersion: 7,
  clinicName: 'Clínica Sintética',
  selectedPlanId: null,
  plans: [
    {
      id: PLAN_ID,
      code: 'essencial',
      name: 'Essencial',
      priceCents: 14900,
      cycle: 'monthly',
    },
  ],
  trialDays: 7,
} as const;

function request(
  method: 'GET' | 'PUT',
  body: string | undefined = method === 'PUT' ? JSON.stringify(input) : undefined,
): Request {
  return new Request('https://app.qoro.test/api/signup/plan', {
    method,
    ...(body === undefined ? {} : { body }),
    headers: { origin: mocks.env.APP_BASE_URL },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.env, {
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
  });
  mocks.resolve.mockResolvedValue({
    ok: true,
    kind: 'pretenant',
    userId: USER_ID,
    email: 'verified@example.invalid',
  });
  mocks.hashUser.mockReturnValue('c'.repeat(64));
  mocks.readLimit.mockResolvedValue({ ok: true });
  mocks.writeLimit.mockResolvedValue({ ok: true });
  mocks.readPlan.mockResolvedValue({ ok: true, state });
  mocks.writePlan.mockResolvedValue({ ok: true, rowVersion: 8, selectedPlanId: PLAN_ID });
});

describe('GET /api/signup/plan', () => {
  it('revalida owner, limita por HMAC e retorna catálogo resolvido no servidor', async () => {
    const response = await GET(request('GET'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(state);
    expect(mocks.readLimit).toHaveBeenCalledWith('127.0.0.1', 'c'.repeat(64));
    expect(mocks.readPlan).toHaveBeenCalledWith(USER_ID);
  });

  it.each([
    ['invalid_session', 401],
    ['anonymous', 401],
    ['email_unverified', 401],
    ['profile_denied', 403],
    ['credentials_pending', 403],
    ['credentials_invalid', 403],
    ['unavailable', 503],
  ] as const)('mapeia seam %s antes do limiter', async (reason, status) => {
    mocks.resolve.mockResolvedValue({ ok: false, reason });
    expect((await GET(request('GET'))).status).toBe(status);
    expect(mocks.readLimit).not.toHaveBeenCalled();
    expect(mocks.readPlan).not.toHaveBeenCalled();
  });

  it('recusa profile existente e categoriza limite, expiração e falha fechada', async () => {
    mocks.resolve.mockResolvedValue({ ok: true, kind: 'redirect', route: '/dashboard' });
    expect((await GET(request('GET'))).status).toBe(403);
    mocks.resolve.mockResolvedValue({
      ok: true,
      kind: 'pretenant',
      userId: USER_ID,
      email: 'verified@example.invalid',
    });
    mocks.readLimit.mockResolvedValue({ ok: false, reason: 'rate_limited', retryAfter: 45 });
    const limited = await GET(request('GET'));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('45');
    mocks.readLimit.mockResolvedValue({ ok: true });
    mocks.readPlan.mockResolvedValue({ ok: false, reason: 'gone' });
    expect((await GET(request('GET'))).status).toBe(410);
    mocks.readPlan.mockRejectedValue(new Error('raw DB error'));
    expect((await GET(request('GET'))).status).toBe(503);
  });
});

describe('PUT /api/signup/plan', () => {
  it('envia ao domínio somente planId e CAS, sem preço, trial ou campanha', async () => {
    const response = await PUT(request('PUT'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rowVersion: 8, selectedPlanId: PLAN_ID });
    expect(mocks.writePlan).toHaveBeenCalledWith(USER_ID, input);
  });

  it.each([
    ['gone', 410],
    ['conflict', 409],
    ['invalid_plan', 422],
    ['unavailable', 503],
  ] as const)('mapeia writer %s', async (reason, status) => {
    mocks.writePlan.mockResolvedValue({ ok: false, reason });
    const response = await PUT(request('PUT'));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: reason });
  });

  it.each(['missing', 'foreign', 'cross-site', 'bad-config'])(
    'nega origem %s antes de Auth/body/limiter',
    async (kind) => {
      const req = request('PUT');
      if (kind === 'missing') req.headers.delete('origin');
      if (kind === 'foreign') req.headers.set('origin', 'https://evil.test');
      if (kind === 'cross-site') req.headers.set('sec-fetch-site', 'cross-site');
      if (kind === 'bad-config') mocks.env.APP_BASE_URL = 'http://evil.test';
      const response = await PUT(req);
      expect(response.status).toBe(kind === 'bad-config' ? 503 : 403);
      expect(req.bodyUsed).toBe(false);
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(mocks.writeLimit).not.toHaveBeenCalled();
    },
  );

  it.each([
    '{',
    '{}',
    JSON.stringify({ ...input, priceCents: 1 }),
    JSON.stringify({ ...input, trialDays: 999 }),
    JSON.stringify({ ...input, campaignCode: 'fundador' }),
    JSON.stringify({ ...input, planId: 'not-a-uuid' }),
  ])('recusa body estrito sem chamar writer: %s', async (body) => {
    const response = await PUT(request('PUT', body));
    expect(response.status).toBe(400);
    expect(mocks.writePlan).not.toHaveBeenCalled();
  });

  it('limita antes de ler o body e aplica teto UTF-8 real', async () => {
    mocks.writeLimit.mockResolvedValue({ ok: false, reason: 'rate_limited', retryAfter: 30 });
    const limitedRequest = request('PUT');
    const limited = await PUT(limitedRequest);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('30');
    expect(limitedRequest.bodyUsed).toBe(false);

    mocks.writeLimit.mockResolvedValue({ ok: true });
    expect((await PUT(request('PUT', 'x'.repeat(1025)))).status).toBe(413);
    expect(mocks.writePlan).not.toHaveBeenCalled();
  });

  it('fecha em exceções de limiter e domínio', async () => {
    mocks.writeLimit.mockRejectedValue(new Error('raw redis'));
    expect((await PUT(request('PUT'))).status).toBe(503);
    mocks.writeLimit.mockResolvedValue({ ok: true });
    mocks.writePlan.mockRejectedValue(new Error('raw DB'));
    expect((await PUT(request('PUT'))).status).toBe(503);
  });
});
