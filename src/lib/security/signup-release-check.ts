/** Temporary release check. Reopening signup or expiry closes both surfaces. */
export const SIGNUP_RELEASE_CHECK_EXPIRES_AT = Date.parse('2026-11-02T03:00:00Z');

export function isSignupReleaseCheckAvailable(signupEnabled: boolean, now = Date.now()): boolean {
  return signupEnabled === false && now < SIGNUP_RELEASE_CHECK_EXPIRES_AT;
}
