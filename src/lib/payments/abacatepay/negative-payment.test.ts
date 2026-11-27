import { describe, expect, it, vi } from 'vitest';
import { createAbacatePayNegativePaymentReader } from './negative-payment';
const account = {
  provider: 'abacatepay',
  environment: 'sandbox',
  accountId: 'store_test',
} as const;
const input = {
  checkoutId: 'bill_test',
  customerId: 'cust_test',
  productId: 'prod_test',
  expectedAmountMinor: 39700,
  windowStart: '2026-11-01T00:00:00Z',
  windowEnd: '2026-11-02T00:00:00Z',
};
const refund = {
  id: 'tran_test',
  currency: 'BRL',
  createdAt: '2026-11-01T12:00:00Z',
  checkoutId: 'bill_test',
  paymentIntentId: 'char_test',
  customer: { publicId: 'cust_test' },
  movements: [{ amount: 39700, category: 'refund', balanceEffect: 'debit' }],
};
function setup(
  options: {
    patch?: Record<string, unknown>;
    checkout?: Record<string, unknown>;
    store?: string;
    mode?: boolean;
    status?: number;
    consumed?: boolean;
    pages?: { data: unknown[]; pagination: { hasMore: boolean; next: string | null } }[];
  } = {},
) {
  let page = 0;
  const fetcher = vi.fn<typeof fetch>(async (raw, init) => {
    expect(init?.method).toBe('GET');
    const url = new URL(String(raw));
    expect(url.origin).toBe('https://api.abacatepay.com');
    if (options.status) return new Response('{}', { status: options.status });
    let data: unknown;
    if (url.pathname.endsWith('/stores/get')) data = { id: options.store ?? 'store_test' };
    else if (url.pathname.endsWith('/checkouts/get'))
      data = {
        id: 'bill_test',
        frequency: 'SUBSCRIPTION',
        devMode: options.mode ?? true,
        amount: 39700,
        paidAmount: 39700,
        status: 'REFUNDED',
        customerId: 'cust_test',
        items: [{ id: 'prod_test', quantity: 1 }],
        ...options.checkout,
      };
    else if (url.pathname.endsWith('/bank-statement/list')) {
      expect(url.searchParams.has('method')).toBe(false);
      expect(url.searchParams.has('kind')).toBe(false);
      const result = options.pages?.[page++] ?? {
        data: [{ ...refund, ...options.patch }],
        pagination: { hasMore: false, next: null },
      };
      return Response.json({ success: true, ...result });
    } else throw Error('Unexpected request');
    return Response.json({ success: true, data });
  });
  return {
    read: createAbacatePayNegativePaymentReader(
      account,
      { apiKey: 'synthetic-key', environment: 'sandbox' },
      fetcher,
      options.consumed
        ? {
            checkoutId: input.checkoutId,
            customerId: input.customerId,
            productId: input.productId,
            amountMinor: input.expectedAmountMinor,
          }
        : undefined,
    ),
    fetcher,
  };
}
describe('negative financial readback never infers access or dispute outcomes', () => {
  it('verifies a bound refund from the statement after a consumed link was removed, without inventing checkout status', async () => {
    const { read, fetcher } = setup({ consumed: true });
    expect(await read.readRefund(input)).toMatchObject({
      refundDebitMinor: 39700,
      checkoutStatus: null,
      evidenceLevel: 'refund_debit_verified',
    });
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/checkouts/get'))).toBe(false);
  });
  it('requires exact receipt customer identity when relying on the consumed contract snapshot', async () => {
    const { read } = setup({ consumed: true, patch: { customer: null } });
    await expect(read.readRefund(input)).rejects.toMatchObject({ code: 'binding_mismatch' });
  });
  it('verifies refund debits independently of a PAID checkout, without sending a command', async () => {
    const { read } = setup({ checkout: { status: 'PAID' } });
    expect(await read.readRefund(input)).toEqual({
      checkoutStatus: 'PAID',
      refundDebitMinor: 39700,
      reversalObserved: false,
      evidenceLevel: 'refund_debit_verified',
    });
  });
  it('keeps partial refund amounts separate from the original contract price', async () => {
    const { read } = setup({
      patch: { movements: [{ amount: 10000, category: 'refund', balanceEffect: 'debit' }] },
    });
    expect(await read.readRefund(input)).toMatchObject({
      refundDebitMinor: 10000,
      evidenceLevel: 'refund_debit_verified',
    });
  });
  it('does not claim that a refund was reversed when an unclassified reversal appears', async () => {
    const { read } = setup({
      patch: {
        movements: [
          ...refund.movements,
          { amount: 39700, category: 'reversal', balanceEffect: 'credit' },
        ],
      },
    });
    expect(await read.readRefund(input)).toMatchObject({
      refundDebitMinor: 39700,
      reversalObserved: true,
      evidenceLevel: 'status_only',
    });
  });
  it('does not treat REFUNDED or an empty ledger alone as a verified loss amount', async () => {
    const { read } = setup({ pages: [{ data: [], pagination: { hasMore: false, next: null } }] });
    expect(await read.readRefund(input)).toMatchObject({
      checkoutStatus: 'REFUNDED',
      refundDebitMinor: 0,
      evidenceLevel: 'status_only',
    });
  });
  it.each([
    { checkoutId: 'bill_other' },
    { createdAt: '2026-10-30T00:00:00Z' },
    { createdAt: '2026-11-02T00:00:00Z' },
  ])('ignores an unrelated or out-of-window row %s', async (patch) => {
    const { read } = setup({ patch });
    expect(await read.readRefund(input)).toMatchObject({ refundDebitMinor: 0 });
  });
  it.each([
    { customerId: 'cust_other' },
    { amount: 19700 },
    { items: [{ id: 'prod_other', quantity: 1 }] },
    { items: [{ id: 'prod_test', quantity: 2 }] },
  ])('rejects a mismatched contract checkout %s', async (checkout) => {
    await expect(setup({ checkout }).read.readRefund(input)).rejects.toMatchObject({
      code: 'binding_mismatch',
    });
  });
  it('rejects a statement tied to a different customer', async () => {
    await expect(
      setup({ patch: { customer: { publicId: 'cust_other' } } }).read.readRefund(input),
    ).rejects.toMatchObject({ code: 'binding_mismatch' });
  });
  it('accepts a documented statement customer without publicId, relying on the independently owned checkout', async () => {
    expect(await setup({ patch: { customer: {} } }).read.readRefund(input)).toMatchObject({
      refundDebitMinor: 39700,
    });
  });
  it('rejects a sum greater than the gross obligation', async () => {
    await expect(
      setup({
        patch: { movements: [{ amount: 39701, category: 'refund', balanceEffect: 'debit' }] },
      }).read.readRefund(input),
    ).rejects.toMatchObject({ code: 'binding_mismatch' });
  });
  it('rejects duplicate pages rather than double-counting a refund', async () => {
    const pages = [
      { data: [refund], pagination: { hasMore: true, next: 'tran_cursor' } },
      { data: [refund], pagination: { hasMore: false, next: null } },
    ];
    await expect(setup({ pages }).read.readRefund(input)).rejects.toMatchObject({
      code: 'pagination_invalid',
    });
  });
  it('rejects a cursor loop', async () => {
    const pages = [
      { data: [], pagination: { hasMore: true, next: 'tran_cursor' } },
      { data: [], pagination: { hasMore: true, next: 'tran_cursor' } },
    ];
    await expect(setup({ pages }).read.readRefund(input)).rejects.toMatchObject({
      code: 'pagination_invalid',
    });
  });
  it('enforces the page limit without partial financial truth', async () => {
    const pages = Array.from({ length: 5 }, (_, i) => ({
      data: [],
      pagination: { hasMore: true, next: `tran_${i}` },
    }));
    await expect(setup({ pages }).read.readRefund(input)).rejects.toMatchObject({
      code: 'pagination_invalid',
    });
  });
  it('verifies store and devMode', async () => {
    await expect(setup({ store: 'store_other' }).read.readRefund(input)).rejects.toMatchObject({
      code: 'binding_mismatch',
    });
    await expect(setup({ mode: false }).read.readRefund(input)).rejects.toMatchObject({
      code: 'environment_mismatch',
    });
  });
  it('keeps transient API failure explicit', async () => {
    await expect(setup({ status: 503 }).read.readRefund(input)).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
  it('rejects malformed or unbounded inputs before network access', async () => {
    const { read, fetcher } = setup();
    for (const patch of [
      { checkoutId: 'other' },
      { expectedAmountMinor: 0 },
      { windowEnd: input.windowStart },
      { windowEnd: '2027-01-01T00:00:00Z' },
    ])
      await expect(read.readRefund({ ...input, ...patch })).rejects.toMatchObject({
        code: 'invalid_input',
      });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
