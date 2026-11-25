import { describe, expect, it, vi } from 'vitest';

import { GatewayReadError } from '../saas/contracts';
import { createAbacatePayReadClient } from './reader';

const product = {
  id: 'prod_test',
  externalId: 'qoro-test',
  price: 19700,
  currency: 'BRL',
  devMode: true,
  cycle: 'MONTHLY',
  trialDays: null,
};
const subscription = {
  id: 'subs_test',
  checkoutId: 'bill_test',
  customerId: 'cust_test',
  amount: 19700,
  status: 'ACTIVE',
  method: 'CARD',
  devMode: true,
  trialEndsAt: null,
};
const checkout = {
  id: 'bill_test',
  frequency: 'SUBSCRIPTION',
  customerId: 'cust_test',
  amount: 19700,
  status: 'PENDING',
  devMode: true,
};
function envelope(data: unknown) {
  return Response.json({ success: true, data, error: null });
}
function page(data: unknown[], hasMore = false, next: string | null = null) {
  return Response.json({ success: true, data, pagination: { hasMore, next, before: null } });
}
function setup() {
  const fetcher = vi.fn<typeof fetch>();
  return {
    fetcher,
    client: createAbacatePayReadClient({ apiKey: 'fixture-key', environment: 'sandbox' }, fetcher),
  };
}

