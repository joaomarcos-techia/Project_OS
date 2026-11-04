import 'server-only';

import { verifySignupHandoffCode } from './signup-auth-binding';

export const SIGNUP_EMAIL_CODE_TTL_SECONDS = 10 * 60;
export const SIGNUP_EMAIL_CODE_MAX_ATTEMPTS = 5;

export type SignupEmailCodeCheck =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'expired' | 'locked' | 'consumed' };

/** Pure decision; the repository must reserve/consume the same epoch with CAS. */
export function checkSignupEmailCode(input: {
  signupRef: string;
  issuedAt: Date;
  expiresAt: Date;
  code: string;
  attempts: number;
  consumed: boolean;
  now: Date;
}): SignupEmailCodeCheck {
  const now = input.now.getTime();
  const issuedAt = input.issuedAt.getTime();
  const expiresAt = input.expiresAt.getTime();
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt <= 0 ||
    issuedAt > now ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > SIGNUP_EMAIL_CODE_TTL_SECONDS * 1_000 ||
    !Number.isSafeInteger(input.attempts) ||
    input.attempts < 0
  )
    return { ok: false, reason: 'invalid' };
  if (input.consumed) return { ok: false, reason: 'consumed' };
  if (now >= expiresAt) return { ok: false, reason: 'expired' };
  if (input.attempts >= SIGNUP_EMAIL_CODE_MAX_ATTEMPTS) return { ok: false, reason: 'locked' };
  return verifySignupHandoffCode(input.signupRef, issuedAt, input.code)
    ? { ok: true }
    : { ok: false, reason: 'invalid' };
}
