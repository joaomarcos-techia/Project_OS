import 'server-only';

import { z } from 'zod';
import {
  billingAccountSchema,
  GatewayReadError,
  opaqueBillingId,
  parseBillingValue,
  type BillingAccount,
} from '../saas/contracts';
import { createAbacatePayReadClient, type AbacatePayReadConfig } from './reader';
import { createAbacatePayTransport } from './transport';

const resource = (prefix: string) => opaqueBillingId.refine((id) => id.startsWith(prefix));
const minor = z.number().int().nonnegative().max(999_999_999_999);
const inputSchema = z
  .object({
    checkoutId: resource('bill_'),
    customerId: resource('cust_'),
    productId: resource('prod_'),
    expectedAmountMinor: minor.positive(),
    windowStart: z.iso.datetime({ offset: true }),
    windowEnd: z.iso.datetime({ offset: true }),
  })
  .strict();
export const refundStatementSchema = z.object({
  id: resource('tran_'),
  currency: z.literal('BRL'),
  createdAt: z.iso.datetime({ offset: true }),
  checkoutId: resource('bill_').nullable(),
  paymentIntentId: opaqueBillingId.nullable(),
  customer: z.object({ publicId: resource('cust_').optional() }).nullish(),
  movements: z
    .array(
      z.object({
        amount: minor,
        category: z.string().max(128),
        balanceEffect: z.enum(['credit', 'debit', 'none']),
      }),
    )
    .max(20),
});
export const refundStatementPageSchema = z.object({
  success: z.literal(true),
  data: z.array(refundStatementSchema).max(100),
  pagination: z.object({ hasMore: z.boolean(), next: opaqueBillingId.nullable() }),
});

const statementInputSchema = inputSchema
  .omit({ productId: true })
  .extend({ requireCustomer: z.boolean() });
const MAX_RECEIPT_WINDOW_MS = 32 * 86_400_000;
const MAX_LEGACY_PAGES = 5;
export type RefundStatement = z.infer<typeof refundStatementSchema>;
export type RefundStatementInput = z.input<typeof statementInputSchema>;
export type RefundStatementReader = (
  request: ReturnType<typeof createAbacatePayTransport>,
  input: RefundStatementInput,
) => Promise<ReturnType<typeof selectRefundStatements>>;

export function validateRefundStatementInput(raw: RefundStatementInput) {
  const parsed = statementInputSchema.safeParse(raw);
  if (!parsed.success) throw new GatewayReadError('invalid_input');
  const start = Date.parse(parsed.data.windowStart),
    end = Date.parse(parsed.data.windowEnd);
  if (end <= start || end - start > MAX_RECEIPT_WINDOW_MS)
    throw new GatewayReadError('invalid_input');
  return parsed.data;
}

export function selectRefundStatements(items: RefundStatement[], raw: RefundStatementInput) {
  const expected = validateRefundStatementInput(raw);
  const start = Date.parse(expected.windowStart),
    end = Date.parse(expected.windowEnd);
  const ids = new Set<string>();
  let total = 0,
    reversal = false;
  for (const item of items) {
    if (ids.has(item.id)) throw new GatewayReadError('pagination_invalid');
    ids.add(item.id);
    const time = Date.parse(item.createdAt);
    if (item.checkoutId !== expected.checkoutId || time < start || time >= end) continue;
    if (
      (expected.requireCustomer && item.customer?.publicId !== expected.customerId) ||
      (item.customer?.publicId !== undefined && item.customer.publicId !== expected.customerId)
    )
      throw new GatewayReadError('binding_mismatch');
    for (const movement of item.movements) {
      if (movement.category === 'reversal') reversal = true;
      if (movement.category === 'refund' && movement.balanceEffect === 'debit')
        total += movement.amount;
    }
    if (!Number.isSafeInteger(total) || total > expected.expectedAmountMinor)
      throw new GatewayReadError('binding_mismatch');
  }
  return {
    refundDebitMinor: total,
    reversalObserved: reversal,
    evidenceLevel:
      total > 0 && !reversal ? ('refund_debit_verified' as const) : ('status_only' as const),
  };
}

