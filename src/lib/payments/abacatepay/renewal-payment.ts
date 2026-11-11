import 'server-only';

import { z } from 'zod';

import {
  billingAccountSchema,
  GatewayReadError,
  opaqueBillingId,
  parseBillingValue,
  type BillingAccount,
} from '../saas/contracts';
import type { RecurringPaymentRead } from '../saas/recurring-payment';
import { MAX_CARD_RECEIPT_WINDOW_MS, readApprovedCardStatement } from './card-statement';
import { createAbacatePayReadClient, type AbacatePayReadConfig } from './reader';
import { createAbacatePayTransport } from './transport';

const resource = (prefix: string) => opaqueBillingId.refine((id) => id.startsWith(prefix));
const inputSchema = z
  .object({
    subscriptionId: resource('subs_'),
    customerId: resource('cust_'),
    originCheckoutId: resource('bill_'),
    checkoutId: resource('bill_'),
    paymentId: opaqueBillingId,
    productId: resource('prod_'),
    expectedAmountMinor: z.number().int().positive().max(999_999_999_999),
    windowStart: z.iso.datetime({ offset: true }),
    windowEnd: z.iso.datetime({ offset: true }),
  })
  .strict();

const renewalCheckoutSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: resource('bill_'),
    frequency: z.literal('SUBSCRIPTION'),
    customerId: resource('cust_').nullable(),
    amount: z.number().int().nonnegative().refine(Number.isSafeInteger),
    paidAmount: z.number().int().nonnegative().refine(Number.isSafeInteger).nullable(),
    currency: z.literal('BRL').optional(),
    status: z.string().min(1).max(128),
    devMode: z.boolean(),
    items: z.array(z.object({ id: resource('prod_'), quantity: z.number().int().positive() })),
    createdAt: z.iso.datetime({ offset: true }),
  }),
});

/**
 * The cycle's checkout/payment IDs must come from the authenticated inbox;
 * origin/customer/product/price and search bounds come from the saved contract.
 * Never discovers ownership from matching customer/amount or grants a period.
 */
export function createAbacatePayRenewalPaymentReader(
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
  const expectedDevMode = config.environment === 'sandbox';
  return {
    account,
    async readRenewalPayment(raw: z.input<typeof inputSchema>): Promise<RecurringPaymentRead> {
      const input = inputSchema.safeParse(raw);
      if (!input.success) throw new GatewayReadError('invalid_input');
      const expected = input.data;
      const start = Date.parse(expected.windowStart),
        end = Date.parse(expected.windowEnd);
      if (end <= start || end - start > MAX_CARD_RECEIPT_WINDOW_MS)
        throw new GatewayReadError('invalid_input');
      if ((await read.readStore()).id !== account.accountId)
        throw new GatewayReadError('binding_mismatch');
      const product = await read.readProduct(expected.productId);
      const subscription = await read.readSubscription(expected.subscriptionId);
      if (
        product.cycle !== 'MONTHLY' ||
        product.trialDays != null ||
        product.price !== expected.expectedAmountMinor ||
        subscription.checkoutId !== expected.originCheckoutId ||
        subscription.customerId !== expected.customerId ||
        subscription.amount !== expected.expectedAmountMinor ||
        subscription.method !== 'CARD' ||
        subscription.trialEndsAt !== null ||
        !['ACTIVE', 'CANCELLED'].includes(subscription.status)
      )
        throw new GatewayReadError('binding_mismatch');
      const originalCheckout = expected.checkoutId === expected.originCheckoutId;
      const providerStart = subscription.currentPeriodStart;
      const providerEnd = subscription.currentPeriodEnd;
      if (
        originalCheckout &&
        (!providerStart ||
          !providerEnd ||
          providerEnd <= providerStart ||
          !subscription.createdAt ||
          providerStart <= subscription.createdAt.slice(0, 10))
      )
        return { state: 'review' };
      const subscriptions = await read.listSubscriptionsForCheckout(expected.originCheckoutId);
      if (
        subscriptions.length !== 1 ||
        subscriptions[0]?.id !== expected.subscriptionId ||
        subscriptions[0]?.customerId !== expected.customerId
      )
        throw new GatewayReadError('binding_mismatch');
      const { data: checkout } = parseBillingValue(
        renewalCheckoutSchema,
        await request({
          method: 'GET',
          path: '/subscriptions/checkouts/get',
          params: new URLSearchParams({ id: expected.checkoutId }),
        }),
      );
      if (
        checkout.id !== expected.checkoutId ||
        checkout.devMode !== expectedDevMode ||
        checkout.customerId !== expected.customerId ||
        checkout.amount !== expected.expectedAmountMinor ||
        checkout.items.length !== 1 ||
        checkout.items[0]?.id !== expected.productId ||
        checkout.items[0]?.quantity !== 1
      )
        throw new GatewayReadError('binding_mismatch');
      if (checkout.status === 'PENDING' && checkout.paidAmount === null)
        return { state: 'pending' };
      if (checkout.status !== 'PAID' || checkout.paidAmount !== expected.expectedAmountMinor)
        return { state: 'review' };
      const receipt = await readApprovedCardStatement(request, {
        checkoutId: expected.checkoutId,
        customerId: expected.customerId,
        paymentId: expected.paymentId,
        expectedAmountMinor: expected.expectedAmountMinor,
        periodStart: expected.windowStart,
        periodEnd: expected.windowEnd,
      });
      if (!receipt) return { state: 'pending' };
      const receiptDay = new Date(receipt.createdAt).toISOString().slice(0, 10);
      if (
        originalCheckout &&
        (!providerStart || !providerEnd || receiptDay < providerStart || receiptDay >= providerEnd)
      )
        return { state: 'review' };
      return {
        state: 'paid',
        evidence: {
          account,
          subscriptionId: subscription.id,
          customerId: subscription.customerId,
          originCheckoutId: expected.originCheckoutId,
          checkoutId: checkout.id,
          productId: product.id,
          paymentId: receipt.paymentId,
          statementId: receipt.statementId,
          amountMinor: expected.expectedAmountMinor,
          paidAmountMinor: checkout.paidAmount,
          currency: 'BRL',
          chargeCreatedAt: originalCheckout ? receipt.createdAt : checkout.createdAt,
          confirmedAt: receipt.createdAt,
          method: 'card',
          recurrence: subscription.status === 'ACTIVE' ? 'running' : 'stopped',
          obligation: 'paid',
          settlement: 'unknown',
          ...(originalCheckout && providerStart && providerEnd
            ? { providerPeriodStart: providerStart, providerPeriodEnd: providerEnd }
            : {}),
        },
      };
    },
  };
}
