import 'server-only';

import { z } from 'zod';

import { BillingProviderError, type PaymentProvider } from '@/lib/payments/asaas';

import {
  billingAccountSchema,
  GatewayReadError,
  gatewayHttpReadError,
  opaqueBillingId,
  parseBillingValue,
  validateReadInput,
  type BillingAccount,
  type SaasSubscriptionReader,
} from './contracts';

// The existing DB stores numeric(12,2). Reject fractional cents, not merely NaN.
const MAX_BILLING_MINOR = 999_999_999_999;
const ROUNDING_TOLERANCE = 0.0001;
const subscriptionSchema = z.object({
  subscriptionId: opaqueBillingId,
  customerId: opaqueBillingId,
  value: z.number().finite().nonnegative(),
  status: z.string().min(1).max(128),
  cycle: z.string().nullable(),
  billingType: z.string().nullable(),
  nextDueDate: z.iso.date().nullable(),
});

/** Compatibility seam: existing Asaas client and active composition are unchanged. */
export function createAsaasSubscriptionReader(
  accountInput: BillingAccount,
  source: Pick<PaymentProvider, 'getSubscription'>,
): SaasSubscriptionReader {
  const account = parseBillingValue(billingAccountSchema, accountInput);
  if (account.provider !== 'asaas') throw new GatewayReadError('binding_mismatch');
  return {
    account,
    async readSubscription(input) {
      validateReadInput(input);
      let response: unknown;
      try {
        response = await source.getSubscription(input.subscriptionId);
      } catch (error) {
        if (error instanceof BillingProviderError && error.httpStatus !== null) {
          throw gatewayHttpReadError(error.httpStatus);
        }
        throw new GatewayReadError('unavailable');
      }
      const subscription = parseBillingValue(subscriptionSchema, response);
      if (
        subscription.subscriptionId !== input.subscriptionId ||
        subscription.customerId !== input.customerId
      ) {
        throw new GatewayReadError('binding_mismatch');
      }
      const scaled = subscription.value * 100;
      const amountMinor = Math.round(scaled);
      if (
        !Number.isSafeInteger(amountMinor) ||
        amountMinor > MAX_BILLING_MINOR ||
        Math.abs(scaled - amountMinor) > ROUNDING_TOLERANCE
      ) {
        throw new GatewayReadError('invalid_response');
      }
      return {
        account,
        subscriptionId: subscription.subscriptionId,
        customerId: subscription.customerId,
        checkoutId: null,
        amountMinor,
        currency: 'BRL',
        recurrence:
          subscription.status === 'ACTIVE'
            ? 'running'
            : subscription.status === 'INACTIVE' || subscription.status === 'EXPIRED'
              ? 'stopped'
              : 'unknown',
        rawStatus: subscription.status,
        rawCycle: subscription.cycle,
        rawMethod: subscription.billingType,
        cycle:
          subscription.cycle === 'MONTHLY'
            ? 'monthly'
            : subscription.cycle === 'YEARLY'
              ? 'annual'
              : 'unknown',
        method:
          subscription.billingType === 'CREDIT_CARD'
            ? 'card'
            : subscription.billingType === 'PIX'
              ? 'pix'
              : subscription.billingType === 'BOLETO'
                ? 'boleto'
                : 'unknown',
        nextChargeDate: subscription.nextDueDate,
        // The subscription readback does not establish the Qoro trial deadline.
        trialEndsAt: null,
      };
    },
  };
}
