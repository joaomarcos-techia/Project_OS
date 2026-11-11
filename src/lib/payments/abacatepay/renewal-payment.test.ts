import { describe, expect, it } from 'vitest';

import { createAbacatePayRenewalPaymentReader } from './renewal-payment';

const account = {
  provider: 'abacatepay',
  environment: 'sandbox',
  accountId: 'store_fixture',
} as const;
const config = { apiKey: 'synthetic-renewal-reader-only', environment: 'sandbox' } as const;
const input = {
  subscriptionId: 'subs_fixture',
  customerId: 'cust_fixture',
  originCheckoutId: 'bill_origin',
  checkoutId: 'bill_cycle',
  paymentId: 'char_cycle',
  productId: 'prod_fixture',
  expectedAmountMinor: 39700,
  windowStart: '2026-12-09T00:31:10.888Z',
  windowEnd: '2027-01-09T00:31:10.888Z',
};
function statement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tran_cycle',
    currency: 'BRL',
    createdAt: '2026-12-09T00:31:11.888Z',
    checkoutId: 'bill_cycle',
    paymentIntentId: 'char_cycle',
    customer: {
      publicId: 'cust_fixture',
      email: 'do-not-retain@example.invalid',
      name: 'DO_NOT_RETAIN',
    },
    movements: [
      {
        amount: 39700,
        kind: 'CARD_APPROVED',
        method: 'CARD',
        category: 'transaction',
        balanceEffect: 'none',
      },
    ],
    ...overrides,
  };
}
type Options = {
  store?: string;
  product?: Record<string, unknown>;
  subscription?: Record<string, unknown>;
  checkout?: Record<string, unknown>;
  statements?: unknown[];
  extraSubscription?: boolean;
  statementStatus?: number;
  consumedOrigin?: boolean;
  deletedCheckout?: boolean;
};
function fixture(options: Options = {}) {
  const calls: URL[] = [];
  const subscription = {
    id: 'subs_fixture',
    checkoutId: 'bill_origin',
    customerId: 'cust_fixture',
    amount: 39700,
    currency: 'BRL',
    status: 'ACTIVE',
    method: 'CARD',
    devMode: true,
    trialEndsAt: null,
    createdAt: '2026-11-09T00:31:10.888Z',
    ...options.subscription,
  };
  const fetcher: typeof fetch = async (target, init) => {
    const url = new URL(target instanceof Request ? target.url : String(target));
    calls.push(url);
    expect(url.origin).toBe('https://api.abacatepay.com');
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('error');
    let body: unknown;
    switch (url.pathname) {
      case '/v2/stores/get':
        body = { success: true, data: { id: options.store ?? 'store_fixture' } };
        break;
      case '/v2/products/get':
        body = {
          success: true,
          data: {
            id: 'prod_fixture',
            externalId: 'monthly-fixture',
            price: 39700,
            currency: 'BRL',
            devMode: true,
            cycle: 'MONTHLY',
            trialDays: null,
            ...options.product,
          },
        };
        break;
      case '/v2/subscriptions/get':
        body = { success: true, data: subscription };
        break;
      case '/v2/subscriptions/list':
        expect(url.searchParams.get('checkoutId')).toBe('bill_origin');
        body = {
          success: true,
          data: options.extraSubscription
            ? [subscription, { ...subscription, id: 'subs_other' }]
            : [subscription],
          pagination: { hasMore: false, next: null },
        };
        break;
      case '/v2/subscriptions/checkouts/get':
        if (options.deletedCheckout) return new Response('{}', { status: 404 });
        expect(url.searchParams.get('id')).toBe(options.checkout?.id ?? 'bill_cycle');
        body = {
          success: true,
          data: {
            id: 'bill_cycle',
            frequency: 'SUBSCRIPTION',
            customerId: 'cust_fixture',
            amount: 39700,
            paidAmount: 39700,
            currency: 'BRL',
            status: 'PAID',
            createdAt: '2026-12-09T00:31:09.888Z',
            devMode: true,
            items: [{ id: 'prod_fixture', quantity: 1 }],
            ...options.checkout,
          },
        };
        break;
      case '/v2/bank-statement/list':
        expect(url.searchParams.get('kind')).toBe('CARD_APPROVED');
        expect(url.searchParams.get('status')).toBe('APPROVED');
        expect(url.searchParams.get('method')).toBe('CARD');
        if (options.statementStatus) return new Response('{}', { status: options.statementStatus });
        body = {
          success: true,
          data: options.statements ?? [statement()],
          pagination: { hasMore: false, next: null },
        };
        break;
      default:
        throw new Error('Unexpected endpoint in read-only renewal proof');
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return {
    calls,
    reader: createAbacatePayRenewalPaymentReader(
      account,
      config,
      fetcher,
      options.consumedOrigin
        ? {
            subscriptionId: input.subscriptionId,
            customerId: input.customerId,
            checkoutId: input.originCheckoutId,
          }
        : undefined,
    ),
  };
}

describe('renewal charge readback (no billing-period assertion or access grant)', () => {
  const discoveryInput = {
    subscriptionId: input.subscriptionId,
    customerId: input.customerId,
    originCheckoutId: input.originCheckoutId,
    productId: input.productId,
    expectedAmountMinor: input.expectedAmountMinor,
  };
  function recoveryFixture(overrides: Options = {}) {
    return fixture({
      subscription: { currentPeriodStart: '2026-12-09', currentPeriodEnd: '2027-01-09' },
      checkout: { id: 'bill_origin', createdAt: '2026-11-09T00:31:00Z' },
      statements: [statement({ checkoutId: 'bill_origin' })],
      ...overrides,
    });
  }
  it('discovers an exact new payment by GET without inventing a webhook or charge', async () => {
    const { reader, calls } = recoveryFixture();
    expect(await reader.discoverRenewalPayment(discoveryInput)).toMatchObject({
      state: 'paid',
      evidence: {
        paymentId: 'char_cycle',
        statementId: 'tran_cycle',
        providerPeriodStart: '2026-12-09',
      },
    });
    expect(calls.some((url) => url.pathname === '/v2/bank-statement/list')).toBe(true);
  });
  it('recovers an exact renewal after the consumed original checkout is no longer queryable', async () => {
    const { reader, calls } = recoveryFixture({
      consumedOrigin: true,
      deletedCheckout: true,
      subscription: { currentPeriodStart: '2026-12-09', currentPeriodEnd: '2027-01-09' },
      statements: [statement({ checkoutId: 'bill_origin' })],
    });
    expect(await reader.discoverRenewalPayment(discoveryInput)).toMatchObject({
      state: 'paid',
      evidence: { paymentId: 'char_cycle', paidAmountMinor: 39700 },
    });
    expect(calls.some((url) => url.pathname === '/v2/subscriptions/checkouts/get')).toBe(false);
  });
  it('does not use a consumed-origin proof to bypass a different cycle checkout', async () => {
    const { reader } = fixture({ consumedOrigin: true, deletedCheckout: true });
    await expect(reader.readRenewalPayment(input)).rejects.toMatchObject({ code: 'not_found' });
  });
  it.each([
    [
      statement({ checkoutId: 'bill_origin' }),
      statement({ id: 'tran_second', paymentIntentId: 'char_second', checkoutId: 'bill_origin' }),
    ],
    [statement({ checkoutId: 'bill_origin', customer: null })],
    [statement({ checkoutId: 'bill_origin', customer: { publicId: 'cust_other' } })],
    [
      statement({
        checkoutId: 'bill_origin',
        movements: [
          {
            kind: 'CARD_APPROVED',
            amount: 39699,
            method: 'CARD',
            category: 'transaction',
            balanceEffect: 'none',
          },
        ],
      }),
    ],
  ])('refuses ambiguous or unbound receipt discovery %j', async (...statements) => {
    const { reader } = recoveryFixture({ statements });
    await expect(reader.discoverRenewalPayment(discoveryInput)).rejects.toMatchObject({
      code: 'binding_mismatch',
    });
  });
  it('does not turn an absent payment into confirmation', async () => {
    expect(
      await recoveryFixture({ statements: [] }).reader.discoverRenewalPayment(discoveryInput),
    ).toEqual({ state: 'pending' });
  });
  it('requires a provider paid-period snapshot for discovery', async () => {
    expect(
      await recoveryFixture({ subscription: {} }).reader.discoverRenewalPayment(discoveryInput),
    ).toEqual({ state: 'review' });
  });
  it('accepts the current original-checkout contract only with a new API paid period and exact new card receipt', async () => {
    const { reader } = fixture({
      subscription: { currentPeriodStart: '2026-12-09', currentPeriodEnd: '2027-01-09' },
      checkout: { id: 'bill_origin', createdAt: '2026-11-09T00:31:00Z' },
      statements: [statement({ checkoutId: 'bill_origin' })],
    });
    const result = await reader.readRenewalPayment({ ...input, checkoutId: 'bill_origin' });
    expect(result).toMatchObject({
      state: 'paid',
      evidence: {
        providerPeriodStart: '2026-12-09',
        providerPeriodEnd: '2027-01-09',
        chargeCreatedAt: '2026-12-09T00:31:11.888Z',
      },
    });
  });
  it.each([
    {},
    { currentPeriodStart: '2026-11-09', currentPeriodEnd: '2026-12-09' },
    { currentPeriodStart: '2027-01-09', currentPeriodEnd: '2027-02-09' },
  ])(
    'does not reuse the initial receipt or guess an absent/contradictory paid period %j',
    async (subscription) => {
      const { reader } = fixture({
        subscription,
        checkout: { id: 'bill_origin' },
        statements: [statement({ checkoutId: 'bill_origin' })],
      });
      expect(await reader.readRenewalPayment({ ...input, checkoutId: 'bill_origin' })).toEqual({
        state: 'review',
      });
    },
  );
  it.each([39700, 54400, 69100, 83800])(
    'requires matching product, subscription, checkout and card receipt for %i cents',
    async (amountMinor) => {
      const options: Options = {
        product: { price: amountMinor },
        subscription: { amount: amountMinor },
        checkout: { amount: amountMinor, paidAmount: amountMinor },
        statements: [
          statement({
            movements: [
              {
                amount: amountMinor,
                kind: 'CARD_APPROVED',
                method: 'CARD',
                category: 'transaction',
                balanceEffect: 'none',
              },
            ],
          }),
        ],
      };
      const expected = { ...input, expectedAmountMinor: amountMinor };
      const { reader } = fixture(options);
      expect(await reader.readRenewalPayment(expected)).toMatchObject({
        state: 'paid',
        evidence: { amountMinor, paidAmountMinor: amountMinor },
      });
      const partial = fixture({
        ...options,
        checkout: { amount: amountMinor, paidAmount: amountMinor - 1 },
      });
      expect(await partial.reader.readRenewalPayment(expected)).toEqual({ state: 'review' });
    },
  );
  it('REN-001 separates the original subscription checkout from the cycle checkout and exact payment', async () => {
    const { reader, calls } = fixture();
    const result = await reader.readRenewalPayment(input);
    expect(result).toEqual({
      state: 'paid',
      evidence: {
        account,
        subscriptionId: 'subs_fixture',
        customerId: 'cust_fixture',
        originCheckoutId: 'bill_origin',
        checkoutId: 'bill_cycle',
        productId: 'prod_fixture',
        paymentId: 'char_cycle',
        statementId: 'tran_cycle',
        amountMinor: 39700,
        paidAmountMinor: 39700,
        currency: 'BRL',
        chargeCreatedAt: '2026-12-09T00:31:09.888Z',
        confirmedAt: '2026-12-09T00:31:11.888Z',
        method: 'card',
        recurrence: 'running',
        obligation: 'paid',
        settlement: 'unknown',
      },
    });
    expect(calls).toHaveLength(6);
    expect(JSON.stringify(result)).not.toContain('DO_NOT_RETAIN');
    expect(JSON.stringify(result)).not.toContain('email');
    expect(result).not.toHaveProperty('periodEnd');
    expect(result).not.toHaveProperty('nextDueDate');
    expect(result).not.toHaveProperty('entitlements');
  });
  it('REN-002/012/020 repeated and concurrent reads preserve charge identity without commands', async () => {
    const { reader, calls } = fixture();
    const results = await Promise.all([
      reader.readRenewalPayment(input),
      reader.readRenewalPayment(input),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(calls).toHaveLength(12);
  });
  it('REN-003/004 a delayed read does not turn receipt time into a new paid period', async () => {
    const { reader } = fixture();
    const result = await reader.readRenewalPayment(input);
    expect(result.state).toBe('paid');
    if (result.state !== 'paid') throw new Error('Expected verified charge');
    expect(result.evidence.confirmedAt).toBe('2026-12-09T00:31:11.888Z');
    expect(result.evidence).not.toHaveProperty('periodStart');
  });
  it.each([
    { subscriptionId: 'unknown' },
    { paymentId: '' },
    { expectedAmountMinor: 0 },
    { expectedAmountMinor: 0.5 },
    { windowEnd: input.windowStart },
    { windowStart: 'invalid' },
    { windowEnd: '2027-02-09T00:31:10.888Z' },
  ])('REN-005 invalid IDs/window/amount fail before network: %j', async (overrides) => {
    const { reader, calls } = fixture();
    await expect(reader.readRenewalPayment({ ...input, ...overrides })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(calls).toHaveLength(0);
  });
  it.each([
    { store: 'store_other' },
    { subscription: { customerId: 'cust_other' } },
    { subscription: { checkoutId: 'bill_other' } },
    { checkout: { customerId: 'cust_other' } },
    { checkout: { id: 'bill_other' } },
    { checkout: { devMode: false } },
    { product: { devMode: false } },
    { subscription: { devMode: false } },
    { statements: [statement({ customer: { publicId: 'cust_other' } })] },
    { extraSubscription: true },
  ])(
    'REN-006 account/customer/resource/environment mismatches never produce paid: %j',
    async (options) => {
      await expect(fixture(options).reader.readRenewalPayment(input)).rejects.toThrow();
    },
  );
  it('REN-007 rejects an account belonging to another gateway or environment', () => {
    expect(() =>
      createAbacatePayRenewalPaymentReader({ ...account, provider: 'asaas' }, config),
    ).toThrow();
    expect(() =>
      createAbacatePayRenewalPaymentReader({ ...account, environment: 'production' }, config),
    ).toThrow();
  });
  it('REN-008 retains financial evidence after cancellation without treating it as running', async () => {
    const result = await fixture({
      subscription: { status: 'CANCELLED' },
    }).reader.readRenewalPayment(input);
    expect(result).toMatchObject({
      state: 'paid',
      evidence: { recurrence: 'stopped', settlement: 'unknown' },
    });
    expect(result).not.toHaveProperty('access');
  });
  it('REN-009 pending charge does not become approved from subscription ACTIVE', async () => {
    const { reader, calls } = fixture({ checkout: { status: 'PENDING', paidAmount: null } });
    expect(await reader.readRenewalPayment(input)).toEqual({ state: 'pending' });
    expect(calls.some((url) => url.pathname.includes('bank-statement'))).toBe(false);
  });
  it('REN-010 a later successful read preserves the same charge instead of creating another', async () => {
    expect(await fixture({ statements: [] }).reader.readRenewalPayment(input)).toEqual({
      state: 'pending',
    });
    expect(await fixture().reader.readRenewalPayment(input)).toMatchObject({
      state: 'paid',
      evidence: { paymentId: input.paymentId },
    });
  });
  it('REN-011 provider failure is not a declined charge or a paid result', async () => {
    const { reader, calls } = fixture({ statementStatus: 503 });
    await expect(reader.readRenewalPayment(input)).rejects.toMatchObject({ code: 'unavailable' });
    expect(calls.filter((url) => url.pathname.includes('bank-statement'))).toHaveLength(1);
  });
  it('REN-013/014/015 offset representations preserve the receipt around day/year boundaries', async () => {
    const { reader } = fixture({ statements: [statement({ createdAt: '2027-01-01T00:00:00Z' })] });
    const result = await reader.readRenewalPayment({
      ...input,
      windowStart: '2026-12-31T20:59:00-03:00',
      windowEnd: '2027-01-31T20:59:00-03:00',
    });
    expect(result).toMatchObject({
      state: 'paid',
      evidence: { confirmedAt: '2027-01-01T00:00:00Z' },
    });
  });
  it('REN-016 new annual subscriptions are explicitly outside this monthly reader', async () => {
    await expect(
      fixture({ product: { cycle: 'ANNUALLY' } }).reader.readRenewalPayment(input),
    ).rejects.toMatchObject({ code: 'binding_mismatch' });
  });
  it.each([
    { product: { price: 54400 } },
    { subscription: { amount: 54400 } },
    { checkout: { amount: 54400 } },
    { checkout: { items: [{ id: 'prod_extra', quantity: 1 }] } },
    { checkout: { items: [{ id: 'prod_fixture', quantity: 2 }] } },
    { subscription: { method: 'PIX' } },
    { subscription: { trialEndsAt: input.windowEnd } },
  ])(
    'REN-017 price/product/method/trial changes require review, never infer new quota: %j',
    async (options) => {
      await expect(fixture(options).reader.readRenewalPayment(input)).rejects.toMatchObject({
        code: 'binding_mismatch',
      });
    },
  );
  it.each([{ paidAmount: 39000 }, { paidAmount: 0, status: 'REDEEMED' }, { status: 'REFUNDED' }])(
    'partial/zero/refunded payment is not a renewal grant: %j',
    async (checkout) => {
      expect(await fixture({ checkout }).reader.readRenewalPayment(input)).toEqual({
        state: 'review',
      });
    },
  );
  it('REN-018 only returns financial evidence for the supplied window, never extends an expired period', async () => {
    expect(
      await fixture({
        statements: [statement({ createdAt: input.windowEnd })],
      }).reader.readRenewalPayment(input),
    ).toEqual({ state: 'pending' });
  });
  it('REN-019 absent cycle references cannot be reconstructed by same customer and amount', async () => {
    const { reader, calls } = fixture();
    await expect(reader.readRenewalPayment({ ...input, checkoutId: '' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(calls).toHaveLength(0);
  });
  it('does not reuse the original payment or another payment in the same window', async () => {
    const { reader } = fixture({
      statements: [
        statement({ checkoutId: 'bill_origin' }),
        statement({ id: 'tran_other', paymentIntentId: 'char_other' }),
      ],
    });
    expect(await reader.readRenewalPayment(input)).toEqual({ state: 'pending' });
  });
  it('ambiguous multiple approvals are reviewed without choosing one arbitrarily', async () => {
    const { reader } = fixture({ statements: [statement(), statement({ id: 'tran_duplicate' })] });
    await expect(reader.readRenewalPayment(input)).rejects.toMatchObject({
      code: 'binding_mismatch',
    });
  });
  it('does not sum fees/net to manufacture a full gross payment', async () => {
    const { reader } = fixture({
      statements: [
        statement({
          movements: [
            {
              amount: 38000,
              kind: 'CARD_APPROVED',
              method: 'CARD',
              category: 'transaction',
              balanceEffect: 'none',
            },
            { amount: 1700, kind: 'FEE', method: 'CARD', category: 'fee', balanceEffect: 'debit' },
          ],
        }),
      ],
    });
    await expect(reader.readRenewalPayment(input)).rejects.toMatchObject({
      code: 'binding_mismatch',
    });
  });
});
