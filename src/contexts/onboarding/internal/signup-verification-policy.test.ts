import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  env: { MAGIC_TOKEN_SECRET: 'synthetic-only-signup-verification-policy-secret' },
}));

import { deriveSignupHandoffCode } from './signup-auth-binding';
import { checkSignupEmailCode, SIGNUP_EMAIL_CODE_TTL_SECONDS } from './signup-verification-policy';

const ref = 'a'.repeat(64);
const issuedAt = new Date('2026-11-03T12:00:00Z');
function challenge() {
  return {
    signupRef: ref,
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + SIGNUP_EMAIL_CODE_TTL_SECONDS * 1_000),
    code: deriveSignupHandoffCode(ref, issuedAt.getTime()),
    attempts: 0,
    consumed: false,
    now: new Date('2026-11-03T12:01:00Z'),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('email-code proof policy, no provider or database claims', () => {
  it('accepts the code only for the exact reference and epoch', () => {
    expect(checkSignupEmailCode(challenge())).toEqual({ ok: true });
    expect(checkSignupEmailCode({ ...challenge(), signupRef: 'b'.repeat(64) }).ok).toBe(false);
    expect(
      checkSignupEmailCode({ ...challenge(), issuedAt: new Date(issuedAt.getTime() + 1) }).ok,
    ).toBe(false);
  });
  it('rejects expiry at the exact deadline', () => {
    const input = challenge();
    expect(checkSignupEmailCode({ ...input, now: input.expiresAt })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });
  it('does not allow a caller to extend the maximum code lifetime', () => {
    expect(
      checkSignupEmailCode({ ...challenge(), expiresAt: new Date('2026-11-03T12:10:00.001Z') }),
    ).toEqual({ ok: false, reason: 'invalid' });
  });
  it('locks at five attempts even with the correct code', () => {
    expect(checkSignupEmailCode({ ...challenge(), attempts: 5 })).toEqual({
      ok: false,
      reason: 'locked',
    });
    expect(checkSignupEmailCode({ ...challenge(), attempts: 4 })).toEqual({ ok: true });
  });
  it('does not reuse a consumed challenge', () => {
    expect(checkSignupEmailCode({ ...challenge(), consumed: true })).toEqual({
      ok: false,
      reason: 'consumed',
    });
  });
  it.each(['', '1234567', '123456789', 'abcdefgh', '1234 5678', '１２３４５６７８'])(
    'rejects malformed code %s',
    (code) =>
      expect(checkSignupEmailCode({ ...challenge(), code })).toEqual({
        ok: false,
        reason: 'invalid',
      }),
  );
  it.each([Number.NaN, -1, 0.5])('fails closed on invalid persisted attempts %s', (attempts) => {
    expect(checkSignupEmailCode({ ...challenge(), attempts })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
  it('rejects future issuance and invalid dates', () => {
    expect(checkSignupEmailCode({ ...challenge(), now: new Date(issuedAt.getTime() - 1) }).ok).toBe(
      false,
    );
    expect(checkSignupEmailCode({ ...challenge(), expiresAt: new Date(Number.NaN) }).ok).toBe(
      false,
    );
  });
});