describe('AbacatePay V2 read transport', () => {
  it('reads provider paid-period dates as metadata without claiming a payment', async () => {
    const { fetcher, client } = setup();
    fetcher.mockResolvedValue(
      envelope({
        ...subscription,
        currentPeriodStart: '2026-11-11',
        currentPeriodEnd: '2026-12-11',
        nextChargeAt: '2026-12-11',
      }),
    );
    await expect(client.readSubscription('subs_test')).resolves.toMatchObject({
      currentPeriodStart: '2026-11-11',
      currentPeriodEnd: '2026-12-11',
      nextChargeAt: '2026-12-11',
    });
  });
  it.each(['not-a-date', '2026-02-30', '2026-11-11T00:00:00Z'])(
    'rejects an invalid provider date %s',
    async (nextChargeAt) => {
      const { fetcher, client } = setup();
      fetcher.mockResolvedValue(envelope({ ...subscription, nextChargeAt }));
      await expect(client.readSubscription('subs_test')).rejects.toMatchObject({
        code: 'invalid_response',
      });
    },
  );
  it('uses only the official V2 HTTPS origin, Bearer, no-store and an explicit deadline', async () => {
    const { fetcher, client } = setup();
    fetcher.mockResolvedValue(envelope(product));
    await expect(client.readProduct('prod_test')).resolves.toEqual(product);
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.abacatepay.com/v2/products/get?id=prod_test',
      {
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        headers: { Authorization: 'Bearer fixture-key', Accept: 'application/json' },
        signal: expect.any(AbortSignal),
      },
    );
  });
  it.each(['', ' key', 'key\nvalue'])(
    'refuses unsafe credentials before network access: %j',
    (apiKey) => {
      expect(() => createAbacatePayReadClient({ apiKey, environment: 'sandbox' })).toThrow(
        GatewayReadError,
      );
    },
  );
  it.each([0, -1, 60001, NaN, 1.5])('refuses an invalid timeout: %s', (timeoutMs) => {
    expect(() =>
      createAbacatePayReadClient({ apiKey: 'fixture-key', environment: 'sandbox', timeoutMs }),
    ).toThrow(GatewayReadError);
  });
  it('captures configuration, preventing later credential/environment mutation', async () => {
    const config = { apiKey: 'fixture-key', environment: 'sandbox' as const };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(envelope(product));
    const client = createAbacatePayReadClient(config, fetcher);
    config.apiKey = 'different-key';
    await client.readProduct('prod_test');
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({
      Authorization: 'Bearer fixture-key',
      Accept: 'application/json',
    });
  });
  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
    [422, 'invalid_response'],
  ])('classifies HTTP %s without exposing the response or retrying', async (status, code) => {
    const { fetcher, client } = setup();
    fetcher.mockResolvedValue(
      new Response('fixture secret and personal data', { status: Number(status) }),
    );
    await expect(client.readStore()).rejects.toMatchObject({ code, httpStatus: status });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not retain upstream exception messages or causes', async () => {
    const { fetcher, client } = setup();
    fetcher.mockRejectedValue(new Error('credential fixture-key, customer private@example.test'));
    const error: unknown = await client.readStore().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ message: 'SaaS billing gateway: unavailable' });
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toContain('fixture-key');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed JSON', async () => {
    const { fetcher, client } = setup();
    fetcher.mockResolvedValue(new Response('<html>fixture</html>'));
    await expect(client.readStore()).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('does not confuse HTTP 200 with success=true', async () => {
    const { fetcher, client } = setup();
    fetcher.mockResolvedValue(
      Response.json({ success: false, error: 'fixture-private', data: null }),
    );
    await expect(client.readStore()).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('limits the actual response bytes even with no Content-Length', async () => {
    const { fetcher, client } = setup();
    const cancel = vi.fn();
    fetcher.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(1_048_577));
          },
          cancel,
        }),
      ),
    );
    await expect(client.readStore()).rejects.toMatchObject({ code: 'invalid_response' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('sanitizes a body-stream failure', async () => {
    const { fetcher, client } = setup();
    fetcher.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error('fixture-private'));
          },
        }),
      ),
    );
    await expect(client.readStore()).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('readback and environment validation', () => {
  it.each(['../prod_test', 'https://other.test/id', 'bill_test'])(
    'refuses invalid product identity: %s',
    async (id) => {
      const { fetcher, client } = setup();
      await expect(client.readProduct(id)).rejects.toMatchObject({ code: 'invalid_input' });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each([false, undefined])('refuses wrong or missing devMode: %s', async (devMode) => {
    const { fetcher, client } = setup();
    fetcher.mockResolvedValue(envelope({ ...product, devMode }));
    await expect(client.readProduct('prod_test')).rejects.toBeInstanceOf(GatewayReadError);
  });
  it.each([-1, 1.1, Number.MAX_SAFE_INTEGER + 1, '19700', null])(
    'refuses invalid minor units: %s',
    async (price) => {
      const { fetcher, client } = setup();
      fetcher.mockResolvedValue(envelope({ ...product, price }));
      await expect(client.readProduct('prod_test')).rejects.toMatchObject({
        code: 'invalid_response',
      });
    },
  );
  it('refuses a foreign currency', async () => {
    const { fetcher, client } = setup();
    fetcher.mockResolvedValue(envelope({ ...subscription, currency: 'USD' }));
    await expect(client.readSubscription('subs_test')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
  it('refuses a checkout denominated in a foreign currency', async () => {
    const { fetcher, client } = setup();
    fetcher.mockResolvedValue(envelope({ ...checkout, currency: 'USD' }));
    await expect(client.readSubscriptionCheckout('bill_test')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
  it('rejects an ID mismatch instead of accepting another resource', async () => {
    const { fetcher, client } = setup();
    fetcher.mockResolvedValue(envelope({ ...product, id: 'prod_other' }));
    await expect(client.readProduct('prod_test')).rejects.toMatchObject({
      code: 'binding_mismatch',
    });
  });
  it('separates the subscription-checkout endpoint from a generic checkout', async () => {
    const { fetcher, client } = setup();
    fetcher.mockResolvedValue(envelope(checkout));
    await expect(client.readSubscriptionCheckout('bill_test')).resolves.toEqual(checkout);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.abacatepay.com/v2/subscriptions/checkouts/get?id=bill_test',
    );
  });
  it('refuses an ordinary payment checkout masquerading as a subscription', async () => {
    const { fetcher, client } = setup();
    fetcher.mockResolvedValue(envelope({ ...checkout, frequency: 'ONE_TIME' }));
    await expect(client.readSubscriptionCheckout('bill_test')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
  it('returns no authentication or financial data when reading store identity', async () => {
    const { fetcher, client } = setup();
    fetcher.mockResolvedValue(
      envelope({ id: 'store_test', name: 'fixture-private', balance: { available: 999 } }),
    );
    await expect(client.readStore()).resolves.toEqual({ id: 'store_test' });
  });
  it('accepts new response fields without retaining them', async () => {
    const { fetcher, client } = setup();
    fetcher.mockResolvedValue(envelope({ ...product, newField: 'ignored' }));
    expect(await client.readProduct('prod_test')).not.toHaveProperty('newField');
  });
});

describe('cursor reconciliation preparation', () => {
  it('reads all pages with the provider cursor, not offset guesses', async () => {
    const { fetcher, client } = setup();
    fetcher
      .mockResolvedValueOnce(page([product], true, 'prod_next'))
      .mockResolvedValueOnce(page([{ ...product, id: 'prod_next' }]));
    expect(await client.listProducts()).toHaveLength(2);
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      'https://api.abacatepay.com/v2/products/list?limit=100&after=prod_next',
    );
  });
  it('refuses a repeated cursor without silently returning a truncated list', async () => {
    const { fetcher, client } = setup();
    fetcher.mockImplementation(async () => page([product], true, 'prod_next'));
    await expect(client.listProducts()).rejects.toMatchObject({ code: 'pagination_invalid' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('requires pagination metadata instead of assuming a single page', async () => {
    const { fetcher, client } = setup();
    fetcher.mockResolvedValue(envelope([]));
    await expect(client.listProducts()).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('does not treat an empty catalog as proof of sandbox', async () => {
    const { fetcher, client } = setup();
    fetcher.mockResolvedValue(page([]));
    expect(await client.listProducts()).toEqual([]);
  });
  it('checks every resource environment across pages', async () => {
    const { fetcher, client } = setup();
    fetcher
      .mockResolvedValueOnce(page([product], true, 'prod_next'))
      .mockResolvedValueOnce(page([{ ...product, id: 'prod_next', devMode: false }]));
    await expect(client.listProducts()).rejects.toMatchObject({ code: 'environment_mismatch' });
  });
  it('verifies that listed subscriptions belong to the requested checkout', async () => {
    const { fetcher, client } = setup();
    fetcher.mockResolvedValue(page([{ ...subscription, checkoutId: 'bill_other' }]));
    await expect(client.listSubscriptionsForCheckout('bill_test')).rejects.toMatchObject({
      code: 'binding_mismatch',
    });
  });
});
