import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  lookup: vi.fn(),
  profile: vi.fn(),
  generate: vi.fn(),
  getUser: vi.fn(),
  update: vi.fn(),
  verify: vi.fn(),
  signOut: vi.fn(),
  clear: vi.fn(),
  client: vi.fn(),
  ready: vi.fn(),
  validate: vi.fn(),
  claim: vi.fn(),
  bind: vi.fn(),
  plan: vi.fn(),
  owned: vi.fn(),
  billing: vi.fn(),
  reserve: vi.fn(),
  finish: vi.fn(),
  liveness: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@/lib/auth/supabase-admin', () => ({
  findAdminUserByEmail: m.lookup,
  createAdminClient: () => ({
    auth: { admin: { generateLink: m.generate, getUserById: m.getUser, updateUserById: m.update } },
  }),
}));
vi.mock('@/lib/auth/supabase-server', () => ({
  clearSupabaseSessionSelector: m.clear,
  createServerClient: m.client,
}));
vi.mock('@/lib/auth/tenant-context', () => ({ readAuthoritativeProfile: m.profile }));
vi.mock('@/lib/auth/pretenant-onboarding', () => ({ resolveReadyPreTenantOnboarding: m.ready }));
vi.mock('@/lib/observability/logger', () => ({ logger: { warn: m.warn } }));
vi.mock('./signup-auth-admin', () => ({
  resolveReadyOwnedSignupOnboarding: m.ready,
  validateVerifiedSignupAuthUserForClaim: m.validate,
  ensureVerifiedSignupAuthBinding: m.bind,
}));
vi.mock('./signup-draft', () => ({
  ensureSignupDraftForVerifiedEmail: m.claim,
  readSignupPlan: m.plan,
  readOwnedSignupReference: m.owned,
}));
vi.mock('./signup-billing', () => ({ readSignupBilling: m.billing }));
vi.mock('./signup-session', () => ({
  hashSignupToken: () => 'a'.repeat(64),
  readSignupReferenceLiveness: m.liveness,
}));
vi.mock('./signup-email-code-repository', async () => {
  const { z } = await import('zod');
  return {
    reserveSignupEmailCode: m.reserve,
    finishSignupEmailCode: m.finish,
    signupEmailCodeSchema: z
      .object({ email: z.string().email(), code: z.string().regex(/^\d{8}$/u) })
      .strict(),
  };
});
import { createPendingSignupAppMetadata, markSignupPasswordSet } from './signup-auth-binding';
import { confirmSignupEmailCode, resolveSignupContinuation } from './signup-email-code';

const ref = 'a'.repeat(64);
const token = 'A'.repeat(43);
const email = 'synthetic@example.test';
const id = '11111111-1111-4111-8111-111111111111';
const user = () => ({ id, email, app_metadata: createPendingSignupAppMetadata(ref, true) });
const ready = { ok: true, kind: 'pretenant', userId: id, email, signupRef: ref };
const input = { email, code: '12345678' };

beforeEach(() => {
  Object.values(m).forEach((mock) => mock.mockReset());
  m.ready.mockResolvedValueOnce({ ok: false, reason: 'invalid_session' }).mockResolvedValue(ready);
  m.reserve.mockResolvedValue({ ok: true, signupRef: ref, epoch: 1000 });
  m.lookup.mockResolvedValue({ kind: 'found', user: user() });
  m.profile.mockResolvedValue(null);
  m.generate.mockResolvedValue({
    error: null,
    data: { user: user(), properties: { hashed_token: 'provider-secret-never-logged' } },
  });
  m.verify.mockResolvedValue({
    error: null,
    data: { user: { ...user(), email_confirmed_at: '2026-11-03T12:00:00Z' } },
  });
  m.client.mockResolvedValue({ auth: { verifyOtp: m.verify, signOut: m.signOut } });
  m.validate.mockResolvedValue({ ok: true });
  m.claim.mockResolvedValue({ ok: true });
  m.bind.mockResolvedValue({ ok: true });
  m.getUser.mockResolvedValue({ error: null, data: { user: user() } });
  m.update.mockResolvedValue({
    error: null,
    data: { user: { ...user(), app_metadata: markSignupPasswordSet(user(), ref) } },
  });
  m.finish.mockResolvedValue(true);
  m.plan.mockResolvedValue({ ok: true });
  m.owned.mockResolvedValue({ ok: true, signupRef: ref, credentialState: 'completed' });
  m.billing.mockResolvedValue({ ok: true, snapshot: { state: null } });
  m.liveness.mockResolvedValue('gone');
});

