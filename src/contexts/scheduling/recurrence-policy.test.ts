import { describe, expect, it } from 'vitest';

import { buildWeeklyOccurrences } from './recurrence-policy';

const actions = readFileSync(resolve(process.cwd(), 'src/contexts/scheduling/actions.ts'), 'utf8');
const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0063_waitlist_recurrence.sql'),
  'utf8',
);
const drawer = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/agenda/new-appointment-drawer.tsx'),
  'utf8',
);

describe('weekly recurrence', () => {
  it('builds deterministic weekly instants and keeps the first occurrence', () => {
    expect(
      buildWeeklyOccurrences({
        firstScheduledAt: '2026-07-30T13:00:00.000Z',
        intervalWeeks: 2,
        occurrences: 4,
      }).map((date) => date.toISOString()),
    ).toEqual([
      '2026-07-30T13:00:00.000Z',
      '2026-08-13T13:00:00.000Z',
      '2026-08-27T13:00:00.000Z',
      '2026-09-10T13:00:00.000Z',
    ]);
  });

  it('rejects invalid recurrence values', () => {
    expect(() =>
      buildWeeklyOccurrences({
        firstScheduledAt: 'invalid',
        intervalWeeks: 1,
        occurrences: 4,
      }),
    ).toThrow();
    expect(() =>
      buildWeeklyOccurrences({
        firstScheduledAt: '2026-07-30T13:00:00.000Z',
        intervalWeeks: 0,
        occurrences: 4,
      }),
    ).toThrow();
    expect(() =>
      buildWeeklyOccurrences({
        firstScheduledAt: '2026-07-30T13:00:00.000Z',
        intervalWeeks: 1,
        occurrences: 1,
      }),
    ).toThrow();
  });

  it('creates every occurrence atomically and supports cancelling future occurrences', () => {
    expect(actions).toContain('insertScheduledAppointment(tx');
    expect(actions).toContain('cancelRecurringSeries');
    expect(actions).toContain("target: 'cancelado'");
    expect(migration).toContain('appointments_recurrence_occurrence_uniq');
    expect(migration).toContain('appointment recurrence mismatch');
    expect(drawer).toContain('Repetir semanalmente');
    expect(drawer).toContain('recurrence: { intervalWeeks: interval, occurrences: count }');
  });
});
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
