import { addCalendarMonths } from './billing-period';

/** Qoro access period; never a statement of the provider's next charge date. */
export function initialAbacatePayAccessPeriod(input: {
  subscriptionCreatedAt: string | null;
  trialEndsAt: Date;
  /** Initial conversion may start at Auth creation; recontract keeps its paid-end boundary. */
  notBefore?: Date;
  now: Date;
}): { start: Date; end: Date } | null {
  if (!input.subscriptionCreatedAt) return null;
  const start = new Date(input.subscriptionCreatedAt);
  const now = input.now.getTime(),
    trialEnd = input.trialEndsAt.getTime(),
    notBefore = (input.notBefore ?? input.trialEndsAt).getTime();
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(now) ||
    !Number.isFinite(trialEnd) ||
    !Number.isFinite(notBefore) ||
    start.getTime() < notBefore ||
    start.getTime() > now
  )
    return null;
  const iso = start.toISOString();
  const end = new Date(`${addCalendarMonths(iso.slice(0, 10), 1)}${iso.slice(10)}`);
  // A delayed initial event cannot substitute for a new renewal payment.
  return end.getTime() > now ? { start, end } : null;
}
