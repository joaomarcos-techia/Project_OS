/** SaaS only. These snapshots neither grant access nor prove settlement. */
import { z } from 'zod';

export const opaqueBillingId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/);
export const billingAccountSchema = z
  .object({
    provider: z.enum(['asaas', 'abacatepay']),
    environment: z.enum(['sandbox', 'production']),
    accountId: opaqueBillingId,
  })
  .readonly();
export type BillingAccount = z.infer<typeof billingAccountSchema>;

export interface SubscriptionReadInput {
  subscriptionId: string;
  /** Taken from the persisted contract, never from a webhook's claimed owner. */
  customerId: string;
}

export interface SubscriptionSnapshot {
  account: BillingAccount;
  subscriptionId: string;
  customerId: string;
  checkoutId: string | null;
  amountMinor: number;
  currency: 'BRL';
  recurrence: 'running' | 'stopped' | 'pending' | 'unknown';
  rawStatus: string;
  rawCycle: string | null;
  rawMethod: string | null;
  cycle: 'monthly' | 'annual' | 'unknown';
  method: 'card' | 'pix' | 'boleto' | 'unknown';
  nextChargeDate: string | null;
  trialEndsAt: string | null;
}

export interface SaasSubscriptionReader {
  readonly account: BillingAccount;
  readSubscription(input: SubscriptionReadInput): Promise<SubscriptionSnapshot>;
}

export type GatewayReadErrorCode =
  | 'invalid_input'
  | 'invalid_response'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'unavailable'
  | 'environment_mismatch'
  | 'binding_mismatch'
  | 'pagination_invalid';

/** No raw response, network cause, credential, URL or personal data is retained. */
export class GatewayReadError extends Error {
  constructor(
    readonly code: GatewayReadErrorCode,
    readonly httpStatus: number | null = null,
  ) {
    super(`SaaS billing gateway: ${code}`);
    this.name = 'GatewayReadError';
  }
}

export function gatewayHttpReadError(status: number): GatewayReadError {
  const code =
    status === 401
      ? 'unauthorized'
      : status === 403
        ? 'forbidden'
        : status === 404
          ? 'not_found'
          : status === 429
            ? 'rate_limited'
            : status >= 500
              ? 'unavailable'
              : 'invalid_response';
  return new GatewayReadError(code, status);
}

export function parseBillingValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new GatewayReadError('invalid_response');
  return result.data;
}

export function validateReadInput(input: SubscriptionReadInput): void {
  if (
    !z.object({ subscriptionId: opaqueBillingId, customerId: opaqueBillingId }).safeParse(input)
      .success
  ) {
    throw new GatewayReadError('invalid_input');
  }
}

/** A namespace key, not a database binding or proof of tenant authorization. */
export function billingResourceKey(
  account: BillingAccount,
  resource: 'subscription' | 'checkout' | 'customer' | 'payment' | 'event',
  id: string,
): string {
  if (!billingAccountSchema.safeParse(account).success || !opaqueBillingId.safeParse(id).success) {
    throw new GatewayReadError('invalid_input');
  }
  return JSON.stringify([account.provider, account.environment, account.accountId, resource, id]);
}
