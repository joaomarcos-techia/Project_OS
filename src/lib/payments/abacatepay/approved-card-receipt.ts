import 'server-only';

import { z } from 'zod';

import {
  billingAccountSchema,
  GatewayReadError,
  opaqueBillingId,
  parseBillingValue,
} from '../saas/contracts';
import type { BillingAccount } from '../saas/contracts';
import { createAbacatePayReadClient, type AbacatePayReadConfig } from './reader';
import { createAbacatePayTransport } from './transport';

const resource = (prefix: string) => opaqueBillingId.refine((id) => id.startsWith(prefix));
const inputSchema = z
  .object({
    subscriptionId: resource('subs_'),
    customerId: resource('cust_'),
    checkoutId: resource('bill_'),
    productId: resource('prod_'),
    expectedAmountMinor: z.number().int().positive().max(999_999_999_999),
    periodStart: z.iso.datetime({ offset: true }),
    periodEnd: z.iso.datetime({ offset: true }),
    paymentId: opaqueBillingId.optional(),
  })
  .strict();
const statementSchema = z.object({
  id: resource('tran_'),
  currency: z.literal('BRL'),
  createdAt: z.iso.datetime({ offset: true }),
  checkoutId: resource('bill_').nullable(),
  paymentIntentId: opaqueBillingId.nullable(),
  customer: z
    .object({ publicId: resource('cust_') })
    .nullable()
    .optional(),
  movements: z
    .array(
      z.object({
        amount: z.number().int().refine(Number.isSafeInteger),
        kind: z.string().min(1).max(128),
        method: z.string().min(1).max(128),
        category: z.string().min(1).max(128),
        balanceEffect: z.enum(['credit', 'debit', 'none']),
      }),
    )
    .min(1)
    .max(20),
});
const envelopeSchema = z.object({
  success: z.literal(true),
  data: z.array(statementSchema).max(100),
  pagination: z.object({ hasMore: z.boolean(), next: opaqueBillingId.nullable() }),
});
const RECEIPT_CLOCK_SKEW_MS = 60_000;
const MAX_MONTH_WINDOW_MS = 32 * 86_400_000;
const MAX_PAGES = 5;

function brazilDate(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const part = (type: 'year' | 'month' | 'day') => parts.find((item) => item.type === type)?.value;
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new GatewayReadError('invalid_input');
  return date;
}

export type ApprovedCardReceipt = {
  account: BillingAccount;
  statementId: string;
  paymentId: string;
  subscriptionId: string;
  customerId: string;
  checkoutId: string;
  amountMinor: number;
  currency: 'BRL';
  createdAt: string;
  confirmation: 'CARD_APPROVED';
  settlement: 'unknown';
};

/**
 * Read-only financial evidence for a Qoro-provided window, not an entitlement
 * grant or a provider billing-period assertion. Never reuses the initial bill's
 * PAID flag. A domain consumer must deduplicate statement/payment IDs and check
 * the window against its persisted contract before applying any effect.
 */
export function createAbacatePayApprovedCardReceiptReader(
  accountInput: BillingAccount,
  config: AbacatePayReadConfig,
  fetcher: typeof fetch = fetch,
) {
  const parsed = billingAccountSchema.safeParse(accountInput);
  if (!parsed.success) throw new GatewayReadError('invalid_input');
  const account = parsed.data;
  if (account.provider !== 'abacatepay' || account.environment !== config.environment)
    throw new GatewayReadError('binding_mismatch');
  const read = createAbacatePayReadClient(config, fetcher);
  const request = createAbacatePayTransport(config, fetcher);
  return {
    account,
    async readApprovedReceipt(
      raw: z.input<typeof inputSchema>,
    ): Promise<ApprovedCardReceipt | null> {
      const input = inputSchema.safeParse(raw);
      if (!input.success) throw new GatewayReadError('invalid_input');
      const expected = input.data;
      const start = Date.parse(expected.periodStart),
        end = Date.parse(expected.periodEnd);
      if (end <= start || end - start > MAX_MONTH_WINDOW_MS)
        throw new GatewayReadError('invalid_input');
      if ((await read.readStore()).id !== account.accountId)
        throw new GatewayReadError('binding_mismatch');
      const product = await read.readProduct(expected.productId);
      const subscription = await read.readSubscription(expected.subscriptionId);
      if (
        product.cycle !== 'MONTHLY' ||
        product.trialDays != null ||
        product.price !== expected.expectedAmountMinor ||
        subscription.checkoutId !== expected.checkoutId ||
        subscription.customerId !== expected.customerId ||
        subscription.amount !== expected.expectedAmountMinor ||
        subscription.method !== 'CARD' ||
        subscription.status !== 'ACTIVE' ||
        subscription.trialEndsAt !== null
      )
        throw new GatewayReadError('binding_mismatch');
      const subscriptions = await read.listSubscriptionsForCheckout(expected.checkoutId);
      if (
        subscriptions.length !== 1 ||
        subscriptions[0]?.id !== expected.subscriptionId ||
        subscriptions[0]?.customerId !== expected.customerId
      )
        throw new GatewayReadError('binding_mismatch');

      const seenCursors = new Set<string>(),
        seenStatements = new Set<string>();
      const candidates: ApprovedCardReceipt[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({
          limit: '100',
          method: 'CARD',
          kind: 'CARD_APPROVED',
          status: 'APPROVED',
          startDate: brazilDate(start - RECEIPT_CLOCK_SKEW_MS),
          endDate: brazilDate(end),
        });
        if (cursor) params.set('after', cursor);
        const envelope = parseBillingValue(
          envelopeSchema,
          await request({ method: 'GET', path: '/bank-statement/list', params }),
        );
        for (const item of envelope.data) {
          if (seenStatements.has(item.id)) throw new GatewayReadError('pagination_invalid');
          seenStatements.add(item.id);
          const createdAt = Date.parse(item.createdAt);
          if (
            item.checkoutId !== expected.checkoutId ||
            createdAt < start - RECEIPT_CLOCK_SKEW_MS ||
            createdAt >= end ||
            (expected.paymentId !== undefined && item.paymentIntentId !== expected.paymentId)
          )
            continue;
          if (
            !item.paymentIntentId ||
            (item.customer && item.customer.publicId !== expected.customerId)
          )
            throw new GatewayReadError('binding_mismatch');
          const gross = item.movements.filter((movement) => movement.kind === 'CARD_APPROVED');
          if (
            gross.length !== 1 ||
            gross[0]?.amount !== expected.expectedAmountMinor ||
            gross[0]?.method !== 'CARD' ||
            gross[0]?.category !== 'transaction' ||
            gross[0]?.balanceEffect === 'debit'
          )
            throw new GatewayReadError('binding_mismatch');
          candidates.push({
            account,
            statementId: item.id,
            paymentId: item.paymentIntentId,
            subscriptionId: subscription.id,
            customerId: subscription.customerId,
            checkoutId: expected.checkoutId,
            amountMinor: expected.expectedAmountMinor,
            currency: 'BRL',
            createdAt: item.createdAt,
            confirmation: 'CARD_APPROVED',
            settlement: 'unknown',
          });
        }
        if (!envelope.pagination.hasMore) {
          if (envelope.pagination.next !== null) throw new GatewayReadError('pagination_invalid');
          if (candidates.length > 1) throw new GatewayReadError('binding_mismatch');
          return candidates[0] ?? null;
        }
        const next = envelope.pagination.next;
        if (next === null || seenCursors.has(next))
          throw new GatewayReadError('pagination_invalid');
        seenCursors.add(next);
        cursor = next;
      }
      throw new GatewayReadError('pagination_invalid');
    },
  };
}
