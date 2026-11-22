import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/supabase-server', () => ({
  createServerClient: vi.fn(() => {
    throw new Error('Pure policy must not call Auth');
  }),
}));

import { resolveDeferredSignupTrialTerms } from './signup-deferred-trial';

const createdAt = new Date('2026-11-07T23:45:30.123Z');
const deadline = new Date('2026-11-21T23:45:30.123Z');

describe('candidate Qoro-owned trial before recurring checkout', () => {
  it.each([
    'consultorio_2026',
    'clinica_2026_2',
    'clinica_2026_3',
    'clinica_2026_4',
    'clinica_2026_5',
  ])('preserves the absolute Auth deadline for %s', (planCode) => {
    expect(
      resolveDeferredSignupTrialTerms({ planCode, authCreatedAt: createdAt, now: createdAt }),
    ).toEqual({
      trialEndsAt: deadline,
      stage: 'trial_active',
      recurringCheckoutAllowed: false,
      nativeTrialDays: null,
    });
  });
  it('refuses checkout one millisecond before the deadline, allows it exactly at it', () => {
    const base = { planCode: 'consultorio_2026', authCreatedAt: createdAt };
    expect(
      resolveDeferredSignupTrialTerms({ ...base, now: new Date(deadline.getTime() - 1) }),
    ).toMatchObject({ stage: 'trial_active', recurringCheckoutAllowed: false });
    expect(resolveDeferredSignupTrialTerms({ ...base, now: deadline })).toMatchObject({
      stage: 'payment_required',
      recurringCheckoutAllowed: true,
      nativeTrialDays: null,
    });
  });
  it('does not restart the trial after reloads or a delayed checkout', () => {
    const base = { planCode: 'clinica_2026_2', authCreatedAt: createdAt };
    for (const now of [new Date('2026-11-15T00:00Z'), new Date('2026-12-31T23:00Z')]) {
      expect(resolveDeferredSignupTrialTerms({ ...base, now })?.trialEndsAt).toEqual(deadline);
    }
  });
  it.each(['solo', 'clinica', 'pro', 'unknown'])(
    'does not reroute or reinterpret the legacy/unknown plan %s',
    (planCode) => {
      expect(
        resolveDeferredSignupTrialTerms({ planCode, authCreatedAt: createdAt, now: deadline }),
      ).toBeNull();
    },
  );
  it.each([
    { authCreatedAt: new Date(NaN), now: deadline },
    { authCreatedAt: createdAt, now: new Date(NaN) },
    { authCreatedAt: deadline, now: createdAt },
  ])('fails closed for invalid/future Auth timestamps', (dates) => {
    expect(resolveDeferredSignupTrialTerms({ planCode: 'consultorio_2026', ...dates })).toBeNull();
  });
  it('handles leap years and keeps the exact timestamp', () => {
    expect(
      resolveDeferredSignupTrialTerms({
        planCode: 'consultorio_2026',
        authCreatedAt: new Date('2028-02-29T02:59:59Z'),
        now: new Date('2028-03-14T02:59:59Z'),
      }),
    ).toEqual({
      trialEndsAt: new Date('2028-03-14T02:59:59Z'),
      stage: 'payment_required',
      recurringCheckoutAllowed: true,
      nativeTrialDays: null,
    });
  });
});