describe('same-session signup code orchestration', () => {
  it('proves email, claims the draft and preserves the initial password without another password write', async () => {
    await expect(confirmSignupEmailCode(token, input)).resolves.toEqual({
      ok: true,
      next: '/cadastro/plano',
    });
    expect(m.verify).toHaveBeenCalledWith({
      token_hash: 'provider-secret-never-logged',
      type: 'recovery',
    });
    expect(m.claim).toHaveBeenCalledWith(id, email, ref);
    expect(m.update).toHaveBeenCalledOnce();
    expect(m.update.mock.calls[0]?.[1]).not.toHaveProperty('password');
    expect(m.finish).toHaveBeenCalledWith(ref, 1000, 'verified');
    expect(m.signOut).not.toHaveBeenCalled();
  });
  it.each(['invalid', 'expired', 'locked', 'conflict', 'gone'])(
    'does not touch Auth after repository rejection %s',
    async (reason) => {
      m.reserve.mockResolvedValue({ ok: false, reason });
      await expect(confirmSignupEmailCode(token, input)).resolves.toEqual({ ok: false, reason });
      expect(m.lookup).not.toHaveBeenCalled();
      expect(m.generate).not.toHaveBeenCalled();
    },
  );
  it('rejects malformed input before reserving or accessing Auth', async () => {
    await expect(
      confirmSignupEmailCode(token, { ...input, code: '1234', userId: id }),
    ).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(m.reserve).not.toHaveBeenCalled();
    expect(m.lookup).not.toHaveBeenCalled();
  });
  it('reuses an already authenticated committed result on repeated clicks', async () => {
    m.ready.mockReset().mockResolvedValue(ready);
    await expect(confirmSignupEmailCode(token, input)).resolves.toEqual({
      ok: true,
      next: '/cadastro/plano',
    });
    expect(m.reserve).not.toHaveBeenCalled();
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });
  it('never overwrites credentials of an existing clinic', async () => {
    m.profile.mockResolvedValue({ id });
    await expect(confirmSignupEmailCode(token, input)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });
  it('does not accept a provider user substitution', async () => {
    m.generate.mockResolvedValue({
      error: null,
      data: { user: { ...user(), id: 'other' }, properties: { hashed_token: 'secret' } },
    });
    await expect(confirmSignupEmailCode(token, input)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.claim).not.toHaveBeenCalled();
  });
  it('rejects a verified session for another email and clears it', async () => {
    m.verify.mockResolvedValue({
      error: null,
      data: {
        user: {
          ...user(),
          email: 'other@example.test',
          email_confirmed_at: '2026-11-03T12:00:00Z',
        },
      },
    });
    await expect(confirmSignupEmailCode(token, input)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(m.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(m.claim).not.toHaveBeenCalled();
  });
  it.each(['validate', 'claim', 'bind'] as const)(
    'fails closed if %s cannot commit',
    async (stage) => {
      m[stage].mockResolvedValue({ ok: false, reason: 'unavailable' });
      await expect(confirmSignupEmailCode(token, input)).resolves.toEqual({
        ok: false,
        reason: 'unavailable',
      });
      expect(m.update).not.toHaveBeenCalled();
      expect(m.finish).toHaveBeenLastCalledWith(ref, 1000, 'uncertain');
      expect(m.signOut).toHaveBeenCalled();
    },
  );
  it('does not preserve a pre-verification password from another abandoned draft', async () => {
    m.lookup.mockResolvedValue({
      kind: 'found',
      user: { ...user(), app_metadata: createPendingSignupAppMetadata('b'.repeat(64), true) },
    });
    await expect(confirmSignupEmailCode(token, input)).resolves.toEqual({
      ok: true,
      next: '/cadastro/confirmado',
      mailProof: { userId: id, signupRef: ref },
    });
    expect(m.update).not.toHaveBeenCalled();
    expect(m.liveness).toHaveBeenCalledOnce();
  });
  it('does not rotate or adopt another live draft merely knowing its email', async () => {
    m.lookup.mockResolvedValue({
      kind: 'found',
      user: { ...user(), app_metadata: createPendingSignupAppMetadata('b'.repeat(64)) },
    });
    m.liveness.mockResolvedValue('live');
    await expect(confirmSignupEmailCode(token, input)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.claim).not.toHaveBeenCalled();
  });
  it('legacy passwordless account gets its first password, never an invented ready credential', async () => {
    m.lookup.mockResolvedValue({
      kind: 'found',
      user: { ...user(), app_metadata: createPendingSignupAppMetadata(ref) },
    });
    await expect(confirmSignupEmailCode(token, input)).resolves.toEqual({
      ok: true,
      next: '/cadastro/confirmado',
      mailProof: { userId: id, signupRef: ref },
    });
    expect(m.update).not.toHaveBeenCalled();
  });
  it('keeps lost external responses uncertain and emits no code, email or bearer in logs', async () => {
    m.generate.mockRejectedValue(new Error(`${email} ${input.code} provider-secret-never-logged`));
    await expect(confirmSignupEmailCode(token, input)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(m.finish).toHaveBeenCalledWith(ref, 1000, 'uncertain');
    expect(JSON.stringify(m.warn.mock.calls)).not.toContain(email);
    expect(JSON.stringify(m.warn.mock.calls)).not.toContain(input.code);
    expect(JSON.stringify(m.warn.mock.calls)).not.toContain('provider-secret');
  });
  it('reconciles an Auth-ready result after a lost SQL finalization without another password write', async () => {
    m.lookup.mockResolvedValue({
      kind: 'found',
      user: { ...user(), app_metadata: markSignupPasswordSet(user(), ref) },
    });
    await expect(confirmSignupEmailCode(token, input)).resolves.toEqual({
      ok: true,
      next: '/cadastro/plano',
    });
    expect(m.update).not.toHaveBeenCalled();
  });
});

describe('continuation resolver', () => {
  it.each(['reserved', 'active', 'creation_unknown'])(
    'returns existing payment reconciliation for %s without creating checkout',
    async (state) => {
      m.ready.mockReset().mockResolvedValue(ready);
      m.billing.mockResolvedValue({ ok: true, snapshot: { state } });
      await expect(resolveSignupContinuation()).resolves.toEqual({
        ok: true,
        next: '/cadastro/pagamento?resultado=pending',
      });
      expect(m.plan).not.toHaveBeenCalled();
    },
  );
  it('requests only legitimately missing details after verified recovery', async () => {
    m.ready.mockReset().mockResolvedValue(ready);
    m.owned.mockResolvedValue({ ok: false, reason: 'gone' });
    await expect(resolveSignupContinuation()).resolves.toEqual({
      ok: true,
      next: '/cadastro/continuar',
    });
    expect(m.billing).not.toHaveBeenCalled();
  });
  it('does not fabricate a next stage while the authoritative plan read is unavailable', async () => {
    m.ready.mockReset().mockResolvedValue(ready);
    m.plan.mockResolvedValue({ ok: false });
    await expect(resolveSignupContinuation()).resolves.toEqual({ ok: false });
  });
});
