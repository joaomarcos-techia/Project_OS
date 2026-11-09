import { addCalendarMonths } from './billing-period';

const CYCLE_CREATION_SKEW_MS = 60_000;
const MAX_CYCLE_INDEX = 1200;

/** Approved Qoro anniversary calendar, never inferred provider next-due-date. */
export function abacatePayRenewalPeriod(input: {
  anchorStart: Date;
  chargeCreatedAt: string;
  confirmedAt: string;
  now: Date;
}): { index: number; start: Date; end: Date } | null {
  const anchor = input.anchorStart.getTime(),
    charge = Date.parse(input.chargeCreatedAt),
    confirmed = Date.parse(input.confirmedAt),
    now = input.now.getTime();
  if (
    ![anchor, charge, confirmed, now].every(Number.isFinite) ||
    charge > now ||
    confirmed > now ||
    confirmed < charge - CYCLE_CREATION_SKEW_MS
  )
    return null;
  const iso = input.anchorStart.toISOString();
  const created = new Date(charge);
  const months =
    (created.getUTCFullYear() - input.anchorStart.getUTCFullYear()) * 12 +
    created.getUTCMonth() -
    input.anchorStart.getUTCMonth();
  const matches: { index: number; start: Date; end: Date }[] = [];
  for (const index of [months - 1, months, months + 1]) {
    if (index < 1 || index > MAX_CYCLE_INDEX) continue;
    const start = new Date(`${addCalendarMonths(iso.slice(0, 10), index)}${iso.slice(10)}`);
    if (Math.abs(charge - start.getTime()) > CYCLE_CREATION_SKEW_MS) continue;
    const end = new Date(`${addCalendarMonths(iso.slice(0, 10), index + 1)}${iso.slice(10)}`);
    matches.push({ index, start, end });
  }
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
