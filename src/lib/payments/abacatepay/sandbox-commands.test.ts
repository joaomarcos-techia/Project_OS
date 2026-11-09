import { describe, expect, it, vi } from 'vitest';

import { TestCommandJournal } from '../../test/command-journal';
import { createAbacatePaySandboxCommands } from './sandbox-commands';

const operationId = '7c719853-d7e5-4302-b3ef-295559a8f8c7';
const productInput = {
  operationId,
  externalId: 'fixture-product',
  name: 'TESTE Qoro',
  amountMinor: 100,
  cycle: 'MONTHLY' as const,
  trialDays: 14,
};
const checkoutInput = {
  operationId,
  externalId: 'fixture-checkout',
  productId: 'prod_created',
  expectedAmountMinor: 100,
  expectedCycle: 'MONTHLY' as const,
  expectedNativeTrialDays: 14,
};
const subscriptionInput = { operationId, subscriptionId: 'subs_test', customerId: 'cust_test' };

function setup() {
  const scenario: {
    storeId: string;
    devMode: boolean;
    price: number;
    trialDays: number | null;
    subscriptionStatus: string;
    subscriptionCustomer: string;
    subscriptionCycle: string | undefined;
    checkoutProduct: string;
    checkoutAmount: number;
    checkoutUrl: string;
    checkoutReference: string;
    changeStatus: string;
    cancellationPersists: boolean;
    postFailure: boolean;
    originPaid: boolean;
  } = {
    storeId: 'store_test',
    devMode: true,
    price: 100,
    trialDays: 14,
    subscriptionStatus: 'ACTIVE',
    subscriptionCustomer: 'cust_test',
    subscriptionCycle: 'MONTHLY',
    checkoutProduct: 'prod_created',
    checkoutAmount: 100,
    checkoutUrl: 'https://app.abacatepay.com/pay/bill_test',
    checkoutReference: 'fixture-checkout',
    changeStatus: 'PENDING',
    cancellationPersists: true,
    postFailure: false,
    originPaid: false,
  };
  const journal = new TestCommandJournal();
  const fetcher = vi.fn<typeof fetch>(async (target, options) => {
    const url = new URL(String(target));
    const envelope = (data: unknown) => Response.json({ success: true, data });
    if (options?.method === 'POST') {
      if (scenario.postFailure) throw new Error('private fixture-key');
      if (url.pathname.endsWith('/products/create')) return envelope({ id: 'prod_created' });
      if (url.pathname.endsWith('/subscriptions/create')) return envelope({ id: 'bill_test' });
      if (url.pathname.endsWith('/change-plan'))
        return envelope({
          id: 'subu_test',
          subscriptionId: 'subs_test',
          productId: 'prod_created',
          quantity: 1,
          status: scenario.changeStatus,
          newAmount: scenario.price,
        });
      if (url.pathname.endsWith('/cancel')) {
        if (scenario.cancellationPersists) scenario.subscriptionStatus = 'CANCELLED';
        return envelope({
          id: 'subs_test',
          customerId: 'cust_test',
          status: 'CANCELLED',
          devMode: true,
        });
      }
    }
    if (url.pathname.endsWith('/stores/get')) return envelope({ id: scenario.storeId });
    if (url.pathname.endsWith('/products/get'))
      return envelope({
        id: url.searchParams.get('id'),
        externalId: 'fixture-product',
        price: scenario.price,
        currency: 'BRL',
        devMode: scenario.devMode,
        cycle: 'MONTHLY',
        trialDays: scenario.trialDays,
      });
    if (url.pathname.endsWith('/subscriptions/checkouts/get'))
      return envelope({
        id: 'bill_test',
        frequency: 'SUBSCRIPTION',
        externalId: scenario.checkoutReference,
        amount: scenario.checkoutAmount,
        devMode: scenario.devMode,
        status: scenario.originPaid ? 'PAID' : 'PENDING',
        paidAmount: scenario.originPaid ? scenario.checkoutAmount : null,
        customerId: scenario.originPaid ? scenario.subscriptionCustomer : null,
        url: scenario.checkoutUrl,
        items: [{ id: scenario.checkoutProduct, quantity: 1 }],
      });
    if (url.pathname.endsWith('/subscriptions/get'))
      return envelope({
        id: 'subs_test',
        checkoutId: 'bill_test',
        customerId: scenario.subscriptionCustomer,
        amount: 19700,
        status: scenario.subscriptionStatus,
        method: 'CARD',
        devMode: true,
        trialEndsAt: null,
        ...(scenario.subscriptionCycle === undefined
          ? {}
          : { frequency: scenario.subscriptionCycle }),
      });
    throw new Error('Unexpected fixture request');
  });
  const client = createAbacatePaySandboxCommands(
    { apiKey: 'fixture-key', storeId: 'store_test', probeProductId: 'prod_probe' },
    journal,
    fetcher,
  );
  const posts = () => fetcher.mock.calls.filter((call) => call[1]?.method === 'POST');
  return { scenario, journal, fetcher, client, posts };
}

