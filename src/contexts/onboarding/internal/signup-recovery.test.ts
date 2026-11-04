import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  insert: vi.fn(),
  getUser: vi.fn(),
  findUser: vi.fn(),
  profile: vi.fn(),
  generate: vi.fn(),
  verify: vi.fn(),
  updateAuth: vi.fn(),
  signin: vi.fn(),
  signout: vi.fn(),
  clear: vi.fn(),
  resume: vi.fn(),
  claim: vi.fn(),
  next: vi.fn(),
  exposure: vi.fn(),
  send: vi.fn(),
  fetch: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  dbAdmin: {
    select: () => ({
      from: () => ({ where: () => ({ limit: m.read, orderBy: () => ({ limit: m.read }) }) }),
    }),
    insert: () => ({ values: () => ({ onConflictDoNothing: m.insert }) }),
    update: () => ({
      set: (value: unknown) => ({
        where: () => ({
          returning: () => m.write(value),
          then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
            m.write(value).then(resolve, reject),
        }),
      }),
    }),
  },
}));
vi.mock('@/lib/env', () => ({
  env: {
    MAGIC_TOKEN_SECRET: 'synthetic-recovery-test-secret-32-chars',
    LOGIN_HASH_PEPPER: 'synthetic-recovery-test-pepper-32-chars',
    RESEND_API_KEY: 'synthetic-resend',
    APP_BASE_URL: 'https://app.qoro.test',
    NODE_ENV: 'test',
  },
}));
vi.mock('@/lib/auth/supabase-admin', () => ({
  findAdminUserByEmail: m.findUser,
  createAdminClient: () => ({
    auth: {
      admin: { getUserById: m.getUser, updateUserById: m.updateAuth, generateLink: m.generate },
    },
  }),
}));
vi.mock('@/lib/auth/supabase-server', () => ({
  createServerClient: async () => ({
    auth: { verifyOtp: m.verify, signInWithPassword: m.signin, signOut: m.signout },
  }),
  clearSupabaseSessionSelector: m.clear,
}));
vi.mock('@/lib/auth/tenant-context', () => ({ readAuthoritativeProfile: m.profile }));
vi.mock('./signup-draft', () => ({
  resumeRetainedOwnedSignupDraft: m.resume,
  ensureSignupDraftForVerifiedEmail: m.claim,
}));
vi.mock('./signup-email-code', () => ({ resolveSignupContinuation: m.next }));
vi.mock('./signup-confirmation-email', () => ({ checkSignupPasswordExposure: m.exposure }));
vi.mock('@/lib/email/retry', () => ({ sendTransactionalEmailRetried: m.send }));
vi.mock('@/lib/observability/logger', () => ({ logger: { warn: m.warn } }));

import { createPendingSignupAppMetadata, markSignupPasswordSet } from './signup-auth-binding';
import {
  consumeSignupRecovery,
  prepareSignupRecovery,
  sendSignupLeadRecovery,
  completeRecoveredSignupPassword,
  requestSignupRecovery,
} from './signup-recovery';
import { hashEmail } from '@/lib/auth/email-hash';

const id = '11111111-1111-4111-8111-111111111111';
const grantId = '22222222-2222-4222-8222-222222222222';
const messageId = '33333333-3333-4333-8333-333333333333';
const email = 'synthetic@example.test';
const ref = 'a'.repeat(64);
const operationKey = 'synthetic-lead-recovery-v1';
const pendingUser = () => ({ id, email, app_metadata: createPendingSignupAppMetadata(ref, true) });
const confirmedUser = () => ({ ...pendingUser(), email_confirmed_at: '2026-11-03T12:00:00Z' });
function grant(state = 'prepared') {
  return {
    id: grantId,
    tokenHash: 'b'.repeat(64),
    operationKey,
    authUserId: id,
    emailHash: hashEmail(email),
    signupRef: ref,
    purpose: 'verify_email',
    expiresAt: new Date(Date.now() + 3_600_000),
    state,
    passwordState: 'none',
    consumedAt: state === 'consumed' ? new Date() : null,
    providerMessageId: null,
    createdAt: new Date(),
  };
}
const prepareInput = { userId: id, operationKey, purpose: 'verify_email' as const };
const sendInput = {
  ...prepareInput,
  priorMessageId: messageId,
  publicOrigin: 'https://app.qoro.test',
};
const consumeInput = { token: 'A'.repeat(43) };

