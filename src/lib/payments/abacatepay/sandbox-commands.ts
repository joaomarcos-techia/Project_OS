import 'server-only';

import { z } from 'zod';

import { executeCommandOnce, type CommandOperationJournal } from '../saas/command-operation';
import {
  billingAccountSchema,
  GatewayReadError,
  opaqueBillingId,
  parseBillingValue,
} from '../saas/contracts';
import { createAbacatePayReadClient, type AbacatePayReadConfig } from './reader';
import { createAbacatePayTransport } from './transport';

const prefixedId = (prefix: string) => opaqueBillingId.refine((id) => id.startsWith(prefix));
const amount = z.number().int().positive().max(999_999_999_999);
const cycle = z.enum(['MONTHLY', 'ANNUALLY']);
const operation = z.object({ operationId: z.uuid() });
const externalId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/);
const productInput = operation
  .extend({
    externalId,
    name: z.string().trim().min(1).max(120),
    amountMinor: amount,
    cycle,
    trialDays: z.number().int().min(1).max(90).optional(),
  })
  .strict();
const checkoutInput = operation
  .extend({
    externalId,
    productId: prefixedId('prod_'),
    expectedAmountMinor: amount,
    expectedCycle: cycle,
    expectedNativeTrialDays: z.number().int().min(1).max(90).nullable(),
    methods: z
      .array(z.enum(['CARD', 'PIX']))
      .min(1)
      .max(2)
      .refine((methods) => new Set(methods).size === methods.length)
      .optional(),
    returnUrl: z
      .url()
      .refine((value) => new URL(value).protocol === 'https:')
      .optional(),
    completionUrl: z
      .url()
      .refine((value) => new URL(value).protocol === 'https:')
      .optional(),
  })
  .strict();
const subscriptionInput = operation
  .extend({
    subscriptionId: prefixedId('subs_'),
    customerId: prefixedId('cust_'),
  })
  .strict();
const changeInput = subscriptionInput
  .extend({
    productId: prefixedId('prod_'),
    expectedAmountMinor: amount,
    expectedCycle: cycle,
  })
  .strict();
const closeInput = subscriptionInput
  .extend({
    checkoutId: prefixedId('bill_'),
    productId: prefixedId('prod_'),
    expectedAmountMinor: amount,
  })
  .strict();
const closeUnpaidInput = operation
  .extend({
    checkoutId: prefixedId('bill_'),
    externalId,
    productId: prefixedId('prod_'),
    expectedAmountMinor: amount,
  })
  .strict();
const closeResult = z
  .object({
    checkoutId: prefixedId('bill_'),
    subscriptionId: prefixedId('subs_'),
    customerId: prefixedId('cust_'),
    productId: prefixedId('prod_'),
    amountMinor: amount,
    closed: z.literal(true),
  })
  .strict();
const productResultShape = z.object({
  id: prefixedId('prod_'),
  externalId,
  price: amount,
  currency: z.literal('BRL'),
  devMode: z.boolean(),
  cycle,
  trialDays: z.number().int().min(1).max(90).nullable(),
});
const hostedUrl = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    !url.port &&
    ['app.abacatepay.com', 'pay.abacatepay.com'].includes(url.hostname)
  );
});
const checkoutResultShape = z.object({
  checkoutId: prefixedId('bill_'),
  externalId,
  amountMinor: z.number().int().nonnegative(),
  environment: z.enum(['sandbox', 'production']),
  state: z.literal('pending'),
  checkoutUrl: hostedUrl,
});
const changeResult = z.object({
  changeId: prefixedId('subu_'),
  subscriptionId: prefixedId('subs_'),
  productId: prefixedId('prod_'),
  amountMinor: amount,
  state: z.literal('pending'),
  effective: z.literal('next_cycle'),
});
const cancelResult = z.object({
  subscriptionId: prefixedId('subs_'),
  customerId: prefixedId('cust_'),
  recurrence: z.literal('stopped'),
});
const createdId = z.object({ success: z.literal(true), data: z.object({ id: opaqueBillingId }) });
const checkoutDetailsShape = z.object({
  success: z.literal(true),
  data: z.object({
    id: prefixedId('bill_'),
    frequency: z.literal('SUBSCRIPTION'),
    externalId,
    amount: z.number().int().nonnegative(),
    devMode: z.boolean(),
    status: z.literal('PENDING'),
    customerId: z.null(),
    url: hostedUrl,
    items: z.array(z.object({ id: prefixedId('prod_'), quantity: z.literal(1) })).length(1),
    methods: z
      .array(z.enum(['CARD', 'PIX']))
      .min(1)
      .max(2),
  }),
});

function inputValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new GatewayReadError('invalid_input');
  return parsed.data;
}

/**
 * Explicit account composition. No customer creation, payment simulation,
 * access grant or gateway fallback is exposed.
 * Closing a consumed checkout is explicit, journaled and never retried.
 * Every attempted command requires a durable journal and a fresh environment
 * read. Product/checkout creation does not claim a subscription exists or is paid.
 */
export function createAbacatePayCommands(
  config: AbacatePayReadConfig & { storeId: string; probeProductId: string | undefined },
  journal: CommandOperationJournal,
  fetcher: typeof fetch = fetch,
  consumedOrigin?: {
    subscriptionId: string;
    customerId: string;
    checkoutId: string;
    productId: string;
  },
) {
  const account = inputValue(billingAccountSchema, {
    provider: 'abacatepay',
    environment: config.environment,
    accountId: config.storeId,
  });
  const probeProductId = inputValue(prefixedId('prod_'), config.probeProductId);
  if (!account.accountId.startsWith('store_')) throw new GatewayReadError('invalid_input');
  const expectedDevMode = account.environment === 'sandbox';
  const productResult = productResultShape.extend({ devMode: z.literal(expectedDevMode) });
  const checkoutResult = checkoutResultShape.extend({
    environment: z.literal(account.environment),
  });
  const checkoutDetails = checkoutDetailsShape.extend({
    data: checkoutDetailsShape.shape.data.extend({ devMode: z.literal(expectedDevMode) }),
  });
  const read = createAbacatePayReadClient(config, fetcher);
  const request = createAbacatePayTransport(config, fetcher);

  async function attest(): Promise<void> {
    const store = await read.readStore();
    if (store.id !== account.accountId) throw new GatewayReadError('binding_mismatch');
    await read.readProduct(probeProductId);
  }
  async function execute<T>(
    id: string,
    kind: string,
    parameters: unknown,
    schema: z.ZodType<T>,
    perform: () => Promise<T>,
  ): Promise<T> {
    return executeCommandOnce({
      account,
      operationId: id,
      kind,
      parameters,
      resultSchema: schema,
      journal,
      execute: async () => {
        await attest();
        return perform();
      },
    });
  }

  return {
    account,
    /** Operator-only replacement seam. Never cancels or refunds a subscription. */
    async closeUnpaidCheckout(raw: z.input<typeof closeUnpaidInput>) {
      const input = inputValue(closeUnpaidInput, raw);
      const parameters = { ...input, operationId: undefined };
      const resultSchema = z.object({
        checkoutId: z.literal(input.checkoutId),
        productId: z.literal(input.productId),
        amountMinor: z.literal(input.expectedAmountMinor),
        closed: z.literal(true),
      });
      return execute(
        input.operationId,
        'close_unpaid_checkout',
        parameters,
        resultSchema,
        async () => {
          const product = await read.readProduct(input.productId);
          if (
            product.price !== input.expectedAmountMinor ||
            product.cycle !== 'MONTHLY' ||
            product.trialDays != null
          )
            throw new GatewayReadError('binding_mismatch');
          const listed = async () =>
            parseBillingValue(
              z.object({
                success: z.literal(true),
                data: z
                  .array(
                    z.object({
                      id: prefixedId('bill_'),
                      externalId,
                      devMode: z.literal(expectedDevMode),
                    }),
                  )
                  .max(1),
                pagination: z.object({ hasMore: z.literal(false), next: z.null() }),
              }),
              await request({
                method: 'GET',
                path: '/subscriptions/checkouts/list',
                params: new URLSearchParams({ externalId: input.externalId, limit: '100' }),
              }),
            ).data;
          const unpaid = async () => {
            const checkout = await read.readSubscriptionCheckoutFinancials(input.checkoutId);
            if (
              checkout.status !== 'PENDING' ||
              checkout.customerId !== null ||
              checkout.amount !== input.expectedAmountMinor ||
              (checkout.paidAmount ?? 0) !== 0 ||
              checkout.items.length !== 1 ||
              checkout.items[0]?.id !== input.productId ||
              checkout.items[0]?.quantity !== 1 ||
              (await read.listSubscriptionsForCheckout(input.checkoutId)).length !== 0
            )
              throw new GatewayReadError('binding_mismatch');
          };
          const before = await listed();
          if (
            before.length !== 1 ||
            before[0]?.id !== input.checkoutId ||
            before[0]?.externalId !== input.externalId
          )
            throw new GatewayReadError('binding_mismatch');
          await unpaid();
          const response = parseBillingValue(
            z.object({
              success: z.literal(true),
              data: z.object({
                id: z.literal(input.checkoutId),
                devMode: z.literal(expectedDevMode),
              }),
            }),
            await request({
              method: 'POST',
              path: '/subscriptions/checkouts/delete',
              params: new URLSearchParams({ id: input.checkoutId }),
              body: {},
            }),
          );
          if (!response.success || (await listed()).length !== 0)
            throw new GatewayReadError('binding_mismatch');
          // Deleted links remain readable by GET. It must still show no payment or subscription.
          await unpaid();
          return {
            checkoutId: input.checkoutId,
            productId: input.productId,
            amountMinor: input.expectedAmountMinor,
            closed: true as const,
          };
        },
      );
    },
    async closePaidCheckout(raw: z.input<typeof closeInput>) {
      const input = inputValue(closeInput, raw);
      const parameters = {
        checkoutId: input.checkoutId,
        subscriptionId: input.subscriptionId,
        customerId: input.customerId,
        productId: input.productId,
        expectedAmountMinor: input.expectedAmountMinor,
      };
      const resultSchema = closeResult.refine(
        (value) =>
          value.checkoutId === input.checkoutId &&
          value.subscriptionId === input.subscriptionId &&
          value.customerId === input.customerId &&
          value.productId === input.productId &&
          value.amountMinor === input.expectedAmountMinor,
      );
      return execute(
        input.operationId,
        'close_paid_checkout',
        parameters,
        resultSchema,
        async () => {
          const checkout = await read.readSubscriptionCheckoutFinancials(input.checkoutId);
          const before = await read.readSubscription(input.subscriptionId);
          const linked = await read.listSubscriptionsForCheckout(input.checkoutId);
          if (
            checkout.status !== 'PAID' ||
            checkout.customerId !== input.customerId ||
            checkout.amount !== input.expectedAmountMinor ||
            checkout.paidAmount !== input.expectedAmountMinor ||
            checkout.items.length !== 1 ||
            checkout.items[0]?.id !== input.productId ||
            checkout.items[0]?.quantity !== 1 ||
            before.checkoutId !== input.checkoutId ||
            before.customerId !== input.customerId ||
            !['CARD', 'PIX'].includes(before.method) ||
            before.trialEndsAt !== null ||
            !['ACTIVE', 'CANCELLED'].includes(before.status) ||
            linked.length !== 1 ||
            linked[0]?.id !== input.subscriptionId ||
            linked[0]?.customerId !== input.customerId
          )
            throw new GatewayReadError('binding_mismatch');
          const response = parseBillingValue(
            z.object({
              success: z.literal(true),
              data: z.object({
                id: prefixedId('bill_'),
                devMode: z.literal(expectedDevMode),
              }),
            }),
            await request({
              method: 'POST',
              path: '/subscriptions/checkouts/delete',
              params: new URLSearchParams({ id: input.checkoutId }),
              body: {},
            }),
          );
          if (response.data.id !== input.checkoutId) throw new GatewayReadError('binding_mismatch');
          const after = await read.readSubscription(input.subscriptionId);
          const remaining = await read.listSubscriptionsForCheckout(input.checkoutId);
          if (
            after.checkoutId !== before.checkoutId ||
            after.customerId !== before.customerId ||
            after.status !== before.status ||
            after.method !== before.method ||
            after.amount !== before.amount ||
            remaining.length !== 1 ||
            remaining[0]?.id !== before.id ||
            remaining[0]?.customerId !== before.customerId
          )
            throw new GatewayReadError('binding_mismatch');
          return {
            checkoutId: input.checkoutId,
            subscriptionId: input.subscriptionId,
            customerId: input.customerId,
            productId: input.productId,
            amountMinor: input.expectedAmountMinor,
            closed: true as const,
          };
        },
      );
    },
    async createProduct(raw: z.input<typeof productInput>) {
      const input = inputValue(productInput, raw);
      const body = {
        externalId: input.externalId,
        name: input.name,
        price: input.amountMinor,
        currency: 'BRL',
        cycle: input.cycle,
        ...(input.trialDays === undefined ? {} : { trialDays: input.trialDays }),
      };
      const schema = productResult.refine(
        (value) =>
          value.externalId === input.externalId &&
          value.price === input.amountMinor &&
          value.cycle === input.cycle &&
          value.trialDays === (input.trialDays ?? null),
      );
      return execute(input.operationId, 'create_product', body, schema, async () => {
        const response = parseBillingValue(
          createdId,
          await request({ method: 'POST', path: '/products/create', body }),
        );
        const product = await read.readProduct(response.data.id);
        return parseBillingValue(schema, { ...product, trialDays: product.trialDays ?? null });
      });
    },
    async createSubscriptionCheckout(raw: z.input<typeof checkoutInput>) {
      const input = inputValue(checkoutInput, raw);
      if (input.methods?.includes('PIX') && input.expectedNativeTrialDays !== null)
        throw new GatewayReadError('invalid_input');
      const parameters = { ...input, operationId: undefined };
      const schema = checkoutResult.refine(
        (value) =>
          value.externalId === input.externalId &&
          (value.amountMinor === input.expectedAmountMinor ||
            (input.expectedNativeTrialDays !== null && value.amountMinor === 0)),
      );
      return execute(
        input.operationId,
        'create_subscription_checkout',
        parameters,
        schema,
        async () => {
          const product = await read.readProduct(input.productId);
          if (
            product.price !== input.expectedAmountMinor ||
            product.cycle !== input.expectedCycle ||
            (product.trialDays ?? null) !== input.expectedNativeTrialDays
          ) {
            throw new GatewayReadError('binding_mismatch');
          }
          const body = {
            items: [{ id: product.id, quantity: 1 }],
            methods: input.methods ?? ['CARD'],
            externalId: input.externalId,
            metadata:
              account.environment === 'sandbox'
                ? { qoroSandboxReference: input.externalId }
                : { qoroReference: input.externalId },
            ...((input.methods ?? ['CARD']).includes('CARD')
              ? { retryPolicy: { maxRetry: 3, retryEvery: 1 } }
              : {}),
            ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
            ...(input.completionUrl ? { completionUrl: input.completionUrl } : {}),
          };
          const response = parseBillingValue(
            createdId,
            await request({ method: 'POST', path: '/subscriptions/create', body }),
          );
          const details = parseBillingValue(
            checkoutDetails,
            await request({
              method: 'GET',
              path: '/subscriptions/checkouts/get',
              params: new URLSearchParams({ id: response.data.id }),
            }),
          ).data;
          if (
            details.id !== response.data.id ||
            details.items[0]?.id !== input.productId ||
            JSON.stringify(details.methods) !== JSON.stringify(body.methods) ||
            details.externalId !== input.externalId
          )
            throw new GatewayReadError('binding_mismatch');
          return parseBillingValue(schema, {
            checkoutId: details.id,
            externalId: details.externalId,
            amountMinor: details.amount,
            environment: account.environment,
            state: 'pending',
            checkoutUrl: details.url,
          });
        },
      );
    },
    async requestPlanChange(raw: z.input<typeof changeInput>) {
      const input = inputValue(changeInput, raw);
      const parameters = { ...input, operationId: undefined };
      const schema = changeResult.refine(
        (value) =>
          value.subscriptionId === input.subscriptionId &&
          value.productId === input.productId &&
          value.amountMinor === input.expectedAmountMinor,
      );
      return execute(input.operationId, 'request_plan_change', parameters, schema, async () => {
        const subscription = await read.readSubscription(input.subscriptionId);
        const product = await read.readProduct(input.productId);
        // GET does not promise frequency. Prove it through the paid origin product
        // when absent; never infer a cycle from ACTIVE or the requested target.
        let originalCycle = subscription.frequency;
        if (originalCycle === undefined && subscription.checkoutId) {
          if (
            consumedOrigin &&
            consumedOrigin.subscriptionId === subscription.id &&
            consumedOrigin.customerId === subscription.customerId &&
            consumedOrigin.checkoutId === subscription.checkoutId
          ) {
            const originalProduct = await read.readProduct(consumedOrigin.productId);
            if (originalProduct.trialDays == null)
              originalCycle = originalProduct.cycle ?? undefined;
          } else {
            const origin = await read.readSubscriptionCheckoutFinancials(subscription.checkoutId);
            if (
              origin.status === 'PAID' &&
              origin.customerId === input.customerId &&
              origin.amount === origin.paidAmount &&
              origin.items.length === 1 &&
              origin.items[0]?.quantity === 1
            ) {
              const originalProduct = await read.readProduct(origin.items[0].id);
              if (originalProduct.trialDays == null)
                originalCycle = originalProduct.cycle ?? undefined;
            }
          }
        }
        if (
          subscription.customerId !== input.customerId ||
          subscription.status !== 'ACTIVE' ||
          !['CARD', 'PIX'].includes(subscription.method) ||
          (subscription.method === 'PIX' && subscription.amount !== input.expectedAmountMinor) ||
          originalCycle !== input.expectedCycle ||
          product.cycle !== input.expectedCycle ||
          product.price !== input.expectedAmountMinor ||
          product.trialDays != null
        ) {
          throw new GatewayReadError('binding_mismatch');
        }
        const response = parseBillingValue(
          z.object({
            success: z.literal(true),
            data: z.object({
              id: prefixedId('subu_'),
              subscriptionId: prefixedId('subs_'),
              productId: prefixedId('prod_'),
              quantity: z.literal(1),
              status: z.literal('PENDING'),
              newAmount: amount,
            }),
          }),
          await request({
            method: 'POST',
            path: '/subscriptions/change-plan',
            body: {
              id: input.subscriptionId,
              productId: input.productId,
              quantity: 1,
            },
          }),
        );
        return parseBillingValue(schema, {
          changeId: response.data.id,
          subscriptionId: response.data.subscriptionId,
          productId: response.data.productId,
          amountMinor: response.data.newAmount,
          state: 'pending',
          effective: 'next_cycle',
        });
      });
    },
    async cancelSubscription(raw: z.input<typeof subscriptionInput>) {
      const input = inputValue(subscriptionInput, raw);
      const parameters = { subscriptionId: input.subscriptionId, customerId: input.customerId };
      const schema = cancelResult.refine(
        (value) =>
          value.subscriptionId === input.subscriptionId && value.customerId === input.customerId,
      );
      return execute(input.operationId, 'cancel_subscription', parameters, schema, async () => {
        const initial = await read.readSubscription(input.subscriptionId);
        if (initial.customerId !== input.customerId) throw new GatewayReadError('binding_mismatch');
        if (initial.status !== 'CANCELLED') {
          if (initial.status !== 'ACTIVE') throw new GatewayReadError('invalid_response');
          const response = parseBillingValue(
            z.object({
              success: z.literal(true),
              data: z.object({
                id: prefixedId('subs_'),
                customerId: prefixedId('cust_'),
                status: z.literal('CANCELLED'),
                devMode: z.literal(expectedDevMode),
              }),
            }),
            await request({
              method: 'POST',
              path: '/subscriptions/cancel',
              body: { id: input.subscriptionId },
            }),
          );
          if (
            response.data.id !== input.subscriptionId ||
            response.data.customerId !== input.customerId
          ) {
            throw new GatewayReadError('binding_mismatch');
          }
        }
        const confirmed = await read.readSubscription(input.subscriptionId);
        if (confirmed.customerId !== input.customerId || confirmed.status !== 'CANCELLED') {
          throw new GatewayReadError('binding_mismatch');
        }
        return {
          subscriptionId: input.subscriptionId,
          customerId: input.customerId,
          recurrence: 'stopped' as const,
        };
      });
    },
  };
}

/** Compatibility seam: a Sandbox caller can never opt into live through config. */
export function createAbacatePaySandboxCommands(
  config: { apiKey: string; storeId: string; probeProductId: string; timeoutMs?: number },
  journal: CommandOperationJournal,
  fetcher: typeof fetch = fetch,
  consumedOrigin?: {
    subscriptionId: string;
    customerId: string;
    checkoutId: string;
    productId: string;
  },
) {
  return createAbacatePayCommands(
    { ...config, environment: 'sandbox' },
    journal,
    fetcher,
    consumedOrigin,
  );
}
