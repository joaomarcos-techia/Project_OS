import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
  change: vi.fn(),
  env: {
    NODE_ENV: 'production',
    VERCEL_ENV: 'production',
    ABACATEPAY_ENVIRONMENT: 'production',
    ABACATEPAY_STORE_ID: 'store_synthetic',
    ABACATEPAY_API_KEY: 'synthetic-no-network',
    ABACATEPAY_PLAN_PRODUCTS: '{"consultorio_2026":"prod_synthetic"}',
    ABACATEPAY_SANDBOX_PROBE_PRODUCT_ID: 'prod_synthetic',
    ABACATEPAY_SANDBOX_PLAN_PRODUCTS: '{"consultorio_2026":"prod_synthetic"}',
  },
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/payments/abacatepay/sandbox-commands', () => ({
  createAbacatePayCommands: () => ({ requestPlanChange: mocks.change }),
}));
vi.mock('./abacatepay-management', () => ({ getAbacatePayManagementContext: vi.fn() }));
vi.mock('./plan-changes', () => ({ assertTargetPlanCapacity: vi.fn() }));
vi.mock('./subscriptions', () => ({ recordBillingEvent: vi.fn() }));

import type { ManagementDatabase } from './abacatepay-management';
import { requestAbacatePayPlanChange } from './abacatepay-plan-changes';

const database: ManagementDatabase = {
  execute: mocks.execute,
  transaction: mocks.transaction,
};
const subscriptionId = '11111111-1111-4111-8111-111111111111';
const clinicId = '22222222-2222-4222-8222-222222222222';
const periodEnd = new Date('2026-12-17T10:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockReset();
  // The reservation transaction is already covered by the PostgreSQL harness.
  // This regression exercises its next step: the real consumed-checkout reader.
  mocks.transaction.mockResolvedValueOnce({
    current: {
      subscription_id: subscriptionId,
      external_subscription_id: 'subs_synthetic',
      external_checkout_id: 'bill_synthetic',
      external_customer_id: 'cust_synthetic',
    },
    intent: {
      id: subscriptionId,
      product_id: 'prod_synthetic',
      amount_minor: 19700,
      effective_not_before: periodEnd,
    },
  });
  mocks.transaction.mockResolvedValueOnce(undefined);
  mocks.change.mockResolvedValue({ changeId: 'change_synthetic' });
});

describe('plan-change consumed payment retains its environment (synthetic SQL boundary)', () => {
  it.each(['production', 'sandbox'] as const)(
    'reads the paid generation in %s before issuing a command',
    async (environment) => {
      Object.assign(mocks.env, {
        NODE_ENV: environment === 'production' ? 'production' : 'test',
        VERCEL_ENV: environment === 'production' ? 'production' : 'preview',
        ABACATEPAY_ENVIRONMENT: environment,
      });
      const dialect = new PgDialect();
      mocks.execute.mockImplementation(async (statement: SQL) => {
        const query = dialect.sqlToQuery(statement);
        if (query.sql.includes("to_regclass('billing_gateway.plan_changes')"))
          return [{ ready: true }];
        return query.params.includes(environment)
          ? [
              {
                clinic_id: clinicId,
                external_subscription_id: 'subs_synthetic',
                external_customer_id: 'cust_synthetic',
                product_id: 'prod_synthetic',
                amount_minor: '19700',
              },
            ]
          : [];
      });
      await expect(
        requestAbacatePayPlanChange(database, {
          clinicId,
          requestedBy: subscriptionId,
          contractId: subscriptionId,
          targetPlanId: subscriptionId,
        }),
      ).resolves.toEqual({ state: 'scheduled', effectiveNotBefore: periodEnd.toISOString() });
      expect(mocks.change).toHaveBeenCalledOnce();
      expect(mocks.execute).toHaveBeenCalledTimes(2);
    },
  );
});
