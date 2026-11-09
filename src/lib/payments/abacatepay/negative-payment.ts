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
const pageSchema = z.object({
  success: z.literal(true),
  data: z
    .array(
      z.object({
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
      }),
    )
    .max(100),
  pagination: z.object({ hasMore: z.boolean(), next: opaqueBillingId.nullable() }),
});

/** Financial observations only. PAID is not proof that a dispute was won or a refund reversed. */
export function createAbacatePayNegativePaymentReader(
  account: BillingAccount,
  config: AbacatePayReadConfig,
  fetcher: typeof fetch = fetch,
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
      if (end <= start || end - start > 32 * 86_400_000)
        throw new GatewayReadError('invalid_input');
      if ((await read.readStore()).id !== account.accountId)
        throw new GatewayReadError('binding_mismatch');
      const checkout = await read.readSubscriptionCheckoutFinancials(expected.checkoutId);
      if (
        checkout.customerId !== expected.customerId ||
        checkout.amount !== expected.expectedAmountMinor ||
        checkout.items.length !== 1 ||
        checkout.items[0]?.id !== expected.productId ||
        checkout.items[0]?.quantity !== 1
      )
        throw new GatewayReadError('binding_mismatch');
      const ids = new Set<string>(),
        cursors = new Set<string>();
      let cursor: string | null = null,
        total = 0,
        reversal = false;
      for (let page = 0; page < 5; page++) {
        const params = new URLSearchParams({
          limit: '100',
          startDate: new Date(start - 86_400_000).toISOString().slice(0, 10),
          endDate: new Date(end + 86_400_000).toISOString().slice(0, 10),
        });
        if (cursor) params.set('after', cursor);
        const result = parseBillingValue(
          pageSchema,
          await request({ method: 'GET', path: '/bank-statement/list', params }),
        );
        for (const item of result.data) {
          if (ids.has(item.id)) throw new GatewayReadError('pagination_invalid');
          ids.add(item.id);
          const time = Date.parse(item.createdAt);
          if (item.checkoutId !== expected.checkoutId || time < start || time >= end) continue;
          if (
            item.customer?.publicId !== undefined &&
            item.customer.publicId !== expected.customerId
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
        if (!result.pagination.hasMore) {
          if (result.pagination.next !== null) throw new GatewayReadError('pagination_invalid');
          return {
            checkoutStatus: checkout.status,
            refundDebitMinor: total,
            reversalObserved: reversal,
            evidenceLevel:
              total > 0 && !reversal
                ? ('refund_debit_verified' as const)
                : ('status_only' as const),
          };
        }
        const next = result.pagination.next;
        if (!next || cursors.has(next)) throw new GatewayReadError('pagination_invalid');
        cursors.add(next);
        cursor = next;
      }
      throw new GatewayReadError('pagination_invalid');
    },
  };
}
