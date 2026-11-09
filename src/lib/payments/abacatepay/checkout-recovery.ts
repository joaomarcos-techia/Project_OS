import 'server-only';

import { z } from 'zod';

import { commandOperationFingerprint } from '../saas/command-operation';
import {
  billingAccountSchema,
  GatewayReadError,
  opaqueBillingId,
  parseBillingValue,
  type BillingAccount,
} from '../saas/contracts';
import { createAbacatePayReadClient, type AbacatePayReadConfig } from './reader';
import { createAbacatePayTransport } from './transport';

const resource = (prefix: string) => opaqueBillingId.refine((value) => value.startsWith(prefix));
const httpsUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
});
const hostedUrl = httpsUrl.refine((value) => {
  const url = new URL(value);
  return !url.port && ['app.abacatepay.com', 'pay.abacatepay.com'].includes(url.hostname);
});
const inputSchema = z
  .object({
    externalId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/),
    productId: resource('prod_'),
    expectedAmountMinor: z.number().int().positive().max(999_999_999_999),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    reservedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const checkoutSchema = z.object({
  id: resource('bill_'),
  externalId: z.string(),
  url: hostedUrl,
  frequency: z.literal('SUBSCRIPTION'),
  devMode: z.literal(true),
  amount: z.number().int().nonnegative().refine(Number.isSafeInteger),
  status: z.enum(['PENDING', 'PAID', 'EXPIRED', 'CANCELLED', 'REFUNDED']),
  paidAmount: z.number().int().nonnegative().refine(Number.isSafeInteger).nullable(),
  customerId: resource('cust_').nullable(),
  items: z.array(z.object({ id: resource('prod_'), quantity: z.literal(1) })).length(1),
  methods: z.array(z.literal('CARD')).length(1),
  returnUrl: httpsUrl.nullish(),
  completionUrl: httpsUrl.nullish(),
  createdAt: z.iso.datetime({ offset: true }),
});
const envelope = z.object({
  success: z.literal(true),
  data: z.array(checkoutSchema).max(100),
  pagination: z.object({ hasMore: z.boolean(), next: opaqueBillingId.nullable() }),
});
const MAX_PAGES = 5;
const CLOCK_SKEW_MS = 60_000;

export type RecoveredCheckout = {
  checkoutId: string;
  externalId: string;
  amountMinor: number;
  environment: 'sandbox';
  state: 'pending';
  checkoutUrl: string;
};

/** A recovered creation result is not a current payment snapshot or an access grant. */
export function createAbacatePayCheckoutRecoveryReader(
  accountInput: BillingAccount,
  config: AbacatePayReadConfig,
  fetcher: typeof fetch = fetch,
) {
  const account = billingAccountSchema.parse(accountInput);
  if (
    account.provider !== 'abacatepay' ||
    account.environment !== 'sandbox' ||
    config.environment !== 'sandbox'
  )
    throw new GatewayReadError('environment_mismatch');
  const read = createAbacatePayReadClient(config, fetcher);
  const request = createAbacatePayTransport(config, fetcher);
  return {
    async discover(
      raw: z.input<typeof inputSchema>,
    ): Promise<
      { state: 'absent' } | { state: 'found'; result: RecoveredCheckout; currentStatus: string }
    > {
      const parsed = inputSchema.safeParse(raw);
      if (!parsed.success) throw new GatewayReadError('invalid_input');
      const expected = parsed.data;
      if ((await read.readStore()).id !== account.accountId)
        throw new GatewayReadError('binding_mismatch');
      const product = await read.readProduct(expected.productId);
      if (
        product.cycle !== 'MONTHLY' ||
        product.trialDays != null ||
        product.price !== expected.expectedAmountMinor
      )
        throw new GatewayReadError('binding_mismatch');
      const ids = new Set<string>(),
        cursors = new Set<string>();
      let cursor: string | null = null,
        candidate: z.infer<typeof checkoutSchema> | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({ externalId: expected.externalId, limit: '100' });
        if (cursor) params.set('after', cursor);
        const response = parseBillingValue(
          envelope,
          await request({ method: 'GET', path: '/subscriptions/checkouts/list', params }),
        );
        for (const item of response.data) {
          if (ids.has(item.id)) throw new GatewayReadError('pagination_invalid');
          ids.add(item.id);
          if (item.externalId !== expected.externalId || candidate)
            throw new GatewayReadError('binding_mismatch');
          candidate = item;
        }
        if (response.pagination.hasMore) {
          const next = response.pagination.next;
          if (!next || cursors.has(next)) throw new GatewayReadError('pagination_invalid');
          cursors.add(next);
          cursor = next;
          continue;
        }
        if (response.pagination.next !== null) throw new GatewayReadError('pagination_invalid');
        if (!candidate) return { state: 'absent' };
        const selectedId = candidate.id;
        candidate = parseBillingValue(
          z.object({ success: z.literal(true), data: checkoutSchema }),
          await request({
            method: 'GET',
            path: '/subscriptions/checkouts/get',
            params: new URLSearchParams({ id: selectedId }),
          }),
        ).data;
        if (candidate.id !== selectedId || candidate.externalId !== expected.externalId)
          throw new GatewayReadError('binding_mismatch');
        const parameters = {
          externalId: expected.externalId,
          productId: expected.productId,
          expectedAmountMinor: expected.expectedAmountMinor,
          expectedCycle: 'MONTHLY',
          expectedNativeTrialDays: null,
          ...(candidate.returnUrl == null ? {} : { returnUrl: candidate.returnUrl }),
          ...(candidate.completionUrl == null ? {} : { completionUrl: candidate.completionUrl }),
        };
        if (
          candidate.amount !== expected.expectedAmountMinor ||
          candidate.items[0]?.id !== expected.productId ||
          Date.parse(candidate.createdAt) < Date.parse(expected.reservedAt) - CLOCK_SKEW_MS ||
          Date.parse(candidate.createdAt) > Date.now() + CLOCK_SKEW_MS ||
          commandOperationFingerprint('create_subscription_checkout', parameters) !==
            expected.requestFingerprint
        )
          throw new GatewayReadError('binding_mismatch');
        return {
          state: 'found',
          currentStatus: candidate.status,
          result: {
            checkoutId: candidate.id,
            externalId: expected.externalId,
            amountMinor: expected.expectedAmountMinor,
            environment: 'sandbox',
            state: 'pending',
            checkoutUrl: candidate.url,
          },
        };
      }
      throw new GatewayReadError('pagination_invalid');
    },
  };
}
