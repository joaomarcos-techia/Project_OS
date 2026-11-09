import { describe, expect, it, vi } from 'vitest';

import { commandOperationFingerprint } from '../saas/command-operation';
import { createAbacatePayCheckoutRecoveryReader } from './checkout-recovery';

const account = {
  provider: 'abacatepay',
  environment: 'sandbox',
  accountId: 'store_test',
} as const;
const parameters = {
  externalId: 'qoro-initial-fixture',
  productId: 'prod_test',
  expectedAmountMinor: 39700,
  expectedCycle: 'MONTHLY',
  expectedNativeTrialDays: null,
  returnUrl: 'https://qoro.example/configuracoes/assinatura',
  completionUrl: 'https://qoro.example/configuracoes/assinatura',
};
const input = {
  externalId: parameters.externalId,
  productId: parameters.productId,
  expectedAmountMinor: 39700,
  requestFingerprint: commandOperationFingerprint('create_subscription_checkout', parameters),
  reservedAt: '2026-11-01T00:00:00Z',
};
const checkout = {
  id: 'bill_test',
  externalId: parameters.externalId,
  url: 'https://app.abacatepay.com/pay/bill_test',
  frequency: 'SUBSCRIPTION',
  devMode: true,
  amount: 39700,
  paidAmount: null,
  status: 'PENDING',
  customerId: null,
  items: [{ id: 'prod_test', quantity: 1 }],
  methods: ['CARD'],
  returnUrl: parameters.returnUrl,
  completionUrl: parameters.completionUrl,
  createdAt: '2026-11-01T00:00:01Z',
};
type Page = { data: unknown[]; pagination: { hasMore: boolean; next: string | null } };
function setup(
  options: {
    patch?: Record<string, unknown>;
    pages?: Page[];
    product?: Record<string, unknown>;
    store?: string;
    status?: number;
    getPatch?: Record<string, unknown>;
  } = {},
) {
  const item = { ...checkout, ...options.patch };
  const pages = options.pages ?? [{ data: [item], pagination: { hasMore: false, next: null } }];
  let page = 0;
  const fetcher = vi.fn<typeof fetch>(async (raw, init) => {
    expect(init?.method).toBe('GET');
    const url = new URL(String(raw));
    expect(url.origin).toBe('https://api.abacatepay.com');
    if (options.status) return new Response('{}', { status: options.status });
    let body: unknown;
    if (url.pathname.endsWith('/stores/get'))
      body = { success: true, data: { id: options.store ?? 'store_test' } };
    else if (url.pathname.endsWith('/products/get'))
      body = {
        success: true,
        data: {
          id: 'prod_test',
          externalId: 'product',
          devMode: true,
          price: 39700,
          currency: 'BRL',
          cycle: 'MONTHLY',
          trialDays: null,
          ...options.product,
        },
      };
    else if (url.pathname.endsWith('/checkouts/list')) {
      expect(url.searchParams.get('externalId')).toBe(parameters.externalId);
      body = { success: true, ...(pages[page++] ?? pages.at(-1)) };
    } else if (url.pathname.endsWith('/checkouts/get'))
      body = { success: true, data: { ...item, ...options.getPatch } };
    else throw new Error('Unexpected network route');
    return Response.json(body);
  });
  const reader = createAbacatePayCheckoutRecoveryReader(
    account,
    { apiKey: 'test-key', environment: 'sandbox' },
    fetcher,
  );
  return { reader, fetcher };
}

