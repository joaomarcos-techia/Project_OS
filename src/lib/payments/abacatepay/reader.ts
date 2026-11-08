import 'server-only';

import { z } from 'zod';

import {
  billingAccountSchema,
  GatewayReadError,
  opaqueBillingId,
  parseBillingValue,
  validateReadInput,
  type BillingAccount,
  type SaasSubscriptionReader,
  type SubscriptionSnapshot,
} from '../saas/contracts';
import { createAbacatePayTransport } from './transport';

const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const minorAmount = z.number().int().nonnegative().refine(Number.isSafeInteger);
const resourceId = (prefix: string) => opaqueBillingId.refine((value) => value.startsWith(prefix));
const envelopeSchema = z.object({ success: z.literal(true), data: z.unknown() });
const paginationSchema = z.object({ hasMore: z.boolean(), next: opaqueBillingId.nullable() });
const storeSchema = z.object({ id: resourceId('store_') });
const productSchema = z.object({
  id: resourceId('prod_'),
  externalId: z.string().min(1).max(500),
  price: minorAmount,
  currency: z.literal('BRL'),
  devMode: z.boolean(),
  cycle: z.string().nullable().optional(),
  trialDays: z.number().int().min(1).max(90).nullable().optional(),
});
const subscriptionSchema = z.object({
  id: resourceId('subs_'),
  checkoutId: resourceId('bill_').nullable(),
  customerId: resourceId('cust_'),
  amount: minorAmount,
  currency: z.literal('BRL').optional(),
  status: z.string().min(1).max(128),
  method: z.string().min(1).max(128),
  devMode: z.boolean(),
  trialEndsAt: z.iso.datetime({ offset: true }).nullable(),
  // Documented GET schema does not promise frequency or the next due date.
  frequency: z.string().optional(),
  createdAt: z.iso.datetime({ offset: true }).optional(),
});
const checkoutSchema = z.object({
  id: resourceId('bill_'),
  frequency: z.literal('SUBSCRIPTION'),
  customerId: resourceId('cust_').nullable(),
  amount: minorAmount,
  currency: z.literal('BRL').optional(),
  status: z.string().min(1).max(128),
  devMode: z.boolean(),
});
const checkoutFinancialSchema = checkoutSchema.extend({
  paidAmount: minorAmount.nullable(),
  items: z.array(z.object({ id: resourceId('prod_'), quantity: z.number().int().positive() })),
});

export type AbacatePayProduct = z.infer<typeof productSchema>;
export type AbacatePaySubscriptionCheckout = z.infer<typeof checkoutSchema>;
export type AbacatePayCheckoutFinancials = z.infer<typeof checkoutFinancialSchema>;

export interface AbacatePayReadConfig {
  apiKey: string;
  environment: BillingAccount['environment'];
  timeoutMs?: number;
}

/**
 * Read-only V2 preparation. No create/cancel/update method, active composition,
 * automatic retries or gateway fallback exists in this client.
 */
