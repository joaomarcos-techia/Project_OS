import { describe, expect, it } from 'vitest';

import { initialAbacatePayAccessPeriod as period } from './abacatepay-period';

const trialEndsAt = new Date('2026-01-01T12:30:00.000Z');
describe('Qoro monthly access anchored to verified subscription creation', () => {
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
});
