import { describe, expect, it, vi } from 'vitest';
import { createAbacatePayCheckoutIntegrityReader } from './checkout-integrity';

const account = {
  provider: 'abacatepay',
  environment: 'sandbox',
  accountId: 'store_test',
} as const;
const config = { apiKey: 'synthetic-integrity-key', environment: 'sandbox' } as const;
const input = { checkoutId: 'bill_test', subscriptionId: 'subs_test', customerId: 'cust_test' };
const subscription = {
  id: 'subs_test',
  checkoutId: 'bill_test',
  customerId: 'cust_test',
  devMode: true,
  amount: 39700,
  status: 'ACTIVE',
  method: 'CARD',
  trialEndsAt: null,
};
const other = { ...subscription, id: 'subs_other', customerId: 'cust_other' };
const envelope = (data: unknown) => Response.json({ success: true, data });
const page = (data: unknown[], hasMore = false, next: string | null = null) =>
  Response.json({ success: true, data, pagination: { hasMore, next } });
function fixture(
  options: {
    store?: string;
    subscription?: Record<string, unknown>;
    pages?: Response[];
    status?: number;
  } = {},
) {
  let index = 0;
  const calls: URL[] = [];
  const fetcher = vi.fn<typeof fetch>(async (target, init) => {
    const url = new URL(String(target));
    calls.push(url);
    expect(init?.method).toBe('GET');
    expect(url.origin).toBe('https://api.abacatepay.com');
    if (options.status)
      return new Response('sensitive provider detail', { status: options.status });
    if (url.pathname.endsWith('/stores/get'))
      return envelope({ id: options.store ?? account.accountId });
    if (url.pathname.endsWith('/subscriptions/get'))
      return envelope({ ...subscription, ...options.subscription });
    if (url.pathname.endsWith('/subscriptions/list'))
      return options.pages?.[index++] ?? page([subscription]);
    throw Error('Unexpected synthetic integrity request');
  });
  return { calls, reader: createAbacatePayCheckoutIntegrityReader(account, config, fetcher) };
}
describe('checkout recurrence integrity observation', () => {
  it('checks an owned recurrence without inferring a paid period or issuing commands', async () => {
    const { reader, calls } = fixture();
    expect(await reader.inspect(input)).toMatchObject({
      issue: null,
      recurrence: 'running',
      complete: true,
      observedSubscriptionIds: ['subs_test'],
    });
    expect(calls).toHaveLength(3);
    expect(calls[2]?.searchParams.get('checkoutId')).toBe(input.checkoutId);
    expect(calls[2]?.searchParams.get('limit')).toBe('2');
  });
  it('observes a cancelled recurrence without granting or cancelling rights', async () => {
    expect(
      await fixture({ subscription: { status: 'CANCELLED' } }).reader.inspect(input),
    ).toMatchObject({ issue: null, recurrence: 'stopped' });
  });
  it.each(['PAUSED', 'future-status'])(
    'does not interpret unknown recurrence %s as paid or stopped',
    async (status) => {
      expect(await fixture({ subscription: { status } }).reader.inspect(input)).toMatchObject({
        issue: null,
        recurrence: 'unknown',
      });
    },
  );
  it.each([null, 'subs_test'])(
    'detects distinct recurrences even before local binding (%s)',
    async (subscriptionId) => {
      const { reader } = fixture({ pages: [page([subscription, other])] });
      expect(
        await reader.inspect({
          ...input,
          subscriptionId,
          customerId: subscriptionId ? input.customerId : null,
        }),
      ).toMatchObject({
        issue: 'multiple_subscriptions',
        observedSubscriptionIds: ['subs_other', 'subs_test'],
        complete: true,
      });
    },
  );
  it('detects additional subscriptions on a second page', async () => {
    const { reader, calls } = fixture({
      pages: [page([subscription], true, 'cursor_1'), page([other])],
    });
    expect((await reader.inspect(input)).issue).toBe('multiple_subscriptions');
    expect(calls[3]?.searchParams.get('after')).toBe('cursor_1');
  });
  it('reports a lower-bound observation if the list has more results', async () => {
    const { reader } = fixture({ pages: [page([other, subscription], true, 'cursor_1')] });
    expect(await reader.inspect(input)).toMatchObject({
      issue: 'multiple_subscriptions',
      complete: false,
    });
  });
  it('does not label an unpaid checkout with no subscriptions as missing a payment', async () => {
    const { reader, calls } = fixture({ pages: [page([])] });
    expect(
      await reader.inspect({ checkoutId: 'bill_test', subscriptionId: null, customerId: null }),
    ).toMatchObject({ issue: null, recurrence: 'unbound', observedSubscriptionIds: [] });
    expect(calls).toHaveLength(2);
  });
  it('does not bind or activate an unbound checkout from a single listed subscription', async () => {
    expect(
      await fixture().reader.inspect({
        checkoutId: 'bill_test',
        subscriptionId: null,
        customerId: null,
      }),
    ).toMatchObject({ issue: null, recurrence: 'unbound' });
  });
  it('flags a missing expected subscription instead of accepting its old paid checkout', async () => {
    expect((await fixture({ pages: [page([])] }).reader.inspect(input)).issue).toBe(
      'missing_subscription',
    );
  });
  it('flags a distinct sole subscription rather than replacing the local binding', async () => {
    expect((await fixture({ pages: [page([other])] }).reader.inspect(input)).issue).toBe(
      'subscription_mismatch',
    );
  });
  it('flags an unexpected native trial without granting access', async () => {
    expect(
      (
        await fixture({ subscription: { trialEndsAt: '2027-01-01T00:00:00Z' } }).reader.inspect(
          input,
        )
      ).issue,
    ).toBe('native_trial');
  });
  it.each([
    [page([subscription], true, 'cursor_1'), page([subscription])],
    [page([], true, 'cursor_1'), page([], true, 'cursor_1')],
    [page([], true, 'cursor_1'), page([], true, 'cursor_2')],
    [page([], false, 'cursor_1')],
    [page([], true, null)],
  ])(
    'incomplete or duplicate pagination never proves a healthy recurrence %#',
    async (...pages) => {
      await expect(fixture({ pages }).reader.inspect(input)).rejects.toMatchObject({
        code: 'pagination_invalid',
      });
    },
  );
  it.each([
    { ...subscription, devMode: false },
    { ...subscription, checkoutId: 'bill_other' },
    { ...subscription, id: 'invalid' },
  ])('rejects external list records belonging to another environment/resource %#', async (item) => {
    await expect(fixture({ pages: [page([item])] }).reader.inspect(input)).rejects.toThrow();
  });
  it.each([{ customerId: 'cust_wrong' }, { checkoutId: 'bill_wrong' }, { devMode: false }])(
    'rejects a mismatching authoritative subscription %#',
    async (subscription) => {
      await expect(fixture({ subscription }).reader.inspect(input)).rejects.toThrow();
    },
  );
  it('verifies the store before consulting subscriptions', async () => {
    const { reader, calls } = fixture({ store: 'store_other' });
    await expect(reader.inspect(input)).rejects.toMatchObject({ code: 'binding_mismatch' });
    expect(calls).toHaveLength(1);
  });
  it.each([401, 403, 429, 503])(
    'does not classify HTTP %s as a financial or access state',
    async (status) => {
      await expect(fixture({ status }).reader.inspect(input)).rejects.toThrow();
    },
  );
  it.each([{ checkoutId: 'invalid' }, { subscriptionId: null }, { customerId: null }])(
    'validates external inputs before requests %#',
    async (overrides) => {
      const { reader, calls } = fixture();
      await expect(reader.inspect({ ...input, ...overrides })).rejects.toMatchObject({
        code: 'invalid_input',
      });
      expect(calls).toHaveLength(0);
    },
  );
  it('refuses other provider/environment composition', () => {
    expect(() =>
      createAbacatePayCheckoutIntegrityReader({ ...account, provider: 'asaas' }, config),
    ).toThrow();
    expect(() =>
      createAbacatePayCheckoutIntegrityReader({ ...account, environment: 'production' }, config),
    ).toThrow();
  });
});
