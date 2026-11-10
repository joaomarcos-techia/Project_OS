import { describe, expect, it, vi } from 'vitest';

import { createAbacatePayInitialPaymentReader } from './initial-payment';

const account = {
  provider: 'abacatepay',
  environment: 'sandbox',
  accountId: 'store_test',
} as const;
const input = {
  subscriptionId: 'subs_test',
  customerId: 'cust_test',
  checkoutId: 'bill_test',
  productId: 'prod_test',
  expectedAmountMinor: 19700,
};
function setup(amountMinor = 19700) {
  const subscription = {
    id: 'subs_test',
    customerId: 'cust_test',
    checkoutId: 'bill_test',
    amount: amountMinor,
    status: 'ACTIVE',
    method: 'CARD',
    devMode: true,
    trialEndsAt: null as string | null,
  };
  const checkout = {
    id: 'bill_test',
    customerId: 'cust_test',
    amount: amountMinor,
    frequency: 'SUBSCRIPTION',
    status: 'PAID',
    paidAmount: amountMinor as number | null,
    devMode: true,
    currency: 'BRL',
    items: [{ id: 'prod_test', quantity: 1 }],
  };
  const subscriptions = [subscription];
  const store = { id: 'store_test' };
  const fetcher = vi.fn<typeof fetch>(async (target) => {
    const url = new URL(String(target));
    let data: unknown;
    if (url.pathname.endsWith('/stores/get')) data = store;
    else if (url.pathname.endsWith('/subscriptions/get')) data = subscription;
    else if (url.pathname.endsWith('/subscriptions/checkouts/get')) data = checkout;
    else if (url.pathname.endsWith('/subscriptions/list'))
      return Response.json({
        success: true,
        data: subscriptions,
        pagination: { hasMore: false, next: null },
      });
    else throw new Error('Unexpected unit request');
    return Response.json({ success: true, data });
  });
  return {
    subscription,
    checkout,
    subscriptions,
    store,
    fetcher,
    reader: createAbacatePayInitialPaymentReader(
      account,
      { apiKey: 'fixture-key', environment: 'sandbox' },
      fetcher,
    ),
  };
}

describe('authoritative initial subscription payment evidence', () => {
  it.each([19700, 39700, 54400, 69100, 83800])(
    'verifies an exact approved monthly amount of %i cents instead of hardcoding the entry plan',
    async (amountMinor) => {
      const { reader, checkout } = setup(amountMinor);
      const expected = { ...input, expectedAmountMinor: amountMinor };
      expect(await reader.readInitialPayment(expected)).toMatchObject({
        state: 'paid',
        amountMinor,
        paidAmountMinor: amountMinor,
      });
      checkout.paidAmount = amountMinor - 1;
      await expect(reader.readInitialPayment(expected)).rejects.toMatchObject({
        code: 'invalid_response',
      });
    },
  );
  it('verifies store, subscription, customer, bill, product, quantity and paid amount', async () => {
    const { reader, fetcher } = setup();
    const result = await reader.readInitialPayment(input);
    expect(result).toMatchObject({
      state: 'paid',
      amountMinor: 19700,
      paidAmountMinor: 19700,
      settlement: 'unknown',
      subscriptionId: 'subs_test',
      customerId: 'cust_test',
      checkoutId: 'bill_test',
    });
    expect(result).not.toHaveProperty('access');
    expect(result).not.toHaveProperty('periodEnd');
    expect(result).not.toHaveProperty('availableBalance');
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.every((call) => call[1]?.method === 'GET')).toBe(true);
  });
  it('does not confuse ACTIVE with payment received', async () => {
    const { reader, checkout } = setup();
    checkout.status = 'PENDING';
    checkout.paidAmount = null;
    expect(await reader.readInitialPayment(input)).toMatchObject({
      state: 'pending',
      paidAmountMinor: null,
    });
  });
  it.each([null, 0, 19699, 19701])(
    'does not accept PAID with mismatching paidAmount %s',
    async (paidAmount) => {
      const { reader, checkout } = setup();
      checkout.paidAmount = paidAmount;
      await expect(reader.readInitialPayment(input)).rejects.toMatchObject({
        code: 'invalid_response',
      });
    },
  );
  it.each([
    ['REFUNDED', 'refunded'],
    ['EXPIRED', 'expired'],
    ['CANCELLED', 'cancelled'],
    ['NEW_STATE', 'unknown'],
    ['REDEEMED', 'unknown'],
  ])('preserves checkout state %s as %s without granting access', async (raw, state) => {
    const { reader, checkout } = setup();
    checkout.status = raw;
    expect(await reader.readInitialPayment(input)).toMatchObject({ rawStatus: raw, state });
  });
  it('does not let an old paid checkout reactivate a cancelled subscription', async () => {
    const { reader, subscription } = setup();
    subscription.status = 'CANCELLED';
    const result = await reader.readInitialPayment(input);
    expect(result.state).toBe('paid'); // Historical financial fact, not an access transition.
    expect(result).not.toHaveProperty('subscriptionStatus');
    expect(result).not.toHaveProperty('access');
  });
  it.each([
    'store',
    'subscription_customer',
    'bill_customer',
    'bill_link',
    'product',
    'quantity',
    'price',
    'currency',
    'environment',
  ])('rejects divergent %s binding', async (field) => {
    const { reader, subscription, checkout, store } = setup();
    if (field === 'store') store.id = 'store_other';
    if (field === 'subscription_customer') subscription.customerId = 'cust_other';
    if (field === 'bill_customer') checkout.customerId = 'cust_other';
    if (field === 'bill_link') subscription.checkoutId = 'bill_other';
    if (field === 'product') checkout.items = [{ id: 'prod_other', quantity: 1 }];
    if (field === 'quantity') checkout.items = [{ id: 'prod_test', quantity: 2 }];
    if (field === 'price') checkout.amount = 19600;
    if (field === 'currency') checkout.currency = 'USD';
    if (field === 'environment') checkout.devMode = false;
    await expect(reader.readInitialPayment(input)).rejects.toThrow();
  });
  it('does not accept two subscriptions for the same checkout and customer', async () => {
    const { reader, subscriptions, subscription } = setup();
    subscriptions.push({ ...subscription, id: 'subs_duplicate' });
    await expect(reader.readInitialPayment(input)).rejects.toMatchObject({
      code: 'binding_mismatch',
    });
  });
  it('does not accept a second subscription from another customer sharing the dedicated checkout', async () => {
    const { reader, subscriptions, subscription } = setup();
    subscriptions.push({ ...subscription, id: 'subs_other', customerId: 'cust_other' });
    await expect(reader.readInitialPayment(input)).rejects.toMatchObject({
      code: 'binding_mismatch',
    });
  });
  it('does not associate a different subscription just because the customer/checkout match', async () => {
    const { reader, subscriptions, subscription } = setup();
    subscriptions.splice(0, 1, { ...subscription, id: 'subs_other' });
    await expect(reader.readInitialPayment(input)).rejects.toMatchObject({
      code: 'binding_mismatch',
    });
  });
  it('excludes native trials from the post-trial payment path', async () => {
    const { reader, subscription } = setup();
    subscription.trialEndsAt = '2026-11-22T00:00:00Z';
    await expect(reader.readInitialPayment(input)).rejects.toMatchObject({
      code: 'binding_mismatch',
    });
  });
  it('rejects unsafe IDs before network access', async () => {
    const { reader, fetcher } = setup();
    await expect(
      reader.readInitialPayment({ ...input, checkoutId: '../other?secret=fixture' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