beforeEach(() => {
  Object.values(m).forEach((mock) => mock.mockReset());
  vi.stubGlobal('fetch', m.fetch);
  m.getUser.mockResolvedValue({ data: { user: pendingUser() }, error: null });
  m.findUser.mockResolvedValue({ kind: 'found', user: pendingUser() });
  m.profile.mockResolvedValue(null);
  m.read.mockResolvedValue([grant()]);
  m.write.mockResolvedValue([]);
  m.generate.mockResolvedValue({
    error: null,
    data: { user: pendingUser(), properties: { hashed_token: 'never-logged-provider-token' } },
  });
  m.verify.mockResolvedValue({ error: null, data: { user: confirmedUser() } });
  m.claim.mockResolvedValue({ ok: false, reason: 'gone' });
  m.next.mockResolvedValue({ ok: true, next: '/cadastro/continuar' });
  m.exposure.mockResolvedValue('safe');
  m.send.mockResolvedValue({ providerMessageId: messageId });
  m.fetch.mockResolvedValue(Response.json({ to: [email], last_event: 'delivered' }));
  m.signin.mockResolvedValue({ error: null, data: { user: confirmedUser(), session: {} } });
  m.updateAuth.mockResolvedValue({
    error: null,
    data: { user: { ...confirmedUser(), app_metadata: markSignupPasswordSet(pendingUser(), ref) } },
  });
});

describe('recovery eligibility and send', () => {
  it('prepares the same operation without sending, creating accounts, or exposing a plaintext token in SQL', async () => {
    const first = await prepareSignupRecovery(prepareInput);
    const second = await prepareSignupRecovery(prepareInput);
    expect(first.ok).toBe(true);
    expect(first).toEqual(second);
    if (first.ok) expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(m.send).not.toHaveBeenCalled();
    expect(m.updateAuth).not.toHaveBeenCalled();
  });
  it.each(['confirmed', 'profile', 'different-user', 'expired', 'already-sent'])(
    'rejects obsolete/ineligible lead %s',
    async (kind) => {
      if (kind === 'confirmed')
        m.getUser.mockResolvedValue({ data: { user: confirmedUser() }, error: null });
      if (kind === 'profile') m.profile.mockResolvedValue({ id });
      if (kind === 'different-user')
        m.read.mockResolvedValue([{ ...grant(), authUserId: grantId }]);
      if (kind === 'expired') m.read.mockResolvedValue([{ ...grant(), expiresAt: new Date(0) }]);
      if (kind === 'already-sent') m.read.mockResolvedValue([grant('sent')]);
      expect((await prepareSignupRecovery(prepareInput)).ok).toBe(false);
      expect(m.send).not.toHaveBeenCalled();
    },
  );
  it('sends only after repeated eligibility check and records one receipt', async () => {
    m.read
      .mockResolvedValueOnce([grant()])
      .mockResolvedValueOnce([grant()])
      .mockResolvedValueOnce([]);
    m.write.mockResolvedValueOnce([{ id: grantId }]).mockResolvedValueOnce([{ id: grantId }]);
    await expect(sendSignupLeadRecovery(sendInput)).resolves.toEqual({ ok: true, messageId });
    expect(m.getUser).toHaveBeenCalledTimes(2);
    expect(m.send).toHaveBeenCalledOnce();
    expect(m.send.mock.calls[0]?.[0].idempotencyKey).toBe(`signup-recovery:${grantId}`);
    expect(m.send.mock.calls[0]?.[0].text).toContain(
      'Se algum dado anterior não estiver mais disponível',
    );
  });
  it.each(['bounced', 'complained', 'suppressed', 'failed'])(
    'never resends to %s',
    async (last_event) => {
      m.fetch.mockResolvedValue(Response.json({ to: [email], last_event }));
      await expect(sendSignupLeadRecovery(sendInput)).resolves.toEqual({
        ok: false,
        reason: 'suppressed',
      });
      expect(m.send).not.toHaveBeenCalled();
      expect(m.write).not.toHaveBeenCalled();
    },
  );
  it('skips a lead that confirms email between preparation and actual send', async () => {
    m.getUser
      .mockResolvedValueOnce({ data: { user: pendingUser() }, error: null })
      .mockResolvedValueOnce({ data: { user: confirmedUser() }, error: null });
    expect((await sendSignupLeadRecovery(sendInput)).ok).toBe(false);
    expect(m.send).not.toHaveBeenCalled();
  });
  it('does not send twice when the reservation was already consumed by another worker', async () => {
    await expect(sendSignupLeadRecovery(sendInput)).resolves.toEqual({
      ok: false,
      reason: 'ineligible',
    });
    expect(m.send).not.toHaveBeenCalled();
  });
  it('does not email an unrelated address even if the supplied provider ID exists', async () => {
    m.fetch.mockResolvedValue(
      Response.json({ to: ['other@example.test'], last_event: 'delivered' }),
    );
    expect((await sendSignupLeadRecovery(sendInput)).ok).toBe(false);
    expect(m.send).not.toHaveBeenCalled();
  });
});

