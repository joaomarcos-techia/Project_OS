import { describe, expect, it } from 'vitest';

import { abacatePayRenewalPeriod as period } from './abacatepay-renewal-period';

const input = {
  anchorStart: new Date('2026-01-31T23:59:59.888Z'),
  chargeCreatedAt: '2026-02-28T23:59:58.000Z',
  confirmedAt: '2026-03-01T00:00:02Z',
  now: new Date('2026-03-04T00:00:00Z'),
};
describe('approved original monthly Qoro renewal calendar', () => {
  it('uses authoritative paid-period dates for a late shared-checkout receipt without moving the anniversary', () => {
    expect(
      period({
        ...input,
        chargeCreatedAt: '2026-03-07T12:00:00Z',
        confirmedAt: '2026-03-07T12:00:01Z',
        now: new Date('2026-03-08T00:00:00Z'),
        providerPeriodStart: '2026-02-28',
        providerPeriodEnd: '2026-03-31',
      }),
    ).toEqual(period(input));
  });
  it.each([
    { providerPeriodStart: '2026-03-01', providerPeriodEnd: '2026-03-31' },
    { providerPeriodStart: '2026-02-28', providerPeriodEnd: '2026-03-30' },
    { providerPeriodStart: '2026-02-28' },
  ])(
    'reviews missing or contradictory provider period instead of resetting the calendar %j',
    (metadata) => {
      expect(period({ ...input, ...metadata })).toBeNull();
    },
  );
  it('clamps February without drifting the following anniversary to the 28th', () => {
    expect(period(input)).toEqual({
      index: 1,
      start: new Date('2026-02-28T23:59:59.888Z'),
      end: new Date('2026-03-31T23:59:59.888Z'),
    });
  });
  it('payment delay preserves the cycle instead of purchasing a new month from payment time', () => {
    const late = {
      ...input,
      confirmedAt: '2026-03-25T12:00:00Z',
      now: new Date('2026-03-26T00:00:00Z'),
    };
    expect(period(late)).toEqual(period(input));
  });
  it('a later calendar month always derives from the original anchor', () => {
    expect(
      period({
        ...input,
        chargeCreatedAt: '2026-03-31T23:59:59Z',
        confirmedAt: '2026-04-01T00:01:00Z',
        now: new Date('2026-04-02T00:00:00Z'),
      }),
    ).toEqual({
      index: 2,
      start: new Date('2026-03-31T23:59:59.888Z'),
      end: new Date('2026-04-30T23:59:59.888Z'),
    });
  });
  it('supports leap-year boundaries', () => {
    expect(
      period({
        ...input,
        anchorStart: new Date('2028-01-31T23:59:59.888Z'),
        chargeCreatedAt: '2028-02-29T23:59:59.888Z',
        confirmedAt: '2028-03-01T00:00:00Z',
        now: new Date('2028-03-01T00:00:01Z'),
      })?.start.toISOString(),
    ).toBe('2028-02-29T23:59:59.888Z');
  });
  it('preserves the instant across year and timezone representation changes', () => {
    expect(
      period({
        anchorStart: new Date('2026-12-31T20:59:59.888-03:00'),
        chargeCreatedAt: '2027-01-31T20:59:59.888-03:00',
        confirmedAt: '2027-02-01T00:00:00Z',
        now: new Date('2027-02-02T00:00:00Z'),
      }),
    ).toEqual({
      index: 1,
      start: new Date('2027-01-31T23:59:59.888Z'),
      end: new Date('2027-02-28T23:59:59.888Z'),
    });
  });
  it.each([
    { chargeCreatedAt: '2026-01-31T23:59:59.888Z' },
    { chargeCreatedAt: '2026-02-27T00:00:00Z' },
    { chargeCreatedAt: '2026-03-02T00:00:00Z' },
    { chargeCreatedAt: 'invalid' },
    { confirmedAt: 'invalid' },
    { chargeCreatedAt: '2027-01-31T23:59:59.888Z' },
    { confirmedAt: '2027-03-01T00:00:00Z' },
    { confirmedAt: '2026-02-28T23:58:57Z' },
    { anchorStart: new Date('invalid') },
    { now: new Date('invalid') },
  ])('ambiguous, initial, invalid or future evidence requires review: %j', (overrides) => {
    expect(period({ ...input, ...overrides })).toBeNull();
  });
  it.each([-60_001, -60_000, 0, 60_000, 60_001])(
    'the creation tolerance is bounded at exactly one minute (%i ms)',
    (delta) => {
      const boundary = Date.parse('2026-02-28T23:59:59.888Z');
      const result = period({
        ...input,
        chargeCreatedAt: new Date(boundary + delta).toISOString(),
        confirmedAt: '2026-03-01T00:05:00Z',
      });
      expect(result !== null).toBe(Math.abs(delta) <= 60_000);
      if (result) {
        expect(result.index).toBe(1);
        expect(result.start.getTime()).toBe(boundary);
      }
    },
  );
});
