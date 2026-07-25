const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function buildWeeklyOccurrences(input: {
  firstScheduledAt: string;
  intervalWeeks: number;
  occurrences: number;
}): Date[] {
  const first = new Date(input.firstScheduledAt);
  if (Number.isNaN(first.getTime())) throw new Error('firstScheduledAt is invalid');
  if (!Number.isInteger(input.intervalWeeks) || input.intervalWeeks < 1) {
    throw new Error('intervalWeeks must be a positive integer');
  }
  if (!Number.isInteger(input.occurrences) || input.occurrences < 2) {
    throw new Error('occurrences must be an integer greater than one');
  }
  return Array.from(
    { length: input.occurrences },
    (_, index) => new Date(first.getTime() + index * input.intervalWeeks * WEEK_MS),
  );
}