describe('unknown checkout recovery: reference, original fingerprint and unique GET-only result', () => {
  it('recovers the original creation result without claiming a paid period', async () => {
    const { reader, fetcher } = setup();
    const result = await reader.discover(input);
    expect(result).toEqual({
      state: 'found',
      currentStatus: 'PENDING',
      result: {
        checkoutId: 'bill_test',
        externalId: parameters.externalId,
        amountMinor: 39700,
        environment: 'sandbox',
        state: 'pending',
        checkoutUrl: checkout.url,
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(result)).not.toMatch(/periodStart|periodEnd|accessUntil|settled/);
  });
  it.each(['PAID', 'EXPIRED', 'CANCELLED', 'REFUNDED'])(
    'retains a %s checkout without granting access or creating a replacement',
    async (status) => {
      const { reader } = setup({ patch: { status, paidAmount: status === 'PAID' ? 39700 : null } });
      expect(await reader.discover(input)).toMatchObject({
        state: 'found',
        currentStatus: status,
        result: { state: 'pending' },
      });
    },
  );
  it('keeps an absent result uncertain, even if the original POST may not have been sent', async () => {
    const { reader, fetcher } = setup({
      pages: [{ data: [], pagination: { hasMore: false, next: null } }],
    });
    expect(await reader.discover(input)).toEqual({ state: 'absent' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('scans the whole bounded result set before selecting one candidate', async () => {
    const { reader, fetcher } = setup({
      pages: [
        { data: [checkout], pagination: { hasMore: true, next: 'cursor_1' } },
        { data: [], pagination: { hasMore: false, next: null } },
      ],
    });
    expect(await reader.discover(input)).toMatchObject({ state: 'found' });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it.each([
    [
      'multiple matches',
      [
        {
          data: [checkout, { ...checkout, id: 'bill_other' }],
          pagination: { hasMore: false, next: null },
        },
      ],
    ],
    [
      'duplicate item',
      [{ data: [checkout, checkout], pagination: { hasMore: false, next: null } }],
    ],
    ['cursor loop', [{ data: [], pagination: { hasMore: true, next: 'cursor_loop' } }]],
    [
      'extra terminal cursor',
      [{ data: [checkout], pagination: { hasMore: false, next: 'cursor_extra' } }],
    ],
  ] satisfies Array<[string, Page[]]>)('rejects %s', async (_label, pages) => {
    await expect(setup({ pages }).reader.discover(input)).rejects.toThrow();
  });
  it('rejects an incomplete five-page scan', async () => {
    const pages = Array.from({ length: 5 }, (_, i) => ({
      data: [],
      pagination: { hasMore: true, next: `cursor_${i}` },
    }));
    await expect(setup({ pages }).reader.discover(input)).rejects.toMatchObject({
      code: 'pagination_invalid',
    });
  });
  it.each([
    { externalId: 'someone_else' },
    { devMode: false },
    { amount: 19700 },
    { frequency: 'ONE_TIME' },
    { items: [{ id: 'prod_other', quantity: 1 }] },
    { items: [{ id: 'prod_test', quantity: 2 }] },
    { methods: ['PIX'] },
    { returnUrl: 'https://attacker.example' },
    { completionUrl: null },
    { url: 'https://attacker.example/pay/bill_test' },
    { url: 'http://app.abacatepay.com/pay/bill_test' },
    { createdAt: '2026-10-20T00:00:00Z' },
    { createdAt: new Date(Date.now() + 120_000).toISOString() },
  ])('rejects a different command or checkout: %j', async (patch) => {
    await expect(setup({ patch }).reader.discover(input)).rejects.toThrow();
  });
  it.each([{ devMode: false }, { cycle: 'ANNUALLY' }, { trialDays: 14 }, { price: 19700 }])(
    'rejects a mismatched product %j',
    async (product) => {
      await expect(setup({ product }).reader.discover(input)).rejects.toThrow();
    },
  );
  it('verifies the store before querying owned resources', async () => {
    const { reader, fetcher } = setup({ store: 'store_other' });
    await expect(reader.discover(input)).rejects.toMatchObject({ code: 'binding_mismatch' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('verifies fresh details after a unique listing', async () => {
    await expect(
      setup({ getPatch: { id: 'bill_other' } }).reader.discover(input),
    ).rejects.toThrow();
    await expect(setup({ getPatch: { amount: 1 } }).reader.discover(input)).rejects.toThrow();
  });
  it('does not hide temporary provider failures as an absent checkout', async () => {
    await expect(setup({ status: 503 }).reader.discover(input)).rejects.toThrow();
  });
  it('rejects a different persisted request hash', async () => {
    await expect(
      setup().reader.discover({ ...input, requestFingerprint: 'f'.repeat(64) }),
    ).rejects.toThrow();
  });
  it('rejects malformed input before networking', async () => {
    const { reader, fetcher } = setup();
    await expect(reader.discover({ ...input, productId: '../secret' })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves fingerprint compatibility with omitted undefined fields', () => {
    expect(
      commandOperationFingerprint('create_subscription_checkout', {
        ...parameters,
        operationId: undefined,
      }),
    ).toBe(input.requestFingerprint);
  });
});
