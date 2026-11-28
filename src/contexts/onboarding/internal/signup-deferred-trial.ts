import 'server-only';

import { resolveSignupTrialTerms } from './signup-trial';

export interface DeferredSignupTrialTerms {
  trialEndsAt: Date;
  stage: 'trial_active' | 'payment_required';
  recurringCheckoutAllowed: boolean;
  /** Omit trialDays in the gateway product: the Qoro trial has already elapsed. */
  nativeTrialDays: null;
}

/**
 * Candidate policy approved by the founder: trial in Qoro; checkout at its end.
 * Inputs come from Auth/server time. This does not authenticate, provision a
 * clinic or grant paid access, and is not wired into the existing Asaas journey.
 * Legacy plans are deliberately excluded.
 */
export function resolveDeferredSignupTrialTerms(input: {
  planCode: string;
  authCreatedAt: Date;
  now: Date;
}): DeferredSignupTrialTerms | null {
  const terms = resolveSignupTrialTerms({
    planCode: input.planCode,
    authCreatedAt: input.authCreatedAt,
    attemptedAt: input.now,
  });
  if (!terms?.strictDeadline) return null;
  return {
    trialEndsAt: terms.endsAt,
    stage: terms.expiredAtCheckout ? 'payment_required' : 'trial_active',
    recurringCheckoutAllowed: terms.expiredAtCheckout,
    nativeTrialDays: null,
  };
}
