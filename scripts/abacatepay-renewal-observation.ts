/** Read-only observation, never an entitlement decision or proof of settlement. */
import { z } from 'zod';

const instant = z.iso.datetime({ offset: true });
export const renewalObservationSchema = z.object({
  now: instant,
  initialPeriodEnd: instant,
  localPeriodEnd: instant,
  localStatus: z.enum(['trial', 'active', 'past_due', 'cancelled']),
  initialPaymentConsistent: z.boolean(),
  closureConfirmed: z.boolean(),
  cycles: z
    .array(
      z.object({
        paymentId: z.string().min(1),
        invoiceId: z.uuid(),
        periodEnd: instant,
        consistent: z.boolean(),
        accessEffect: z.enum(['advanced', 'historical', 'review']),
      }),
    )
    .max(1200),
  remote: z.object({
    devMode: z.literal(true),
    status: z.string().min(1),
    nextChargeAt: z.iso.date().nullable(),
    bindingMatches: z.boolean(),
  }),
});

export function summarizeRenewalObservation(raw: unknown) {
  const value = renewalObservationSchema.parse(raw);
  const paymentIds = new Set(value.cycles.map((cycle) => cycle.paymentId));
  const invoiceIds = new Set(value.cycles.map((cycle) => cycle.invoiceId));
  const advanced = value.cycles.filter((cycle) => cycle.accessEffect === 'advanced');
  const latestEnd = Math.max(
    Date.parse(value.initialPeriodEnd),
    ...advanced.map((cycle) => Date.parse(cycle.periodEnd)),
  );
  const consistent =
    value.initialPaymentConsistent &&
    value.remote.bindingMatches &&
    (value.localStatus === 'active' ||
      value.localStatus === 'past_due' ||
      (value.localStatus === 'cancelled' && value.remote.status === 'CANCELLED')) &&
    paymentIds.size === value.cycles.length &&
    invoiceIds.size === value.cycles.length &&
    value.cycles.every((cycle) => cycle.consistent && cycle.accessEffect !== 'review') &&
    latestEnd === Date.parse(value.localPeriodEnd);
  const state = !consistent
    ? 'review_required'
    : advanced.length > 0
      ? 'renewal_recorded_requires_external_review'
      : value.remote.status === 'CANCELLED'
        ? 'recurrence_stopped'
        : value.remote.status !== 'ACTIVE'
          ? 'review_required'
          : Date.parse(value.now) >= Date.parse(value.localPeriodEnd)
            ? 'due_unobserved'
            : 'awaiting_next_cycle';
  return {
    observationStatus: consistent && state !== 'review_required' ? 'PASS' : 'PARTIAL',
    state,
    providerStatus: value.remote.status,
    officialNextChargeDate: value.remote.nextChargeAt,
    qoroPaidPeriodEnd: value.localPeriodEnd,
    nextChargeDateInferred: false,
    closureConfirmed: value.closureConfirmed,
    recordedCycles: value.cycles.length,
    // An ACTIVE status, elapsed date or local receipt is not a temporal test.
    externalTemporalRenewal: 'PARTIAL',
    accessEffect: 'none',
    providerMutations: 0,
    databaseWrites: 0,
  } as const;
}
