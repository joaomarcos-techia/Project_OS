import { describe, it, expect } from 'vitest';
import {
  abacatePayRenewalProofHash,
  parseAbacatePayRenewalSource,
} from './abacatepay-renewal-source';
import type { RecurringPaymentEvidence } from '@/lib/payments/saas/recurring-payment';

const evidence: RecurringPaymentEvidence = {
  account: { provider: 'abacatepay', environment: 'sandbox', accountId: 'store_synthetic' },
  subscriptionId: 'subs_synthetic',
  customerId: 'cust_synthetic',
  originCheckoutId: 'bill_synthetic',
  checkoutId: 'bill_synthetic',
  productId: 'prod_synthetic',
  paymentId: 'char_synthetic',
  statementId: 'tran_synthetic',
  amountMinor: 39700,
  paidAmountMinor: 39700,
  currency: 'BRL',
  chargeCreatedAt: '2026-11-11T10:00:00Z',
  confirmedAt: '2026-11-11T10:00:00Z',
  method: 'card',
  recurrence: 'running',
  obligation: 'paid',
  settlement: 'unknown',
  providerPeriodStart: '2026-11-11',
  providerPeriodEnd: '2026-12-11',
};
describe('renewal provenance is distinct from webhook identity', () => {
  it('preserves real webhook IDs while requiring a UUID for an API readback', () => {
    expect(parseAbacatePayRenewalSource('log_synthetic')).toEqual({
      kind: 'webhook',
      id: 'log_synthetic',
    });
    expect(parseAbacatePayRenewalSource({ kind: 'provider_api', id: 'log_synthetic' })).toBeNull();
    expect(
      parseAbacatePayRenewalSource({
        kind: 'provider_api',
        id: '2fa56cd3-e89c-4e5c-af1a-0f1d3214372e',
      })?.kind,
    ).toBe('provider_api');
    expect(parseAbacatePayRenewalSource('')).toBeNull();
  });
  it('hashes a canonical tuple rather than object property insertion order', () => {
    expect(abacatePayRenewalProofHash({ ...evidence, account: { ...evidence.account } })).toBe(
      abacatePayRenewalProofHash(evidence),
    );
    expect(abacatePayRenewalProofHash(evidence)).toMatch(/^[a-f0-9]{64}$/);
  });
  it('treats equivalent provider timestamp formats as the same immutable proof', () => {
    expect(
      abacatePayRenewalProofHash({
        ...evidence,
        confirmedAt: '2026-11-11T07:00:00-03:00',
        chargeCreatedAt: '2026-11-11T10:00:00.000+00:00',
      }),
    ).toBe(abacatePayRenewalProofHash(evidence));
  });
  it.each([
    { amountMinor: 54400 },
    { paidAmountMinor: 54400 },
    { paymentId: 'char_other' },
    { statementId: 'tran_other' },
    { subscriptionId: 'subs_other' },
    { customerId: 'cust_other' },
    { originCheckoutId: 'bill_other' },
    { productId: 'prod_other' },
    { providerPeriodEnd: '2027-01-11' },
    { confirmedAt: '2026-11-11T10:00:01Z' },
    { account: { ...evidence.account, accountId: 'store_other' } },
  ])('binds every financial and ownership field: %j', (patch) => {
    expect(abacatePayRenewalProofHash({ ...evidence, ...patch })).not.toBe(
      abacatePayRenewalProofHash(evidence),
    );
  });
});
