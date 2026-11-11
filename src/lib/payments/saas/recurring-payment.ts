import type { BillingAccount } from './contracts';

/** Charge evidence is not a provider due date, an access grant or settled funds. */
export interface RecurringPaymentEvidence {
  account: BillingAccount;
  subscriptionId: string;
  customerId: string;
  originCheckoutId: string;
  checkoutId: string;
  productId: string;
  paymentId: string;
  statementId: string;
  amountMinor: number;
  paidAmountMinor: number;
  currency: 'BRL';
  chargeCreatedAt: string;
  confirmedAt: string;
  method: 'card';
  recurrence: 'running' | 'stopped';
  obligation: 'paid';
  settlement: 'unknown';
  /** Read-only API paid-period metadata; never replaces the Qoro calendar. */
  providerPeriodStart?: string;
  providerPeriodEnd?: string;
}

export type RecurringPaymentRead =
  | { state: 'paid'; evidence: RecurringPaymentEvidence }
  | { state: 'pending' | 'review' };