describe('AbacatePay commands isolated to Sandbox', () => {
  it('creates and reads back the product, replaying without a second POST', async () => {
    const { client, posts, fetcher } = setup();
    await expect(client.createProduct(productInput)).resolves.toMatchObject({
      id: 'prod_created',
      externalId: 'fixture-product',
      devMode: true,
      price: 100,
      cycle: 'MONTHLY',
      trialDays: 14,
    });
    const result = await client.createProduct(productInput);
    expect(result.id).toBe('prod_created');
    expect(posts()).toHaveLength(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.abacatepay.com/v2/stores/get');
    expect(posts()[0]?.[1]?.body).toBe(
      JSON.stringify({
        externalId: 'fixture-product',
        name: 'TESTE Qoro',
        price: 100,
        currency: 'BRL',
        cycle: 'MONTHLY',
        trialDays: 14,
      }),
    );
  });
  it('omits native trialDays for the Qoro-owned trial policy', async () => {
    const { client, scenario, posts } = setup();
    scenario.trialDays = null;
    const { trialDays: _trialDays, ...withoutTrial } = productInput;
    await client.createProduct(withoutTrial);
    expect(posts()[0]?.[1]?.body).not.toContain('trialDays');
  });
  it.each(['wrong_account', 'production_resource'])(
    'refuses %s before any POST',
    async (condition) => {
      const { client, scenario, posts } = setup();
      if (condition === 'wrong_account') scenario.storeId = 'store_other';
      else scenario.devMode = false;
      await expect(client.createProduct(productInput)).rejects.toMatchObject({
        code: 'operation_unknown',
      });
      expect(posts()).toHaveLength(0);
    },
  );
  it.each([0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER])(
    'refuses invalid price %s before network access',
    async (amountMinor) => {
      const { client, fetcher } = setup();
      await expect(client.createProduct({ ...productInput, amountMinor })).rejects.toMatchObject({
        code: 'invalid_input',
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it('refuses unknown input fields rather than forwarding them upstream', async () => {
    const { client, fetcher } = setup();
    const raw = { ...productInput, arbitraryCredential: 'private' };
    await expect(client.createProduct(raw)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps a successful-but-divergent creation unknown and never retries it', async () => {
    const { client, scenario, posts } = setup();
    scenario.price = 101;
    await expect(client.createProduct(productInput)).rejects.toMatchObject({
      code: 'operation_unknown',
    });
    await expect(client.createProduct(productInput)).rejects.toMatchObject({
      code: 'operation_unknown',
    });
    expect(posts()).toHaveLength(1);
  });
  it('creates a single CARD checkout without customer PII, callbacks, coupons or an access grant', async () => {
    const { client, posts } = setup();
    const result = await client.createSubscriptionCheckout(checkoutInput);
    expect(result).toMatchObject({
      checkoutId: 'bill_test',
      state: 'pending',
      environment: 'sandbox',
      amountMinor: 100,
    });
    expect(result).not.toHaveProperty('subscriptionId');
    expect(result).not.toHaveProperty('paid');
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(String(posts()[0]?.[1]?.body))).toEqual({
      items: [{ id: 'prod_created', quantity: 1 }],
      methods: ['CARD'],
      externalId: 'fixture-checkout',
      metadata: { qoroSandboxReference: 'fixture-checkout' },
      retryPolicy: { maxRetry: 3, retryEvery: 1 },
    });
    await client.createSubscriptionCheckout(checkoutInput);
    expect(posts()).toHaveLength(1);
  });
  it('accepts a zero checkout amount only when a native test trial was explicitly expected', async () => {
    const { client, scenario } = setup();
    scenario.checkoutAmount = 0;
    await expect(client.createSubscriptionCheckout(checkoutInput)).resolves.toMatchObject({
      amountMinor: 0,
      state: 'pending',
    });
    const second = setup();
    second.scenario.trialDays = null;
    second.scenario.checkoutAmount = 0;
    await expect(
      second.client.createSubscriptionCheckout({ ...checkoutInput, expectedNativeTrialDays: null }),
    ).rejects.toMatchObject({ code: 'operation_unknown' });
  });
  it.each(['product', 'reference', 'url', 'amount'])(
    'does not confirm a checkout with divergent %s',
    async (field) => {
      const { client, scenario, posts } = setup();
      if (field === 'product') scenario.checkoutProduct = 'prod_other';
      if (field === 'reference') scenario.checkoutReference = 'other-reference';
      if (field === 'url') scenario.checkoutUrl = 'https://attacker.example/pay';
      if (field === 'amount') scenario.checkoutAmount = 101;
      await expect(client.createSubscriptionCheckout(checkoutInput)).rejects.toMatchObject({
        code: 'operation_unknown',
      });
      expect(posts()).toHaveLength(1);
    },
  );
  it('does not create a checkout for a price/product configuration mismatch', async () => {
    const { client, scenario, posts } = setup();
    scenario.trialDays = null;
    await expect(client.createSubscriptionCheckout(checkoutInput)).rejects.toMatchObject({
      code: 'operation_unknown',
    });
    expect(posts()).toHaveLength(0);
  });
  it('never retries a command after a timeout/connection failure', async () => {
    const { client, scenario, posts } = setup();
    scenario.postFailure = true;
    await expect(client.createProduct(productInput)).rejects.toMatchObject({
      code: 'operation_unknown',
    });
    scenario.postFailure = false;
    await expect(client.createProduct(productInput)).rejects.toMatchObject({
      code: 'operation_unknown',
    });
    expect(posts()).toHaveLength(1);
  });
  it('returns plan change PENDING for the next cycle, without claiming price/quota were applied', async () => {
    const { client, scenario, posts } = setup();
    scenario.trialDays = null;
    const result = await client.requestPlanChange({
      ...subscriptionInput,
      productId: 'prod_created',
      expectedAmountMinor: 100,
      expectedCycle: 'MONTHLY',
    });
    expect(result).toEqual({
      changeId: 'subu_test',
      subscriptionId: 'subs_test',
      productId: 'prod_created',
      amountMinor: 100,
      state: 'pending',
      effective: 'next_cycle',
    });
    expect(result).not.toHaveProperty('access');
    expect(result).not.toHaveProperty('applied');
    expect(posts()).toHaveLength(1);
  });
  it.each(['unknown_cycle', 'wrong_customer', 'different_cycle', 'native_trial'])(
    'refuses a plan change without verifiable preconditions: %s',
    async (condition) => {
      const { client, scenario, posts } = setup();
      scenario.trialDays = condition === 'native_trial' ? 14 : null;
      if (condition === 'unknown_cycle') scenario.subscriptionCycle = undefined;
      if (condition === 'different_cycle') scenario.subscriptionCycle = 'ANNUALLY';
      if (condition === 'wrong_customer') scenario.subscriptionCustomer = 'cust_other';
      await expect(
        client.requestPlanChange({
          ...subscriptionInput,
          productId: 'prod_created',
          expectedAmountMinor: 100,
          expectedCycle: 'MONTHLY',
        }),
      ).rejects.toMatchObject({ code: 'operation_unknown' });
      expect(posts()).toHaveLength(0);
    },
  );
  it('proves an omitted frequency through the paid original product rather than assuming MONTHLY', async () => {
    const { client, scenario, posts } = setup();
    scenario.trialDays = null;
    scenario.subscriptionCycle = undefined;
    scenario.originPaid = true;
    await expect(
      client.requestPlanChange({
        ...subscriptionInput,
        productId: 'prod_created',
        expectedAmountMinor: 100,
        expectedCycle: 'MONTHLY',
      }),
    ).resolves.toMatchObject({ state: 'pending', effective: 'next_cycle' });
    expect(posts()).toHaveLength(1);
  });
  it('confirms cancellation by GET without revoking local paid access', async () => {
    const { client, posts } = setup();
    expect(await client.cancelSubscription(subscriptionInput)).toEqual({
      subscriptionId: 'subs_test',
      customerId: 'cust_test',
      recurrence: 'stopped',
    });
    expect(posts()).toHaveLength(1);
    await client.cancelSubscription(subscriptionInput);
    expect(posts()).toHaveLength(1);
  });
  it('does not send another cancellation for an already cancelled subscription', async () => {
    const { client, scenario, posts } = setup();
    scenario.subscriptionStatus = 'CANCELLED';
    await client.cancelSubscription(subscriptionInput);
    expect(posts()).toHaveLength(0);
  });
  it('rejects a cancellation response not confirmed by authoritative readback', async () => {
    const { client, scenario, posts } = setup();
    scenario.cancellationPersists = false;
    await expect(client.cancelSubscription(subscriptionInput)).rejects.toMatchObject({
      code: 'operation_unknown',
    });
    expect(posts()).toHaveLength(1);
  });
  it('does not cancel a subscription owned by a different customer', async () => {
    const { client, scenario, posts } = setup();
    scenario.subscriptionCustomer = 'cust_other';
    await expect(client.cancelSubscription(subscriptionInput)).rejects.toMatchObject({
      code: 'operation_unknown',
    });
    expect(posts()).toHaveLength(0);
  });
});
