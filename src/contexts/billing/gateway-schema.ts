/** Private infrastructure namespace for SaaS only; no direct browser access. */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { invoices, prices, subscriptions } from './schema';

const gateway = pgSchema('billing_gateway');
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const gatewayAccounts = gateway.table(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider', { enum: ['asaas', 'abacatepay'] }).notNull(),
    environment: text('environment', { enum: ['sandbox', 'production'] }).notNull(),
    externalAccountId: text('external_account_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    identity: unique().on(t.provider, t.environment, t.externalAccountId),
    providerCheck: check('accounts_provider_check', sql`${t.provider} IN ('asaas','abacatepay')`),
    environmentCheck: check(
      'accounts_environment_check',
      sql`${t.environment} IN ('sandbox','production')`,
    ),
  }),
);

export const gatewayBindings = gateway.table(
  'bindings',
  {
    subscriptionId: uuid('subscription_id').primaryKey(),
    clinicId: uuid('clinic_id').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => gatewayAccounts.id, { onDelete: 'restrict' }),
    externalCustomerId: text('external_customer_id'),
    externalCheckoutId: text('external_checkout_id'),
    externalSubscriptionId: text('external_subscription_id'),
    createdAt: createdAt(),
  },
  (t) => ({
    subscription: foreignKey({
      columns: [t.subscriptionId, t.clinicId],
      foreignColumns: [subscriptions.id, subscriptions.clinicId],
    }).onDelete('restrict'),
    origin: unique().on(t.subscriptionId, t.clinicId, t.accountId),
    externalSubscription: unique().on(t.accountId, t.externalSubscriptionId),
    externalCheckout: unique().on(t.accountId, t.externalCheckoutId),
    customerCheck: check(
      'bindings_check',
      sql`${t.externalSubscriptionId} IS NULL OR ${t.externalCustomerId} IS NOT NULL`,
    ),
  }),
);

export const gatewayOperations = gateway.table(
  'operations',
  {
    accountId: uuid('account_id').notNull(),
    operationId: uuid('operation_id').notNull(),
    subscriptionId: uuid('subscription_id').notNull(),
    clinicId: uuid('clinic_id').notNull(),
    kind: text('kind', {
      enum: [
        'create_checkout',
        'change_plan',
        'cancel_subscription',
        'proration_checkout',
        'recontract_checkout',
        'close_paid_checkout',
        'close_unpaid_checkout',
        'replace_checkout',
      ],
    }).notNull(),
    businessKey: text('business_key').notNull(),
    requestHash: text('request_hash').notNull(),
    state: text('state', { enum: ['running', 'confirmed', 'unknown'] }).notNull(),
    result: jsonb('result'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.accountId, t.operationId] }),
    obligation: unique().on(t.subscriptionId, t.kind, t.businessKey),
    initialCheckout: uniqueIndex('gateway_initial_checkout_subscription_unique')
      .on(t.subscriptionId)
      .where(sql`${t.kind} = 'create_checkout'`),
    binding: foreignKey({
      columns: [t.subscriptionId, t.clinicId, t.accountId],
      foreignColumns: [
        gatewayBindings.subscriptionId,
        gatewayBindings.clinicId,
        gatewayBindings.accountId,
      ],
    }).onDelete('restrict'),
  }),
);

export const gatewayEventInbox = gateway.table(
  'event_inbox',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => gatewayAccounts.id, { onDelete: 'restrict' }),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payloadHash: text('payload_hash').notNull(),
    subscriptionId: uuid('subscription_id'),
    clinicId: uuid('clinic_id'),
    externalSubscriptionId: text('external_subscription_id'),
    externalCheckoutId: text('external_checkout_id'),
    externalPaymentId: text('external_payment_id'),
    externalCustomerId: text('external_customer_id'),
    state: text('state', { enum: ['received', 'processing', 'applied', 'ignored', 'review'] })
      .notNull()
      .default('received'),
    attempts: integer('attempts').notNull().default(0),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    leaseToken: uuid('lease_token'),
    outcomeCode: text('outcome_code'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.accountId, t.eventId] }),
    recovery: index('event_inbox_recovery_idx').on(t.state, t.leaseUntil, t.receivedAt),
    binding: foreignKey({
      columns: [t.subscriptionId, t.clinicId, t.accountId],
      foreignColumns: [
        gatewayBindings.subscriptionId,
        gatewayBindings.clinicId,
        gatewayBindings.accountId,
      ],
    }).onDelete('restrict'),
  }),
);

export const gatewayTrialClaims = gateway.table(
  'trial_claims',
  {
    authUserId: uuid('auth_user_id').primaryKey(),
    emailHash: text('email_hash').notNull().unique(),
    // FK to the owning clinic is declared by migration (cross-context boundary).
    clinicId: uuid('clinic_id'),
    authCreatedAt: timestamp('auth_created_at', { withTimezone: true }).notNull(),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    deadline: check(
      'trial_claims_check',
      sql`${t.trialEndsAt} = ${t.authCreatedAt} + interval '336 hours'`,
    ),
  }),
);

export const gatewayCheckoutIntents = gateway.table(
  'checkout_intents',
  {
    subscriptionId: uuid('subscription_id').primaryKey(),
    clinicId: uuid('clinic_id').notNull(),
    accountId: uuid('account_id').notNull(),
    priceId: uuid('price_id')
      .notNull()
      .references(() => prices.id, { onDelete: 'restrict' }),
    productId: text('product_id').notNull(),
    // int53-safe bound is additionally enforced in SQL; monetary DTOs use cents.
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    binding: foreignKey({
      columns: [t.subscriptionId, t.clinicId, t.accountId],
      foreignColumns: [
        gatewayBindings.subscriptionId,
        gatewayBindings.clinicId,
        gatewayBindings.accountId,
      ],
    }).onDelete('restrict'),
  }),
);

export const gatewayPaidCheckouts = gateway.table(
  'paid_checkouts',
  {
    accountId: uuid('account_id').notNull(),
    checkoutId: text('checkout_id').notNull(),
    subscriptionId: uuid('subscription_id').notNull(),
    clinicId: uuid('clinic_id').notNull(),
    invoiceId: uuid('invoice_id').notNull().unique(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.accountId, t.checkoutId] }),
    binding: foreignKey({
      columns: [t.subscriptionId, t.clinicId, t.accountId],
      foreignColumns: [
        gatewayBindings.subscriptionId,
        gatewayBindings.clinicId,
        gatewayBindings.accountId,
      ],
    }).onDelete('restrict'),
    invoice: foreignKey({
      columns: [t.invoiceId, t.clinicId, t.subscriptionId],
      foreignColumns: [invoices.id, invoices.clinicId, invoices.subscriptionId],
    }).onDelete('restrict'),
  }),
);
