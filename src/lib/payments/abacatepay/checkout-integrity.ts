import 'server-only';

import { z } from 'zod';
import {
  billingAccountSchema,
  GatewayReadError,
  opaqueBillingId,
  parseBillingValue,
  type BillingAccount,
} from '../saas/contracts';
import type {
  CheckoutRecurrenceInput,
  CheckoutRecurrenceObservation,
} from '../saas/recurrence-integrity';
import { createAbacatePayReadClient, type AbacatePayReadConfig } from './reader';
import { createAbacatePayTransport } from './transport';

const resource = (prefix: string) => opaqueBillingId.refine((id) => id.startsWith(prefix));
const inputSchema = z
  .object({
    checkoutId: resource('bill_'),
    subscriptionId: resource('subs_').nullable(),
    customerId: resource('cust_').nullable(),
  })
  .strict()
  .refine((input) => (input.subscriptionId === null) === (input.customerId === null));
const listedSchema = z.object({
  id: resource('subs_'),
  checkoutId: resource('bill_'),
  customerId: resource('cust_'),
  devMode: z.boolean(),
});
const pageSchema = z.object({
  success: z.literal(true),
  data: z.array(listedSchema).max(100),
  pagination: z.object({ hasMore: z.boolean(), next: opaqueBillingId.nullable() }),
});

/** Bounded inspection is separate from the single-subscription payment reader. */
export function createAbacatePayCheckoutIntegrityReader(
  accountInput: BillingAccount,
  config: AbacatePayReadConfig,
  fetcher: typeof fetch = fetch,
) {
  const account = billingAccountSchema.parse(accountInput);
  if (account.provider !== 'abacatepay' || account.environment !== config.environment)
    throw new GatewayReadError('environment_mismatch');
  const read = createAbacatePayReadClient(config, fetcher),
    request = createAbacatePayTransport(config, fetcher);
  return {
    async inspect(raw: CheckoutRecurrenceInput): Promise<CheckoutRecurrenceObservation> {
      const parsed = inputSchema.safeParse(raw);
      if (!parsed.success) throw new GatewayReadError('invalid_input');
      const input = parsed.data;
      if ((await read.readStore()).id !== account.accountId)
        throw new GatewayReadError('binding_mismatch');
      const bound = input.subscriptionId ? await read.readSubscription(input.subscriptionId) : null;
      if (bound && (bound.checkoutId !== input.checkoutId || bound.customerId !== input.customerId))
        throw new GatewayReadError('binding_mismatch');
      const seen = new Map<string, z.infer<typeof listedSchema>>(),
        cursors = new Set<string>();
      let cursor: string | null = null;
      for (let page = 0; page < 2; page++) {
        const params = new URLSearchParams({ checkoutId: input.checkoutId, limit: '2' });
        if (cursor) params.set('after', cursor);
        const response = parseBillingValue(
          pageSchema,
          await request({ method: 'GET', path: '/subscriptions/list', params }),
        );
        for (const item of response.data) {
          if (item.devMode !== (account.environment === 'sandbox'))
            throw new GatewayReadError('environment_mismatch');
          if (item.checkoutId !== input.checkoutId) throw new GatewayReadError('binding_mismatch');
          const previous = seen.get(item.id);
          if (previous) throw new GatewayReadError('pagination_invalid');
          seen.set(item.id, item);
        }
        if (
          (!response.pagination.hasMore && response.pagination.next !== null) ||
          (response.pagination.hasMore &&
            (!response.pagination.next || cursors.has(response.pagination.next)))
        )
          throw new GatewayReadError('pagination_invalid');
        const ids = [...seen.keys()].sort();
        const base = {
          account,
          checkoutId: input.checkoutId,
          expectedSubscriptionId: input.subscriptionId,
          observedSubscriptionIds: ids.slice(0, 2),
          complete: !response.pagination.hasMore && ids.length <= 2,
          ...(bound?.currentPeriodStart &&
          bound.currentPeriodEnd &&
          bound.currentPeriodEnd > bound.currentPeriodStart
            ? {
                providerPaidPeriod: {
                  start: bound.currentPeriodStart,
                  end: bound.currentPeriodEnd,
                },
              }
            : {}),
        };
        if (ids.length > 1)
          return { ...base, issue: 'multiple_subscriptions', recurrence: 'unknown' };
        if (!response.pagination.hasMore) {
          const listed = ids[0] ? seen.get(ids[0]) : undefined;
          const issue =
            bound && !listed
              ? 'missing_subscription'
              : bound && (listed?.id !== bound.id || listed.customerId !== input.customerId)
                ? 'subscription_mismatch'
                : bound?.trialEndsAt != null
                  ? 'native_trial'
                  : null;
          return {
            ...base,
            issue,
            recurrence: !bound
              ? 'unbound'
              : bound.status === 'ACTIVE'
                ? 'running'
                : bound.status === 'CANCELLED'
                  ? 'stopped'
                  : 'unknown',
          };
        }
        cursor = response.pagination.next;
        if (cursor) cursors.add(cursor);
      }
      throw new GatewayReadError('pagination_invalid');
    },
  };
}
