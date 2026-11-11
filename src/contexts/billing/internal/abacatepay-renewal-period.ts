import { addCalendarMonths } from './billing-period';

const CYCLE_CREATION_SKEW_MS = 60_000;
const MAX_CYCLE_INDEX = 1200;

/** Approved Qoro anniversary calendar, never inferred provider next-due-date. */
export function abacatePayRenewalPeriod(input: {
  anchorStart: Date;
  chargeCreatedAt: string;
  confirmedAt: string;
  now: Date;
  providerPeriodStart?: string;
  providerPeriodEnd?: string;
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
    const end = new Date(`${addCalendarMonths(iso.slice(0, 10), index + 1)}${iso.slice(10)}`);
    if (input.providerPeriodStart !== undefined || input.providerPeriodEnd !== undefined) {
      if (
        input.providerPeriodStart !== start.toISOString().slice(0, 10) ||
        input.providerPeriodEnd !== end.toISOString().slice(0, 10)
      )
        continue;
      const chargeDay = new Date(charge).toISOString().slice(0, 10),
        confirmedDay = new Date(confirmed).toISOString().slice(0, 10);
      if (
        chargeDay < input.providerPeriodStart ||
        chargeDay >= input.providerPeriodEnd ||
        confirmedDay >= input.providerPeriodEnd
      )
        continue;
    } else if (Math.abs(charge - start.getTime()) > CYCLE_CREATION_SKEW_MS) continue;
    matches.push({ index, start, end });
  }
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