export function createAbacatePayReadClient(
  config: AbacatePayReadConfig,
  fetcher: typeof fetch = fetch,
) {
  if (!z.enum(['sandbox', 'production']).safeParse(config.environment).success) {
    throw new GatewayReadError('invalid_input');
  }
  // Capture immutable values; callers must not be able to change credentials or
  // expected environment halfway through reading a persisted binding.
  const request = createAbacatePayTransport(config, fetcher);
  const expectedDevMode = config.environment === 'sandbox';

  function assertMode(devMode: boolean): void {
    if (devMode !== expectedDevMode) throw new GatewayReadError('environment_mismatch');
  }

  async function get(path: string, params?: URLSearchParams): Promise<unknown> {
    return request({ method: 'GET', path, ...(params === undefined ? {} : { params }) });
  }

  async function getOne<T>(path: string, schema: z.ZodType<T>, id?: string): Promise<T> {
    if (id !== undefined && !opaqueBillingId.safeParse(id).success) {
      throw new GatewayReadError('invalid_input');
    }
    const params = id === undefined ? undefined : new URLSearchParams({ id });
    const envelope = parseBillingValue(envelopeSchema, await get(path, params));
    return parseBillingValue(schema, envelope.data);
  }

  async function listAll<T>(
    path: string,
    schema: z.ZodType<T>,
    validate: (item: T) => void,
    filters: Record<string, string> = {},
    bounds: { maxPages: number; maxItems: number } = {
      maxPages: MAX_PAGES,
      maxItems: PAGE_SIZE * MAX_PAGES,
    },
  ): Promise<T[]> {
    const seenCursors = new Set<string>();
    const items: T[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < bounds.maxPages; page++) {
      const params = new URLSearchParams({ ...filters, limit: String(PAGE_SIZE) });
      if (cursor !== null) params.set('after', cursor);
      const envelope = parseBillingValue(
        z.object({
          success: z.literal(true),
          data: z.array(schema).max(PAGE_SIZE),
          pagination: paginationSchema,
        }),
        await get(path, params),
      );
      for (const item of envelope.data) {
        validate(item);
        items.push(item);
        if (items.length > bounds.maxItems) throw new GatewayReadError('binding_mismatch');
      }
      if (!envelope.pagination.hasMore) {
        if (envelope.pagination.next !== null) throw new GatewayReadError('pagination_invalid');
        return items;
      }
      const next = envelope.pagination.next;
      if (next === null || seenCursors.has(next)) throw new GatewayReadError('pagination_invalid');
      seenCursors.add(next);
      cursor = next;
    }
    throw new GatewayReadError('pagination_invalid');
  }

  return {
    async readStore(): Promise<{ id: string }> {
      // Store contains no documented devMode: this is NOT a sandbox attestation.
      return getOne('/stores/get', storeSchema);
    },
    async readProduct(id: string): Promise<AbacatePayProduct> {
      if (!resourceId('prod_').safeParse(id).success) throw new GatewayReadError('invalid_input');
      const product = await getOne('/products/get', productSchema, id);
      if (product.id !== id) throw new GatewayReadError('binding_mismatch');
      assertMode(product.devMode);
      return product;
    },
    async listProducts(): Promise<AbacatePayProduct[]> {
      return listAll('/products/list', productSchema, (product) => assertMode(product.devMode));
    },
    async readSubscription(id: string) {
      if (!resourceId('subs_').safeParse(id).success) throw new GatewayReadError('invalid_input');
      const subscription = await getOne('/subscriptions/get', subscriptionSchema, id);
      if (subscription.id !== id) throw new GatewayReadError('binding_mismatch');
      assertMode(subscription.devMode);
      return subscription;
    },
    async readSubscriptionCheckout(id: string): Promise<AbacatePaySubscriptionCheckout> {
      if (!resourceId('bill_').safeParse(id).success) throw new GatewayReadError('invalid_input');
      const checkout = await getOne('/subscriptions/checkouts/get', checkoutSchema, id);
      if (checkout.id !== id) throw new GatewayReadError('binding_mismatch');
      assertMode(checkout.devMode);
      return checkout;
    },
    async listSubscriptionCheckouts(): Promise<AbacatePaySubscriptionCheckout[]> {
      return listAll('/subscriptions/checkouts/list', checkoutSchema, (c) => assertMode(c.devMode));
    },
    async readSubscriptionCheckoutFinancials(id: string): Promise<AbacatePayCheckoutFinancials> {
      if (!resourceId('bill_').safeParse(id).success) throw new GatewayReadError('invalid_input');
      const checkout = await getOne('/subscriptions/checkouts/get', checkoutFinancialSchema, id);
      if (checkout.id !== id) throw new GatewayReadError('binding_mismatch');
      assertMode(checkout.devMode);
      return checkout;
    },
    async listSubscriptionsForCheckout(checkoutId: string) {
      if (!resourceId('bill_').safeParse(checkoutId).success) {
        throw new GatewayReadError('invalid_input');
      }
      return listAll(
        '/subscriptions/list',
        subscriptionSchema,
        (subscription) => {
          assertMode(subscription.devMode);
          if (subscription.checkoutId !== checkoutId)
            throw new GatewayReadError('binding_mismatch');
        },
        { checkoutId },
        // Initial checkout is owned by exactly one Qoro contract/customer.
        // More than one subscription is ambiguous, not a reason for a long scan.
        { maxPages: 2, maxItems: 1 },
      );
    },
  };
}

/** Store ID is verified before returning any subscription snapshot. */
export function createAbacatePaySubscriptionReader(
  accountInput: BillingAccount,
  config: AbacatePayReadConfig,
  fetcher: typeof fetch = fetch,
): SaasSubscriptionReader {
  const account = parseBillingValue(billingAccountSchema, accountInput);
  if (account.provider !== 'abacatepay' || account.environment !== config.environment) {
    throw new GatewayReadError('binding_mismatch');
  }
  const client = createAbacatePayReadClient(config, fetcher);
  return {
    account,
    async readSubscription(input): Promise<SubscriptionSnapshot> {
      validateReadInput(input);
      const store = await client.readStore();
      if (store.id !== account.accountId) throw new GatewayReadError('binding_mismatch');
      const subscription = await client.readSubscription(input.subscriptionId);
      if (subscription.customerId !== input.customerId)
        throw new GatewayReadError('binding_mismatch');
      return {
        account,
        subscriptionId: subscription.id,
        customerId: subscription.customerId,
        checkoutId: subscription.checkoutId,
        amountMinor: subscription.amount,
        currency: 'BRL',
        recurrence:
          subscription.status === 'ACTIVE'
            ? 'running'
            : subscription.status === 'CANCELLED'
              ? 'stopped'
              : subscription.status === 'PENDING'
                ? 'pending'
                : 'unknown',
        rawStatus: subscription.status,
        rawCycle: subscription.frequency ?? null,
        rawMethod: subscription.method,
        cycle:
          subscription.frequency === 'MONTHLY'
            ? 'monthly'
            : subscription.frequency === 'ANNUALLY'
              ? 'annual'
              : 'unknown',
        method:
          subscription.method === 'CARD'
            ? 'card'
            : subscription.method === 'PIX'
              ? 'pix'
              : 'unknown',
        // No GET field documented: never infer renewal from createdAt or status.
        nextChargeDate: null,
        trialEndsAt: subscription.trialEndsAt,
      };
    },
  };
}
