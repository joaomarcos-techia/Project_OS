import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  env: {
    SIGNUP_AUTH_ENABLED: true,
    SIGNUP_IDENTITY_ENABLED: true,
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
  },
  identity: vi.fn(),
  limit: vi.fn(),
  owner: vi.fn(),
  draft: vi.fn(),
  lookup: vi.fn(),
  exposure: vi.fn(),
  advance: vi.fn(),
  update: vi.fn(),
  finish: vi.fn(),
  signin: vi.fn(),
  ready: vi.fn(),
  signout: vi.fn(),
  clear: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@/lib/env', () => ({ env: m.env }));
vi.mock('@/contexts/onboarding', async () => {
  const binding = await import('@/contexts/onboarding/internal/signup-auth-binding');
  return {
    advanceSignupCredentialEpoch: m.advance,
    checkSignupPasswordExposure: m.exposure,
    finishSignupCredentialEpoch: m.finish,
    markSignupPasswordSet: binding.markSignupPasswordSet,
    readSignupPasswordState: binding.readSignupPasswordState,
    readOwnedSignupReference: m.owner,
    readSignupDraft: m.draft,
    resolveReadyOwnedSignupOnboarding: m.ready,
  };
});
vi.mock('@/lib/auth/pretenant-onboarding', () => ({ resolvePreTenantOnboarding: m.identity }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertSignupDraftWriteAllowed: m.limit,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('@/lib/auth/signup-user-hash', () => ({ hashSignupUserId: () => 'user-hmac' }));
vi.mock('@/lib/auth/supabase-admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: m.lookup, updateUserById: m.update } },
  }),
}));
vi.mock('@/lib/auth/supabase-server', () => ({
  createServerClient: async () => ({ auth: { signInWithPassword: m.signin, signOut: m.signout } }),
  clearSupabaseSessionSelector: m.clear,
}));
vi.mock('@/lib/observability/logger', () => ({ logger: { warn: m.warn } }));

import { POST } from './route';

const id = '11111111-1111-4111-8111-111111111111';
const ref = 'a'.repeat(64);
const user = {
  id,
  email: 'synthetic@example.invalid',
  email_confirmed_at: '2026-10-31T10:00:00Z',
  app_metadata: {
    qoro_self_service_signup: {
      version: 1,
      kind: 'self_service',
      signup_ref: ref,
      password_state: 'pending',
    },
  },
};
function request(
  body = JSON.stringify({ password: 'DifferentPassword7!' }),
  origin = 'https://app.qoro.test',
) {
  return new Request('https://app.qoro.test/api/signup/password', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.env.SIGNUP_AUTH_ENABLED = true;
  m.env.SIGNUP_IDENTITY_ENABLED = true;
  m.identity.mockResolvedValue({
    ok: true,
    kind: 'pretenant',
    userId: id,
    email: user.email,
    signupRef: ref,
    pendingSignupRef: ref,
  });
  m.limit.mockResolvedValue({ ok: true });
  m.owner.mockResolvedValue({ ok: true, signupRef: ref, credentialState: 'completed' });
  m.draft.mockResolvedValue({ ok: true, draft: { rowVersion: 7 } });
  m.lookup.mockResolvedValue({ data: { user }, error: null });
  m.exposure.mockResolvedValue('safe');
  m.advance.mockResolvedValue({ ok: true, rowVersion: 8 });
  m.update.mockResolvedValue({
    data: {
      user: {
        ...user,
        app_metadata: {
          qoro_self_service_signup: {
            ...user.app_metadata.qoro_self_service_signup,
            password_state: 'set',
          },
        },
      },
    },
    error: null,
  });
  m.finish.mockResolvedValue({ ok: true, rowVersion: 9 });
  m.signin.mockResolvedValue({
    data: { user, session: { access_token: 'synthetic-not-a-real-token' } },
    error: null,
  });
  m.ready.mockResolvedValue({ ok: true, kind: 'pretenant', userId: id, signupRef: ref });
  m.signout.mockResolvedValue({ error: null });
});

