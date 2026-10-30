import { describe, expect, it } from 'vitest';

import {
  isSignupReleaseCheckAvailable,
  SIGNUP_RELEASE_CHECK_EXPIRES_AT,
} from './signup-release-check';

describe('temporary signup release check', () => {
  it('is available only while signup is explicitly closed and before expiry', () => {
    expect(isSignupReleaseCheckAvailable(false, SIGNUP_RELEASE_CHECK_EXPIRES_AT - 1)).toBe(true);
    expect(isSignupReleaseCheckAvailable(true, SIGNUP_RELEASE_CHECK_EXPIRES_AT - 1)).toBe(false);
  });

  it('expires at the exact deadline and rejects invalid clocks', () => {
    expect(isSignupReleaseCheckAvailable(false, SIGNUP_RELEASE_CHECK_EXPIRES_AT)).toBe(false);
    expect(isSignupReleaseCheckAvailable(false, SIGNUP_RELEASE_CHECK_EXPIRES_AT + 1)).toBe(false);
    expect(isSignupReleaseCheckAvailable(false, Number.NaN)).toBe(false);
  });
});
