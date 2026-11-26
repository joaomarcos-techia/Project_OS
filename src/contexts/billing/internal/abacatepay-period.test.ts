import { describe, expect, it } from 'vitest';

import { initialAbacatePayAccessPeriod as period } from './abacatepay-period';

const trialEndsAt = new Date('2026-01-01T12:30:00.000Z');
describe('Qoro monthly access anchored to verified subscription creation', () => {
  it('allows a verified conversion during trial, bounded by the original Auth creation', () => {
    const input = {
      trialEndsAt,
      notBefore: new Date('2025-12-18T12:30:00Z'),
      now: new Date('2025-12-20T12:30:00Z'),
    };
    expect(period({ ...input, subscriptionCreatedAt: '2025-12-20T12:30:00Z' })).toEqual({
      start: new Date('2025-12-20T12:30:00Z'),
      end: new Date('2026-01-20T12:30:00Z'),
    });
    expect(period({ ...input, subscriptionCreatedAt: '2025-12-18T12:29:59Z' })).toBeNull();
    expect(period({ ...input, subscriptionCreatedAt: '2025-12-20T12:30:01Z' })).toBeNull();
  });
  it('preserves the original instant and calendar-month boundary on delayed receipt', () => {
    expect(
      period({
        subscriptionCreatedAt: '2026-01-31T13:45:12.345Z',
        trialEndsAt,
        now: new Date('2026-02-02T12:00:00Z'),
      }),
    ).toEqual({
      start: new Date('2026-01-31T13:45:12.345Z'),
      end: new Date('2026-02-28T13:45:12.345Z'),
    });
  });
  it('uses leap-year calendar arithmetic', () => {
    expect(
      period({
        subscriptionCreatedAt: '2028-01-31T00:00:00Z',
        trialEndsAt,
        now: new Date('2028-02-01T00:00:00Z'),
      })?.end.toISOString(),
    ).toBe('2028-02-29T00:00:00.000Z');
  });
  it.each([null, 'invalid', '2025-12-31T00:00:00Z', '2026-03-01T00:00:00Z'])(
    'rejects missing, invalid, pre-trial or future anchors: %s',
    (subscriptionCreatedAt) => {
      expect(
        period({ subscriptionCreatedAt, trialEndsAt, now: new Date('2026-02-01T00:00:00Z') }),
      ).toBeNull();
    },
  );
  it('does not regrant access from a paid initial bill after its original month ended', () => {
    expect(
      period({
        subscriptionCreatedAt: '2026-01-01T12:30:00Z',
        trialEndsAt,
        now: new Date('2026-02-01T12:30:00Z'),
      }),
    ).toBeNull();
  });
  it('does not invent a provider due date or renew a period using current time', () => {
    const result = period({
      subscriptionCreatedAt: '2026-01-05T12:30:00Z',
      trialEndsAt,
      now: new Date('2026-01-10T00:00:00Z'),
    });
    expect(result?.end.toISOString()).toBe('2026-02-05T12:30:00.000Z');
    expect(result).not.toHaveProperty('nextDueDate');
  });
  it.each([
    ['2026-12-31T23:59:59.888Z', '2026-12-31T23:59:59.887Z', false],
    ['2026-12-31T23:59:59.888Z', '2026-12-31T23:59:59.888Z', true],
    ['2026-12-31T20:59:59.888-03:00', '2026-12-31T23:59:59.888Z', true],
    ['2027-01-01T00:00:00.000Z', '2027-01-01T00:00:00.001Z', true],
  ])(
    'recontract boundary %s / %s permits a new verified period only at or after expiry',
    (end, created, allowed) => {
      const result = period({
        trialEndsAt: new Date(end),
        subscriptionCreatedAt: created,
        now: new Date('2027-01-02T00:00:00Z'),
      });
      expect(result !== null).toBe(allowed);
      if (allowed) expect(result?.start.getTime()).toBe(Date.parse(created));
    },
  );
});
