import { describe, expect, it } from 'vitest';

import { __internal } from './reminder-candidates';

describe('reminder candidate timestamp boundary', () => {
  it('keeps Date values as canonical ISO', () => {
    expect(__internal.scheduledAtIso(new Date('2026-08-30T12:34:56.789Z'))).toBe(
      '2026-08-30T12:34:56.789Z',
    );
  });

  it('normalizes PostgreSQL timestamptz text before enqueueing C14', () => {
    expect(__internal.scheduledAtIso('2026-08-30 12:34:56+00')).toBe('2026-08-30T12:34:56.000Z');
  });

  it('fails observably instead of publishing an invalid payload', () => {
    expect(() => __internal.scheduledAtIso('not-a-timestamp')).toThrow(/invalid scheduled_at/u);
  });
});
