import { describe, expect, it } from 'vitest';

import { GatewayReadError } from '../saas/contracts';
import { createAbacatePayApprovedCardReceiptReader } from './approved-card-receipt';

const account = {
  provider: 'abacatepay',
  environment: 'sandbox',
  accountId: 'store_fixture',
} as const;
const config = { apiKey: 'synthetic-receipt-reader-only', environment: 'sandbox' } as const;
const input = {
  subscriptionId: 'subs_fixture',
  customerId: 'cust_fixture',
  checkoutId: 'bill_fixture',
  productId: 'prod_fixture',
  expectedAmountMinor: 39700,
  periodStart: '2026-12-09T00:31:10.888Z',
  periodEnd: '2027-01-09T00:31:10.888Z',
};
function movement(overrides: Record<string, unknown> = {}) {
  return {
    amount: 39700,
    kind: 'CARD_APPROVED',
    method: 'CARD',
    category: 'transaction',
    balanceEffect: 'none',
    ...overrides,
  };
}
function statement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tran_fixture',
    currency: 'BRL',
    createdAt: '2026-12-09T00:31:10.339Z',
    checkoutId: 'bill_fixture',
    paymentIntentId: 'card_new',
    customer: {
      publicId: 'cust_fixture',
      name: 'MUST_NOT_LEAK',
      email: 'synthetic@example.invalid',
      taxId: 'not-a-real-identifier',
    },
    movements: [movement()],
    ...overrides,
  };
}
type Options = {
  store?: Record<string, unknown>;
  product?: Record<string, unknown>;
  subscription?: Record<string, unknown>;
  subscriptions?: unknown[];
  pages?: { rows: unknown[]; hasMore: boolean; next: string | null }[];
  statementHttp?: number;
};
function fixture(options: Options = {}) {
  const calls: URL[] = [];
  let page = 0;
  const subscription = {
    id: 'subs_fixture',
    checkoutId: 'bill_fixture',
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
    let body: unknown;
    switch (url.pathname) {
      case '/v2/stores/get':
        body = { success: true, data: { id: 'store_fixture', ...options.store } };
        break;
      case '/v2/products/get':
        body = {
          success: true,
          data: {
            id: 'prod_fixture',
            externalId: 'synthetic-monthly',
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
        body = {
          success: true,
          data: options.subscriptions ?? [subscription],
          pagination: { hasMore: false, next: null },
        };
        break;
      case '/v2/bank-statement/list': {
        if (options.statementHttp) return new Response('{}', { status: options.statementHttp });
        const result = options.pages?.[page++] ?? {
          rows: [statement()],
          hasMore: false,
          next: null,
        };
        body = {
          success: true,
          data: result.rows,
          pagination: { hasMore: result.hasMore, next: result.next },
        };
        break;
      }
      default:
        throw new Error('Unexpected endpoint; initial paid checkout cannot prove a renewal');
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, reader: createAbacatePayApprovedCardReceiptReader(account, config, fetcher) };
}

describe('approved card receipt (read-only window evidence, no rights or provider-period claim)', () => {
  it('uses APPROVED/CARD_APPROVED and gross receipt, strips payer PII and never reads the initial bill flag', async () => {
    const { reader, calls } = fixture();
    const receipt = await reader.readApprovedReceipt(input);
    expect(receipt).toMatchObject({
      statementId: 'tran_fixture',
      paymentId: 'card_new',
      amountMinor: 39700,
      confirmation: 'CARD_APPROVED',
      settlement: 'unknown',
      subscriptionId: 'subs_fixture',
    });
    expect(JSON.stringify(receipt)).not.toContain('MUST_NOT_LEAK');
    expect(JSON.stringify(receipt)).not.toContain('taxId');
    const query = calls.find((url) => url.pathname.endsWith('/bank-statement/list'))?.searchParams;
    expect(query?.get('kind')).toBe('CARD_APPROVED');
    expect(query?.get('status')).toBe('APPROVED');
    expect(query?.get('method')).toBe('CARD');
    expect(query?.get('startDate')).toBe('2026-12-08');
    expect(query?.get('endDate')).toBe('2027-01-08');
    expect(calls.some((url) => url.pathname.includes('/checkouts/'))).toBe(false);
    expect(receipt).not.toHaveProperty('providerPeriodEnd');
  });
  it('does not reuse the initial payment from the previous month', async () => {
    const { reader } = fixture({
      pages: [
        {
          rows: [statement({ createdAt: '2026-11-09T00:31:10.339Z' })],
          hasMore: false,
          next: null,
        },
      ],
    });
    expect(await reader.readApprovedReceipt(input)).toBeNull();
  });
  it('ignores other checkouts and timestamps outside the proposed window', async () => {
    const { reader } = fixture({
      pages: [
        {
          rows: [
            statement({ id: 'tran_other', checkoutId: 'bill_other' }),
            statement({ id: 'tran_early', createdAt: '2026-12-09T00:30:10.887Z' }),
            statement({ id: 'tran_after', createdAt: input.periodEnd }),
          ],
          hasMore: false,
          next: null,
        },
      ],
    });
    expect(await reader.readApprovedReceipt(input)).toBeNull();
  });
  it('does not sum fees or mistake receivable approval for settlement', async () => {
    const { reader } = fixture({
      pages: [
        {
          rows: [
            statement({
              movements: [
                movement(),
                movement({ amount: -1500, kind: 'FEE', category: 'fee', balanceEffect: 'debit' }),
              ],
            }),
          ],
          hasMore: false,
          next: null,
        },
      ],
    });
    expect(await reader.readApprovedReceipt(input)).toMatchObject({
      amountMinor: 39700,
      settlement: 'unknown',
    });
  });
  it.each([
    { label: 'wrong account', options: { store: { id: 'store_other' } } },
    { label: 'production product', options: { product: { devMode: false } } },
    { label: 'native product trial', options: { product: { trialDays: 14 } } },
    { label: 'wrong product amount', options: { product: { price: 19700 } } },
    { label: 'annual product', options: { product: { cycle: 'ANNUALLY' } } },
    { label: 'wrong customer', options: { subscription: { customerId: 'cust_other' } } },
    { label: 'wrong checkout', options: { subscription: { checkoutId: 'bill_other' } } },
    { label: 'wrong subscription amount', options: { subscription: { amount: 19700 } } },
    { label: 'stopped recurrence', options: { subscription: { status: 'CANCELLED' } } },
    { label: 'pending subscription', options: { subscription: { status: 'PENDING' } } },
    { label: 'other method', options: { subscription: { method: 'PIX' } } },
    {
      label: 'native subscription trial',
      options: { subscription: { trialEndsAt: '2026-12-20T00:00:00.000Z' } },
    },
  ])('rejects $label', async ({ options }) => {
    await expect(fixture(options).reader.readApprovedReceipt(input)).rejects.toBeInstanceOf(
      GatewayReadError,
    );
  });
  it.each([
    statement({ movements: [movement({ amount: 19700 })] }),
    statement({ customer: { publicId: 'cust_other' } }),
    statement({ movements: [movement(), movement()] }),
    statement({ movements: [movement({ balanceEffect: 'debit' })] }),
    statement({ paymentIntentId: null }),
  ])('rejects mismatched or ambiguous financial content %#', async (row) => {
    await expect(
      fixture({ pages: [{ rows: [row], hasMore: false, next: null }] }).reader.readApprovedReceipt(
        input,
      ),
    ).rejects.toBeInstanceOf(GatewayReadError);
  });
  it('requires a unique financial candidate, or a trusted payment ID to resolve it', async () => {
    const options = {
      pages: [
        {
          rows: [statement(), statement({ id: 'tran_second', paymentIntentId: 'card_second' })],
          hasMore: false,
          next: null,
        },
      ],
    };
    await expect(fixture(options).reader.readApprovedReceipt(input)).rejects.toBeInstanceOf(
      GatewayReadError,
    );
    expect(
      await fixture(options).reader.readApprovedReceipt({ ...input, paymentId: 'card_new' }),
    ).toMatchObject({ statementId: 'tran_fixture' });
  });
  it('rejects multiple subscriptions even for the same customer', async () => {
    await expect(
      fixture({
        subscriptions: [
          {
            id: 'subs_fixture',
            checkoutId: 'bill_fixture',
            customerId: 'cust_fixture',
            amount: 39700,
            status: 'ACTIVE',
            method: 'CARD',
            devMode: true,
            trialEndsAt: null,
          },
          {
            id: 'subs_other',
            checkoutId: 'bill_fixture',
            customerId: 'cust_fixture',
            amount: 39700,
            status: 'ACTIVE',
            method: 'CARD',
            devMode: true,
            trialEndsAt: null,
          },
        ],
      }).reader.readApprovedReceipt(input),
    ).rejects.toBeInstanceOf(GatewayReadError);
  });
  it('does not accept partial pagination or repeated statement identities', async () => {
    const repeated = fixture({
      pages: [
        { rows: [statement()], hasMore: true, next: 'tran_cursor' },
        { rows: [statement()], hasMore: false, next: null },
      ],
    });
    await expect(repeated.reader.readApprovedReceipt(input)).rejects.toBeInstanceOf(
      GatewayReadError,
    );
    const bounded = fixture({
      pages: Array.from({ length: 5 }, (_, i) => ({
        rows: [],
        hasMore: true,
        next: `tran_cursor_${i}`,
      })),
    });
    await expect(bounded.reader.readApprovedReceipt(input)).rejects.toBeInstanceOf(
      GatewayReadError,
    );
    expect(
      bounded.calls.filter((url) => url.pathname.endsWith('/bank-statement/list')),
    ).toHaveLength(5);
  });
  it('rejects a repeating cursor before a third request', async () => {
    const value = fixture({
      pages: [
        { rows: [], hasMore: true, next: 'tran_cursor' },
        { rows: [], hasMore: true, next: 'tran_cursor' },
      ],
    });
    await expect(value.reader.readApprovedReceipt(input)).rejects.toBeInstanceOf(GatewayReadError);
    expect(value.calls.filter((url) => url.pathname.endsWith('/bank-statement/list'))).toHaveLength(
      2,
    );
  });
  it('fails closed on missing API permission', async () => {
    await expect(
      fixture({ statementHttp: 403 }).reader.readApprovedReceipt(input),
    ).rejects.toBeInstanceOf(GatewayReadError);
  });
  it('rejects malformed or oversized windows before network calls', async () => {
    const value = fixture();
    await expect(
      value.reader.readApprovedReceipt({ ...input, periodEnd: input.periodStart }),
    ).rejects.toBeInstanceOf(GatewayReadError);
    await expect(
      value.reader.readApprovedReceipt({ ...input, periodEnd: '2027-02-09T00:31:10.888Z' }),
    ).rejects.toBeInstanceOf(GatewayReadError);
    await expect(
      value.reader.readApprovedReceipt({ ...input, periodStart: 'not-a-date' }),
    ).rejects.toBeInstanceOf(GatewayReadError);
    expect(value.calls).toHaveLength(0);
  });
  it('rejects account/provider/environment mismatch at construction', () => {
    expect(() =>
      createAbacatePayApprovedCardReceiptReader({ ...account, provider: 'asaas' }, config),
    ).toThrow(GatewayReadError);
    expect(() =>
      createAbacatePayApprovedCardReceiptReader(account, { ...config, environment: 'production' }),
    ).toThrow(GatewayReadError);
  });
});
