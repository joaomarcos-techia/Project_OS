import type { BillingAccount } from './contracts';

/** Observations only: no payment, entitlement, refund or cancellation command. */
export interface CheckoutRecurrenceObservation {
  account: BillingAccount;
  checkoutId: string;
  expectedSubscriptionId: string | null;
  issue:
    | 'multiple_subscriptions'
    | 'subscription_mismatch'
    | 'missing_subscription'
    | 'native_trial'
    | null;
  recurrence: 'running' | 'stopped' | 'unknown' | 'unbound';
  observedSubscriptionIds: string[];
  complete: boolean;
  providerPaidPeriod?: { start: string; end: string };
}

export interface CheckoutRecurrenceInput {
  checkoutId: string;
  subscriptionId: string | null;
  customerId: string | null;
}