describe('single-use recovery proof', () => {
  it('confirms the same identity without changing a password or creating missing details', async () => {
    m.write
      .mockResolvedValueOnce([grant('reserved')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: grantId }]);
    await expect(consumeSignupRecovery(consumeInput)).resolves.toEqual({
      ok: true,
      next: '/cadastro/confirmado',
      userId: id,
      signupRef: ref,
    });
    expect(m.updateAuth).not.toHaveBeenCalled();
    expect(m.claim).toHaveBeenCalledWith(id, email, ref);
    expect(m.verify).toHaveBeenCalledWith({
      token_hash: 'never-logged-provider-token',
      type: 'recovery',
    });
  });
  it('rejects an already used/expired token before provider access', async () => {
    await expect(consumeSignupRecovery(consumeInput)).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(m.getUser).not.toHaveBeenCalled();
    expect(m.generate).not.toHaveBeenCalled();
  });
  it('does not reuse recovery after a profile has been provisioned', async () => {
    m.write.mockResolvedValueOnce([grant('reserved')]);
    m.profile.mockResolvedValue({ id });
    await expect(consumeSignupRecovery(consumeInput)).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(m.generate).not.toHaveBeenCalled();
    expect(m.verify).not.toHaveBeenCalled();
  });
  it('preserves the ready password and resumes through the common resolver', async () => {
    m.write
      .mockResolvedValueOnce([grant('reserved')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: grantId }]);
    m.getUser.mockResolvedValue({
      data: {
        user: { ...confirmedUser(), app_metadata: markSignupPasswordSet(pendingUser(), ref) },
      },
      error: null,
    });
    await expect(consumeSignupRecovery(consumeInput)).resolves.toMatchObject({
      ok: true,
      next: '/cadastro/continuar',
    });
    expect(m.updateAuth).not.toHaveBeenCalled();
    expect(m.resume).toHaveBeenCalledWith(id, email, ref);
  });
  it('keeps a lost proof response reserved and clears partial authentication', async () => {
    m.write.mockResolvedValueOnce([grant('reserved')]);
    m.verify.mockRejectedValue(new Error('network unavailable'));
    await expect(consumeSignupRecovery(consumeInput)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(m.signout).toHaveBeenCalled();
    expect(m.clear).toHaveBeenCalled();
    expect(m.write.mock.calls.some(([value]) => value.state === 'sent')).toBe(false);
  });
});

