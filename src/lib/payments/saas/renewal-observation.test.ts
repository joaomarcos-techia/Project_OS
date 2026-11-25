import { describe, expect, it } from 'vitest';
import { summarizeRenewalObservation } from '../../../../scripts/abacatepay-renewal-observation';

const cycle = {
  paymentId: 'card_second',
  invoiceId: '98938ed5-b274-48bc-a22c-e03bac03ef7d',
  periodEnd: '2027-01-13T17:44:27.418Z',
  consistent: true,
  accessEffect: 'advanced',
};
const input = {
  now: '2026-11-13T21:00:00.000Z',
  initialPeriodEnd: '2026-12-13T17:44:27.418Z',
  localPeriodEnd: '2026-12-13T17:44:27.418Z',
  localStatus: 'active',
  initialPaymentConsistent: true,
  closureConfirmed: true,
  cycles: [],
  remote: { devMode: true, status: 'ACTIVE', nextChargeAt: null, bindingMatches: true },
};
describe('retained Sandbox renewal observation', () => {
  it('does not infer the provider due date from the Qoro period or ACTIVE', () => {
    expect(summarizeRenewalObservation(input)).toMatchObject({
      observationStatus: 'PASS',
      state: 'awaiting_next_cycle',
      officialNextChargeDate: null,
      externalTemporalRenewal: 'PARTIAL',
      accessEffect: 'none',
      databaseWrites: 0,
    });
  });
  it('reports a missing cycle exactly at expiry without extending access', () => {
    expect(summarizeRenewalObservation({ ...input, now: input.localPeriodEnd }).state).toBe(
      'due_unobserved',
    );
  });
  it('reports the official date separately from local access', () => {
    expect(
      summarizeRenewalObservation({
        ...input,
        remote: { ...input.remote, nextChargeAt: '2026-12-14' },
      }),
    ).toMatchObject({
      officialNextChargeDate: '2026-12-14',
      qoroPaidPeriodEnd: input.localPeriodEnd,
    });
  });
  it('keeps a stopped recurrence distinct from an unobserved renewal', () => {
    expect(
      summarizeRenewalObservation({ ...input, remote: { ...input.remote, status: 'CANCELLED' } })
        .state,
    ).toBe('recurrence_stopped');
  });
  it.each(['binding', 'initial_payment', 'unproven_period', 'unknown_status'])(
    'requires review for %s',
    (reason) => {
      const data = structuredClone(input);
      if (reason === 'binding') data.remote.bindingMatches = false;
      if (reason === 'initial_payment') data.initialPaymentConsistent = false;
      if (reason === 'unproven_period') data.localPeriodEnd = cycle.periodEnd;
      if (reason === 'unknown_status') data.remote.status = 'UNKNOWN';
      expect(summarizeRenewalObservation(data).state).toBe('review_required');
    },
  );
  it('distinguishes a correlated local renewal from external temporal homologation', () => {
    expect(
      summarizeRenewalObservation({ ...input, localPeriodEnd: cycle.periodEnd, cycles: [cycle] }),
    ).toMatchObject({
      state: 'renewal_recorded_requires_external_review',
      externalTemporalRenewal: 'PARTIAL',
    });
  });
  it.each(['duplicate', 'unpaid', 'review', 'period_mismatch'])(
    'rejects inconsistent renewal evidence: %s',
    (reason) => {
      const cycles = [{ ...cycle }];
      if (reason === 'duplicate') cycles.push({ ...cycle });
      if (reason === 'unpaid') cycles[0]!.consistent = false;
      if (reason === 'review') cycles[0]!.accessEffect = 'review';
      expect(
        summarizeRenewalObservation({
          ...input,
          localPeriodEnd: reason === 'period_mismatch' ? input.localPeriodEnd : cycle.periodEnd,
          cycles,
        }).state,
      ).toBe('review_required');
    },
  );
  it('rejects live resources and invalid dates rather than treating them as Sandbox evidence', () => {
    expect(() =>
      summarizeRenewalObservation({ ...input, remote: { ...input.remote, devMode: false } }),
    ).toThrow();
    expect(() => summarizeRenewalObservation({ ...input, now: 'tomorrow' })).toThrow();
  });
  it('requires review if a paid remote subscription is still a local trial or locally cancelled', () => {
    for (const localStatus of ['trial', 'cancelled']) {
      expect(summarizeRenewalObservation({ ...input, localStatus }).state).toBe('review_required');
    }
  });
});
