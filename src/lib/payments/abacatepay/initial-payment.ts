import 'server-only';

import { z } from 'zod';

import { billingAccountSchema, GatewayReadError, opaqueBillingId } from '../saas/contracts';
import type { BillingAccount } from '../saas/contracts';
import { createAbacatePayReadClient, type AbacatePayReadConfig } from './reader';

const inputSchema = z
  .object({
    subscriptionId: opaqueBillingId.refine((id) => id.startsWith('subs_')),
    customerId: opaqueBillingId.refine((id) => id.startsWith('cust_')),
    checkoutId: opaqueBillingId.refine((id) => id.startsWith('bill_')),
    productId: opaqueBillingId.refine((id) => id.startsWith('prod_')),
    expectedAmountMinor: z.number().int().positive().max(999_999_999_999),
  })
  .strict();

export interface InitialPaymentEvidence {
  account: BillingAccount;
  subscriptionId: string;
  customerId: string;
  checkoutId: string;
  amountMinor: number;
  paidAmountMinor: number | null;
  currency: 'BRL';
  method: 'card' | 'pix';
  state: 'paid' | 'pending' | 'expired' | 'cancelled' | 'refunded' | 'unknown';
  rawStatus: string;
  /** Provider charge/receipt confirmation does not prove available funds. */
  settlement: 'unknown';
  /** Read from the provider. Not a remote next-due-date or paid-period claim. */
  subscriptionCreatedAt: string | null;
  recurrence: 'running' | 'stopped' | 'unknown';
}

/**
 * Initial, no-native-trial subscription charge only. Not a renewal reader or an
 * entitlement transition. Resolve inputs from a persisted binding/operation;
 * never take the event's claimed owner/price as authority.
 */
export function createAbacatePayInitialPaymentReader(
  accountInput: BillingAccount,
  config: AbacatePayReadConfig,
  fetcher: typeof fetch = fetch,
) {
  const parsed = billingAccountSchema.safeParse(accountInput);
  if (!parsed.success) throw new GatewayReadError('invalid_input');
  const account = parsed.data;
  if (account.provider !== 'abacatepay' || account.environment !== config.environment) {
    throw new GatewayReadError('binding_mismatch');
  }
  const read = createAbacatePayReadClient(config, fetcher);
  return {
    account,
    async readInitialPayment(input: z.input<typeof inputSchema>): Promise<InitialPaymentEvidence> {
      const validated = inputSchema.safeParse(input);
      if (!validated.success) throw new GatewayReadError('invalid_input');
      const expected = validated.data;
      if ((await read.readStore()).id !== account.accountId)
        throw new GatewayReadError('binding_mismatch');
      const subscription = await read.readSubscription(expected.subscriptionId);
      if (
        subscription.customerId !== expected.customerId ||
        !['CARD', 'PIX'].includes(subscription.method) ||
        subscription.checkoutId !== expected.checkoutId ||
        subscription.trialEndsAt !== null ||
        subscription.amount !== expected.expectedAmountMinor
      ) {
        throw new GatewayReadError('binding_mismatch');
      }
      const checkout = await read.readSubscriptionCheckoutFinancials(expected.checkoutId);
      if (
        checkout.customerId !== expected.customerId ||
        checkout.amount !== expected.expectedAmountMinor ||
        checkout.items.length !== 1 ||
        checkout.items[0]?.id !== expected.productId ||
        checkout.items[0]?.quantity !== 1
      ) {
        throw new GatewayReadError('binding_mismatch');
      }
      const matches = await read.listSubscriptionsForCheckout(expected.checkoutId);
      if (
        matches.length !== 1 ||
        matches[0]?.id !== expected.subscriptionId ||
        matches[0]?.customerId !== expected.customerId
      ) {
        throw new GatewayReadError('binding_mismatch');
      }
      if (checkout.status === 'PAID' && checkout.paidAmount !== expected.expectedAmountMinor) {
        throw new GatewayReadError('invalid_response');
      }
      const knownStates = new Map<string, InitialPaymentEvidence['state']>([
        ['PAID', 'paid'],
        ['PENDING', 'pending'],
        ['EXPIRED', 'expired'],
        ['CANCELLED', 'cancelled'],
        ['REFUNDED', 'refunded'],
      ]);
      const state = knownStates.get(checkout.status) ?? 'unknown';
      return {
        account,
        subscriptionId: subscription.id,
        customerId: subscription.customerId,
        checkoutId: checkout.id,
        amountMinor: checkout.amount,
        paidAmountMinor: checkout.paidAmount,
        currency: 'BRL',
        method: subscription.method === 'PIX' ? 'pix' : 'card',
        state,
        rawStatus: checkout.status,
        settlement: 'unknown',
        subscriptionCreatedAt: subscription.createdAt ?? null,
        recurrence:
          subscription.status === 'ACTIVE'
            ? 'running'
            : subscription.status === 'CANCELLED'
              ? 'stopped'
              : 'unknown',
      };
    },
  };
}