describe('confirmed signup password', () => {
  it('chooses the password once for the verified owner, then authenticates and checks readiness', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(m.advance).toHaveBeenCalledWith({
      userId: id,
      signupRef: ref,
      expectedRowVersion: 7,
      source: 'continuation',
    });
    expect(m.update).toHaveBeenCalledOnce();
    expect(m.update).toHaveBeenCalledWith(id, {
      password: 'DifferentPassword7!',
      app_metadata: {
        qoro_self_service_signup: {
          ...user.app_metadata.qoro_self_service_signup,
          password_state: 'set',
        },
      },
    });
    expect(m.advance.mock.invocationCallOrder[0]).toBeLessThan(
      m.update.mock.invocationCallOrder[0]!,
    );
    expect(m.update.mock.invocationCallOrder[0]).toBeLessThan(
      m.signin.mock.invocationCallOrder[0]!,
    );
    expect(m.owner).toHaveBeenCalledWith(id, user.email);
    expect(m.limit).toHaveBeenCalledWith('127.0.0.1', 'user-hmac');
  });
  it('requires verified authentication before parsing or returning schema details', async () => {
    m.identity.mockResolvedValue({ ok: false, reason: 'invalid_session' });
    expect((await POST(request('{broken'))).status).toBe(401);
    expect(m.owner).not.toHaveBeenCalled();
    expect(m.lookup).not.toHaveBeenCalled();
  });
  it('rejects cross-origin and disabled feature before authentication', async () => {
    expect((await POST(request(undefined, 'https://untrusted.invalid'))).status).toBe(403);
    m.env.SIGNUP_AUTH_ENABLED = false;
    expect((await POST(request())).status).toBe(503);
    expect(m.identity).not.toHaveBeenCalled();
  });
  it('cannot change passwords for existing tenant members', async () => {
    m.identity.mockResolvedValue({ ok: true, kind: 'redirect', route: '/dashboard' });
    expect((await POST(request())).status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });
  it.each([
    ['rate_limited', 429],
    ['unavailable', 503],
  ] as const)('fails closed on limiter %s', async (reason, status) => {
    m.limit.mockResolvedValue({ ok: false, reason, retryAfter: 60 });
    const response = await POST(request());
    expect(response.status).toBe(status);
    if (status === 429) expect(response.headers.get('retry-after')).toBe('60');
    expect(m.lookup).not.toHaveBeenCalled();
  });
  it.each([
    '{broken',
    JSON.stringify({ password: 'short' }),
    JSON.stringify({ password: 'ValidPassword7!', userId: id }),
  ])('rejects invalid or identity-selected body %#', async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_body' });
    expect(m.lookup).not.toHaveBeenCalled();
  });
  it('caps the actual request body', async () => {
    expect((await POST(request('x'.repeat(16_385)))).status).toBe(413);
  });
  it('rejects a different draft reference', async () => {
    m.owner.mockResolvedValue({
      ok: true,
      signupRef: 'b'.repeat(64),
      credentialState: 'completed',
    });
    expect((await POST(request())).status).toBe(403);
    expect(m.lookup).not.toHaveBeenCalled();
  });
  it('does not revive an expired draft', async () => {
    m.draft.mockResolvedValue({ ok: false, reason: 'gone' });
    expect((await POST(request())).status).toBe(410);
    expect(m.update).not.toHaveBeenCalled();
  });
  it.each([
    { ...user, email_confirmed_at: null },
    { ...user, id: 'different-user' },
    { ...user, email: 'other@example.invalid' },
    { ...user, app_metadata: {} },
  ])('fails closed on authoritative identity or marker mismatch %#', async (other) => {
    m.lookup.mockResolvedValue({ data: { user: other }, error: null });
    expect((await POST(request())).status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });
  it.each([
    ['pwned', 422],
    ['unavailable', 503],
  ] as const)('checks password exposure before CAS: %s', async (result, status) => {
    m.exposure.mockResolvedValue(result);
    expect((await POST(request())).status).toBe(status);
    expect(m.advance).not.toHaveBeenCalled();
  });
  it.each([
    ['conflict', 409],
    ['gone', 410],
    ['unavailable', 503],
  ] as const)('CAS refusal %s prevents Auth mutation', async (reason, status) => {
    m.advance.mockResolvedValue({ ok: false, reason });
    expect((await POST(request())).status).toBe(status);
    expect(m.update).not.toHaveBeenCalled();
  });
  it('reconciles an already-set marker without overwriting the password', async () => {
    m.lookup.mockResolvedValue({
      data: {
        user: {
          ...user,
          app_metadata: {
            qoro_self_service_signup: {
              ...user.app_metadata.qoro_self_service_signup,
              password_state: 'set',
            },
          },
        },
      },
      error: null,
    });
    expect((await POST(request())).status).toBe(200);
    expect(m.update).not.toHaveBeenCalled();
    expect(m.advance).not.toHaveBeenCalled();
    expect(m.finish).toHaveBeenCalledWith({
      userId: id,
      signupRef: ref,
      expectedRowVersion: 7,
      outcome: 'completed',
    });
  });
  it('retains ambiguous writes for reconciliation', async () => {
    m.update.mockRejectedValue(new Error('synthetic-network-failure'));
    expect((await POST(request())).status).toBe(503);
    expect(m.finish).toHaveBeenCalledWith({
      userId: id,
      signupRef: ref,
      expectedRowVersion: 8,
      outcome: 'uncertain',
    });
    expect(m.signin).not.toHaveBeenCalled();
  });
  it('a definitive weak-password refusal releases the reservation for another choice', async () => {
    m.update.mockResolvedValue({ data: { user: null }, error: { code: 'weak_password' } });
    expect((await POST(request())).status).toBe(422);
    expect(m.finish).toHaveBeenCalledWith({
      userId: id,
      signupRef: ref,
      expectedRowVersion: 8,
      outcome: 'completed',
    });
  });
  it('clears partial authentication when the authenticated identity differs', async () => {
    m.signin.mockResolvedValue({ data: { user: { id: 'other' }, session: {} }, error: null });
    expect((await POST(request())).status).toBe(401);
    expect(m.signout).toHaveBeenCalled();
    expect(m.clear).toHaveBeenCalled();
  });
  it('does not report success before the ready-owned postcondition', async () => {
    m.ready.mockResolvedValue({ ok: false, reason: 'credentials_invalid' });
    expect((await POST(request())).status).toBe(503);
    expect(m.signout).toHaveBeenCalled();
  });
});