/** N-1 fallback only. The runtime injects the durable reader after schema approval. */
export const readRefundStatement: RefundStatementReader = async (request, raw) => {
  const expected = validateRefundStatementInput(raw);
  const start = Date.parse(expected.windowStart),
    end = Date.parse(expected.windowEnd);
  const items: RefundStatement[] = [],
    ids = new Set<string>(),
    cursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_LEGACY_PAGES; page++) {
    const params = new URLSearchParams({
      limit: '100',
      startDate: new Date(start - 86_400_000).toISOString().slice(0, 10),
      endDate: new Date(end + 86_400_000).toISOString().slice(0, 10),
    });
    if (cursor) params.set('after', cursor);
    const result = parseBillingValue(
      refundStatementPageSchema,
      await request({ method: 'GET', path: '/bank-statement/list', params }),
    );
    for (const item of result.data) {
      if (ids.has(item.id)) throw new GatewayReadError('pagination_invalid');
      ids.add(item.id);
      items.push(item);
    }
    if (!result.pagination.hasMore) {
      if (result.pagination.next !== null) throw new GatewayReadError('pagination_invalid');
      return selectRefundStatements(items, expected);
    }
    const next = result.pagination.next;
    if (!next || cursors.has(next)) throw new GatewayReadError('pagination_invalid');
    cursors.add(next);
    cursor = next;
  }
  throw new GatewayReadError('pagination_invalid');
};

/** Financial observations only. PAID is not proof that a dispute was won or a refund reversed. */
export function createAbacatePayNegativePaymentReader(
  account: BillingAccount,
  config: AbacatePayReadConfig,
  fetcher: typeof fetch = fetch,
  consumedCheckout?: {
    checkoutId: string;
    customerId: string;
    productId: string;
    amountMinor: number;
  },
  statementReader: RefundStatementReader = readRefundStatement,
) {
  billingAccountSchema.parse(account);
  if (
    account.provider !== 'abacatepay' ||
    account.environment !== 'sandbox' ||
    config.environment !== 'sandbox'
  )
    throw new GatewayReadError('environment_mismatch');
  const read = createAbacatePayReadClient(config, fetcher),
    request = createAbacatePayTransport(config, fetcher);
  return {
    async readRefund(raw: z.input<typeof inputSchema>) {
      const input = inputSchema.safeParse(raw);
      if (!input.success) throw new GatewayReadError('invalid_input');
      const expected = input.data,
        start = Date.parse(expected.windowStart),
        end = Date.parse(expected.windowEnd);
      if (end <= start || end - start > MAX_RECEIPT_WINDOW_MS)
        throw new GatewayReadError('invalid_input');
      if ((await read.readStore()).id !== account.accountId)
        throw new GatewayReadError('binding_mismatch');
      const consumed =
        consumedCheckout?.checkoutId === expected.checkoutId &&
        consumedCheckout.customerId === expected.customerId &&
        consumedCheckout.productId === expected.productId &&
        consumedCheckout.amountMinor === expected.expectedAmountMinor;
      const checkout = consumed
        ? null
        : await read.readSubscriptionCheckoutFinancials(expected.checkoutId);
      if (
        checkout &&
        (checkout.customerId !== expected.customerId ||
          checkout.amount !== expected.expectedAmountMinor ||
          checkout.items.length !== 1 ||
          checkout.items[0]?.id !== expected.productId ||
          checkout.items[0]?.quantity !== 1)
      )
        throw new GatewayReadError('binding_mismatch');
      const observation = await statementReader(request, {
        checkoutId: expected.checkoutId,
        customerId: expected.customerId,
        expectedAmountMinor: expected.expectedAmountMinor,
        windowStart: expected.windowStart,
        windowEnd: expected.windowEnd,
        requireCustomer: consumed,
      });
      return { checkoutStatus: checkout?.status ?? null, ...observation };
    },
  };
}