describe('first password only when genuinely missing', () => {
  const input = { userId: id, email, signupRef: ref, password: 'SyntheticPassword8!' };
  beforeEach(() => {
    m.read.mockResolvedValue([grant('consumed')]);
    m.getUser.mockResolvedValue({ data: { user: confirmedUser() }, error: null });
  });
  it('reserves the credential before Auth and routes missing details to the existing form', async () => {
    m.write.mockResolvedValueOnce([{ id: grantId }]).mockResolvedValueOnce([]);
    await expect(completeRecoveredSignupPassword(input)).resolves.toEqual({
      ok: true,
      next: '/cadastro/continuar',
    });
    expect(m.updateAuth).toHaveBeenCalledOnce();
    expect(m.write.mock.invocationCallOrder[0]).toBeLessThan(
      m.updateAuth.mock.invocationCallOrder[0]!,
    );
    expect(m.updateAuth.mock.calls[0]?.[1].password).toBe(input.password);
  });
  it('never overwrites an already ready password', async () => {
    m.getUser.mockResolvedValue({
      data: {
        user: { ...confirmedUser(), app_metadata: markSignupPasswordSet(pendingUser(), ref) },
      },
      error: null,
    });
    expect((await completeRecoveredSignupPassword(input)).ok).toBe(true);
    expect(m.updateAuth).not.toHaveBeenCalled();
  });
  it('does not write Auth when another request already holds the credential reservation', async () => {
    await expect(completeRecoveredSignupPassword(input)).resolves.toEqual({
      ok: false,
      reason: 'conflict',
    });
    expect(m.updateAuth).not.toHaveBeenCalled();
  });
  it('refuses a weak password before reserving or changing credentials', async () => {
    m.exposure.mockResolvedValue('pwned');
    await expect(completeRecoveredSignupPassword(input)).resolves.toEqual({
      ok: false,
      reason: 'weak_password',
    });
    expect(m.write).not.toHaveBeenCalled();
    expect(m.updateAuth).not.toHaveBeenCalled();
  });
  it('does not invent an authority after the consumed grant expires', async () => {
    m.read.mockResolvedValue([]);
    await expect(completeRecoveredSignupPassword(input)).resolves.toEqual({
      ok: false,
      reason: 'unauthorized',
    });
    expect(m.updateAuth).not.toHaveBeenCalled();
  });
  it('releases only a definitive provider weak-password refusal, allowing a stronger retry', async () => {
    m.write.mockResolvedValueOnce([{ id: grantId }]).mockResolvedValueOnce([]);
    m.updateAuth.mockResolvedValue({ error: { code: 'weak_password' }, data: { user: null } });
    await expect(completeRecoveredSignupPassword(input)).resolves.toEqual({
      ok: false,
      reason: 'weak_password',
    });
    expect(m.write.mock.calls[1]?.[0]).toEqual({ passwordState: 'none' });
    expect(m.signin).not.toHaveBeenCalled();
  });
  it('keeps an unknown password mutation uncertain rather than allowing another writer', async () => {
    m.write.mockResolvedValueOnce([{ id: grantId }]).mockResolvedValueOnce([]);
    m.updateAuth.mockRejectedValue(new Error('lost response'));
    await expect(completeRecoveredSignupPassword(input)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(m.write.mock.calls[1]?.[0]).toEqual({ passwordState: 'uncertain' });
    expect(m.signin).not.toHaveBeenCalled();
  });
});

describe('public recovery re-entry', () => {
  it('does not create accounts or send when the address is unknown', async () => {
    m.findUser.mockResolvedValue({ kind: 'not_found' });
    await requestSignupRecovery(email, sendInput.publicOrigin);
    expect(m.read).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });
  it('does not send to a converted profile', async () => {
    m.profile.mockResolvedValue({ id });
    await requestSignupRecovery(email, sendInput.publicOrigin);
    expect(m.read).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });
  it('does not manufacture delivery history for legacy rows that have none', async () => {
    m.read.mockResolvedValue([]);
    await requestSignupRecovery(email, sendInput.publicOrigin);
    expect(m.send).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
  });
  it('checks recorded provider delivery before sending and suppresses a permanent bounce', async () => {
    m.read.mockResolvedValueOnce([{ messageId }]).mockResolvedValueOnce([grant()]);
    m.fetch.mockResolvedValue(Response.json({ to: [email], last_event: 'bounced' }));
    await requestSignupRecovery(email, sendInput.publicOrigin);
    expect(m.fetch).toHaveBeenCalledOnce();
    expect(m.send).not.toHaveBeenCalled();
  });
});
