import 'server-only';

import { z } from 'zod';

import { billingAccountSchema, GatewayReadError, opaqueBillingId } from '../saas/contracts';
import type { BillingAccount } from '../saas/contracts';
import { createAbacatePayReadClient, type AbacatePayReadConfig } from './reader';
import { createAbacatePayTransport } from './transport';
import { MAX_CARD_RECEIPT_WINDOW_MS, readApprovedCardStatement } from './card-statement';

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

      const receipt = await readApprovedCardStatement(request, expected);
      return receipt
        ? {
            ...receipt,
            account,
            subscriptionId: subscription.id,
            customerId: subscription.customerId,
            currency: 'BRL',
            confirmation: 'CARD_APPROVED',
            settlement: 'unknown',
          }
        : null;
    },
  };
}
