import { describe, expect, it, vi } from 'vitest';

import { createAbacatePaySubscriptionReader } from '../abacatepay/reader';
import { BillingProviderError } from '../asaas';
import { createAsaasSubscriptionReader } from './asaas-reader';
import { billingResourceKey, GatewayReadError } from './contracts';

const asaasAccount = {
  provider: 'asaas',
  environment: 'sandbox',
  accountId: 'account_test',
} as const;
const abacateAccount = {
  provider: 'abacatepay',
  environment: 'sandbox',
  accountId: 'store_test',
} as const;
const input = { subscriptionId: 'subs_test', customerId: 'cust_test' };
const asaasSubscription = {
  subscriptionId: 'subs_test',
  customerId: 'cust_test',
  status: 'ACTIVE',
  value: 397.29,
  externalReference: 'contract_test',
  cycle: 'MONTHLY',
  nextDueDate: '2026-12-07',
  billingType: 'CREDIT_CARD',
};
const abacateSubscription = {
  id: 'subs_test',
  customerId: 'cust_test',
  checkoutId: 'bill_test',
  status: 'ACTIVE',
  amount: 39729,
  method: 'CARD',
  devMode: true,
  trialEndsAt: null,
  frequency: 'MONTHLY',
};

function asaasHarness(overrides: Record<string, unknown> = {}) {
  const getSubscription = vi.fn().mockResolvedValue({ ...asaasSubscription, ...overrides });
  return {
    reader: createAsaasSubscriptionReader(asaasAccount, { getSubscription }),
    getSubscription,
  };
}
function abacateHarness(overrides: Record<string, unknown> = {}, storeId = 'store_test') {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ success: true, data: { id: storeId } }))
    .mockResolvedValueOnce(
      Response.json({ success: true, data: { ...abacateSubscription, ...overrides } }),
    );
  return {
    reader: createAbacatePaySubscriptionReader(
      abacateAccount,
      { apiKey: 'fixture-key', environment: 'sandbox' },
      fetcher,
    ),
    fetcher,
  };
}

