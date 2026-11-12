import { describe, expect, it, vi } from 'vitest';

import { TestCommandJournal } from '../../test/command-journal';
import { createAbacatePayCommands, createAbacatePaySandboxCommands } from './sandbox-commands';

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

function setup(consumedOrigin = false, environment: 'sandbox' | 'production' = 'sandbox') {
  const scenario: {
    storeId: string;
    devMode: boolean;
    price: number;
    trialDays: number | null;
    subscriptionStatus: string;
    subscriptionAmount: number;
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
    closed: boolean;
    extraSubscription: boolean;
  } = {
    storeId: 'store_test',
    devMode: true,
    price: 100,
    trialDays: 14,
    subscriptionStatus: 'ACTIVE',
    subscriptionAmount: 19700,
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
    closed: false,
    extraSubscription: false,
  };
  const journal = new TestCommandJournal();
  const fetcher = vi.fn<typeof fetch>(async (target, options) => {
    const url = new URL(String(target));
    const envelope = (data: unknown) => Response.json({ success: true, data });
    if (options?.method === 'POST') {
      if (scenario.postFailure) throw new Error('private fixture-key');
      if (url.pathname.endsWith('/products/create')) return envelope({ id: 'prod_created' });
      if (url.pathname.endsWith('/subscriptions/create')) return envelope({ id: 'bill_test' });
      if (url.pathname.endsWith('/subscriptions/checkouts/delete')) {
        expect(url.searchParams.get('id')).toBe('bill_test');
        scenario.closed = true;
        return envelope({ id: 'bill_test', devMode: scenario.devMode });
      }
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
          devMode: scenario.devMode,
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
    if (url.pathname.endsWith('/subscriptions/checkouts/get')) {
      if (scenario.closed) return new Response('{}', { status: 404 });
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
    }
    if (url.pathname.endsWith('/subscriptions/list'))
      return Response.json({
        success: true,
        data: [
          {
            id: 'subs_test',
            customerId: 'cust_test',
            checkoutId: 'bill_test',
            amount: scenario.subscriptionAmount,
            status: scenario.subscriptionStatus,
            method: 'CARD',
            devMode: scenario.devMode,
            trialEndsAt: null,
          },
          ...(scenario.extraSubscription
            ? [
                {
                  id: 'subs_extra',
                  customerId: 'cust_extra',
                  checkoutId: 'bill_test',
                  amount: 19700,
                  status: 'ACTIVE',
                  method: 'CARD',
                  devMode: scenario.devMode,
                  trialEndsAt: null,
                },
              ]
            : []),
        ],
        pagination: { hasMore: false, next: null },
      });
    if (url.pathname.endsWith('/subscriptions/get'))
      return envelope({
        id: 'subs_test',
        checkoutId: 'bill_test',
        customerId: scenario.subscriptionCustomer,
        amount: scenario.subscriptionAmount,
        status: scenario.subscriptionStatus,
        method: 'CARD',
        devMode: scenario.devMode,
        trialEndsAt: null,
        ...(scenario.subscriptionCycle === undefined
          ? {}
          : { frequency: scenario.subscriptionCycle }),
      });
    throw new Error('Unexpected fixture request');
  });
  scenario.devMode = environment === 'sandbox';
  const client = createAbacatePayCommands(
    { apiKey: 'fixture-key', storeId: 'store_test', probeProductId: 'prod_probe', environment },
    journal,
    fetcher,
    consumedOrigin
      ? {
          subscriptionId: 'subs_test',
          customerId: 'cust_test',
          checkoutId: 'bill_test',
          productId: 'prod_created',
        }
      : undefined,
  );
  const posts = () => fetcher.mock.calls.filter((call) => call[1]?.method === 'POST');
  return { scenario, journal, fetcher, client, posts };
}

describe('explicit live commands with synthetic transport only', () => {
  it('creates one journaled live checkout with false devMode and no Sandbox metadata', async () => {
    const { client, scenario, posts } = setup(false, 'production');
    scenario.trialDays = null;
    const input = { ...checkoutInput, expectedNativeTrialDays: null };
    await expect(client.createSubscriptionCheckout(input)).resolves.toMatchObject({
      environment: 'production',
      state: 'pending',
    });
    await client.createSubscriptionCheckout(input);
    expect(posts()).toHaveLength(1);
    const body: unknown = JSON.parse(String(posts()[0]?.[1]?.body));
    expect(body).toMatchObject({
      metadata: { qoroReference: input.externalId },
      methods: ['CARD'],
    });
    expect(body).not.toHaveProperty('metadata.qoroSandboxReference');
  });
  it('refuses a Sandbox product before any live mutation', async () => {
    const { client, scenario, posts } = setup(false, 'production');
    scenario.devMode = true;
    await expect(client.createSubscriptionCheckout(checkoutInput)).rejects.toThrow();
    expect(posts()).toHaveLength(0);
  });
  it('cancels a live recurrence once after confirmed mode readbacks', async () => {
    const { client, posts } = setup(false, 'production');
    await expect(client.cancelSubscription(subscriptionInput)).resolves.toMatchObject({
      recurrence: 'stopped',
    });
    await client.cancelSubscription(subscriptionInput);
    expect(posts()).toHaveLength(1);
  });
  it('keeps the Sandbox compatibility factory unable to consume live resources', async () => {
    const f = setup(false, 'production');
    const client = createAbacatePaySandboxCommands(
      { apiKey: 'fixture-key', storeId: 'store_test', probeProductId: 'prod_probe' },
      f.journal,
      f.fetcher,
    );
    await expect(client.cancelSubscription(subscriptionInput)).rejects.toThrow();
    expect(f.posts()).toHaveLength(0);
  });
});

describe('AbacatePay commands isolated to Sandbox', () => {
  const closeInput = {
    ...subscriptionInput,
    checkoutId: 'bill_test',
    productId: 'prod_created',
    expectedAmountMinor: 19700,
  };
  it('closes a paid link once while preserving the subscription and immutable journal result', async () => {
    const { client, scenario, posts } = setup();
    scenario.originPaid = true;
    scenario.checkoutAmount = 19700;
    expect(await client.closePaidCheckout(closeInput)).toMatchObject({
      closed: true,
      checkoutId: 'bill_test',
      amountMinor: 19700,
    });
    expect(scenario.subscriptionStatus).toBe('ACTIVE');
    await client.closePaidCheckout(closeInput);
    expect(posts()).toHaveLength(1);
  });
  it('preserves a subscription whose current plan differs from the consumed original price', async () => {
    const { client, scenario } = setup();
    scenario.originPaid = true;
    scenario.checkoutAmount = 19700;
    scenario.subscriptionAmount = 54400;
    await expect(client.closePaidCheckout(closeInput)).resolves.toMatchObject({
      closed: true,
      amountMinor: 19700,
    });
    expect(scenario.subscriptionAmount).toBe(54400);
  });
  it.each(['pending', 'multiple', 'customer', 'amount', 'live'] as const)(
    'refuses unsafe closure: %s',
    async (mode) => {
      const { client, scenario, posts } = setup();
      scenario.originPaid = mode !== 'pending';
      scenario.checkoutAmount = 19700;
      if (mode === 'multiple') scenario.extraSubscription = true;
      if (mode === 'customer') scenario.subscriptionCustomer = 'cust_other';
      if (mode === 'amount') scenario.checkoutAmount = 19699;
      if (mode === 'live') scenario.devMode = false;
      await expect(client.closePaidCheckout(closeInput)).rejects.toMatchObject({
        code: 'operation_unknown',
      });
      expect(posts()).toHaveLength(0);
    },
  );
  it('keeps a timed-out closure unknown and never repeats its POST', async () => {
    const { client, scenario, posts } = setup();
    scenario.originPaid = true;
    scenario.checkoutAmount = 19700;
    scenario.postFailure = true;
    await expect(client.closePaidCheckout(closeInput)).rejects.toMatchObject({
      code: 'operation_unknown',
    });
    scenario.postFailure = false;
    await expect(client.closePaidCheckout(closeInput)).rejects.toMatchObject({
      code: 'operation_unknown',
    });
    expect(posts()).toHaveLength(1);
  });
  it('can prove the monthly origin from the consumed snapshot when the original link no longer exists', async () => {
    const { client, scenario, posts, fetcher } = setup(true);
    scenario.closed = true;
    scenario.trialDays = null;
    scenario.subscriptionCycle = undefined;
    await expect(
      client.requestPlanChange({
        ...subscriptionInput,
        productId: 'prod_created',
        expectedAmountMinor: 100,
        expectedCycle: 'MONTHLY',
      }),
    ).resolves.toMatchObject({ state: 'pending' });
    expect(posts()).toHaveLength(1);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/checkouts/get'))).toBe(false);
  });
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