describe.each([
  { provider: 'asaas', harness: () => asaasHarness() },
  { provider: 'abacatepay', harness: () => abacateHarness() },
])('shared SaaS read contract: $provider', ({ provider, harness }) => {
  it('returns minor units and recurrence without granting access or declaring settlement', async () => {
    const snapshot = await harness().reader.readSubscription(input);
    expect(snapshot).toMatchObject({
      account: { provider, environment: 'sandbox' },
      subscriptionId: 'subs_test',
      customerId: 'cust_test',
      amountMinor: 39729,
      currency: 'BRL',
      recurrence: 'running',
      cycle: 'monthly',
      method: 'card',
    });
    expect(snapshot).not.toHaveProperty('paid');
    expect(snapshot).not.toHaveProperty('access');
    expect(snapshot).not.toHaveProperty('settled');
  });
  it('rejects a customer that differs from the persisted binding', async () => {
    await expect(
      harness().reader.readSubscription({ ...input, customerId: 'cust_other' }),
    ).rejects.toMatchObject({ code: 'binding_mismatch' });
  });
  it('rejects unsafe input before requesting a resource', async () => {
    await expect(
      harness().reader.readSubscription({ ...input, subscriptionId: '../other?token=x' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });
  it('does not expose mutable account metadata', () => {
    expect(Object.isFrozen(harness().reader.account)).toBe(true);
  });
});

describe('Asaas compatibility seam', () => {
  it.each([0.01, 0.29, 1.15, 197, 544, 838, 9999999999.99])(
    'preserves exact cents: %s',
    async (value) => {
      const snapshot = await asaasHarness({ value }).reader.readSubscription(input);
      expect(snapshot.amountMinor).toBe(Math.round(value * 100));
    },
  );
  it.each([-1, NaN, Infinity, 1.001, 1.999, 10000000000])(
    'refuses invalid money: %s',
    async (value) => {
      await expect(asaasHarness({ value }).reader.readSubscription(input)).rejects.toBeInstanceOf(
        GatewayReadError,
      );
    },
  );
  it.each(['INACTIVE', 'EXPIRED'])('keeps %s stopped', async (status) => {
    expect((await asaasHarness({ status }).reader.readSubscription(input)).recurrence).toBe(
      'stopped',
    );
  });
  it('preserves unknown proprietary statuses without granting benefits', async () => {
    const snapshot = await asaasHarness({
      status: 'FUTURE_STATUS',
      cycle: 'WEEKLY',
      billingType: 'NEW_METHOD',
    }).reader.readSubscription(input);
    expect(snapshot).toMatchObject({
      recurrence: 'unknown',
      rawStatus: 'FUTURE_STATUS',
      cycle: 'unknown',
      rawCycle: 'WEEKLY',
      method: 'unknown',
      rawMethod: 'NEW_METHOD',
    });
  });
  it('refuses an identifier mismatch', async () => {
    await expect(
      asaasHarness({ subscriptionId: 'subs_other' }).reader.readSubscription(input),
    ).rejects.toMatchObject({ code: 'binding_mismatch' });
  });
  it('sanitizes upstream exceptions', async () => {
    const harness = asaasHarness();
    harness.getSubscription.mockRejectedValue(new Error('fixture-secret must never escape'));
    const error: unknown = await harness.reader
      .readSubscription(input)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: 'unavailable',
      message: 'SaaS billing gateway: unavailable',
    });
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toContain('fixture-secret');
  });
  it('keeps a definite 404 distinct from an outage', async () => {
    const harness = asaasHarness();
    harness.getSubscription.mockRejectedValue(
      new BillingProviderError('fixture-private', 'not_found', 404),
    );
    await expect(harness.reader.readSubscription(input)).rejects.toMatchObject({
      code: 'not_found',
      httpStatus: 404,
    });
  });
  it('rejects a binding for another adapter', () => {
    expect(() =>
      createAsaasSubscriptionReader(abacateAccount, { getSubscription: vi.fn() }),
    ).toThrow(GatewayReadError);
  });
});

describe('AbacatePay canonical read semantics', () => {
  it('never infers the next charge date from ACTIVE or createdAt', async () => {
    expect(
      await abacateHarness({
        createdAt: '2026-11-07T12:00:00Z',
        frequency: undefined,
      }).reader.readSubscription(input),
    ).toMatchObject({ nextChargeDate: null, cycle: 'unknown' });
  });
  it('does not reset the domain trial from the provider trial', async () => {
    const snapshot = await abacateHarness({
      trialEndsAt: '2026-11-21T12:00:00Z',
    }).reader.readSubscription(input);
    expect(snapshot.trialEndsAt).toBe('2026-11-21T12:00:00Z');
    expect(snapshot).not.toHaveProperty('accessUntil');
  });
  it('checks the store before fetching the subscription', async () => {
    const harness = abacateHarness({}, 'store_wrong');
    await expect(harness.reader.readSubscription(input)).rejects.toMatchObject({
      code: 'binding_mismatch',
    });
    expect(harness.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['CANCELLED', 'stopped'],
    ['PENDING', 'pending'],
    ['NEW_STATUS', 'unknown'],
  ])('maps %s as %s', async (status, recurrence) => {
    expect((await abacateHarness({ status }).reader.readSubscription(input)).recurrence).toBe(
      recurrence,
    );
  });
  it('refuses an account/environment mismatch at construction', () => {
    expect(() =>
      createAbacatePaySubscriptionReader(abacateAccount, {
        apiKey: 'fixture-key',
        environment: 'production',
      }),
    ).toThrow(GatewayReadError);
  });
});

describe('external identifier namespace', () => {
  it('isolates provider, account, environment and resource type', () => {
    const keys = [
      billingResourceKey(asaasAccount, 'subscription', 'same_id'),
      billingResourceKey(abacateAccount, 'subscription', 'same_id'),
      billingResourceKey(
        { ...asaasAccount, accountId: 'account_other' },
        'subscription',
        'same_id',
      ),
      billingResourceKey({ ...asaasAccount, environment: 'production' }, 'subscription', 'same_id'),
      billingResourceKey(asaasAccount, 'payment', 'same_id'),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('refuses malformed identifiers', () => {
    expect(() => billingResourceKey(asaasAccount, 'event', 'not/an/id')).toThrow(GatewayReadError);
  });
});
