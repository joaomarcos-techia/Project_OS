import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const mocks = vi.hoisted(() => ({
  management: vi.fn(),
  capacity: vi.fn(),
  event: vi.fn(),
  runtime: vi.fn(),
}));
vi.mock('@/lib/payments/saas/acquisition', () => ({ assertAbacatePayRuntime: mocks.runtime }));
vi.mock('./abacatepay-management', () => ({ getAbacatePayManagementContext: mocks.management }));
vi.mock('./plan-changes', () => ({ assertTargetPlanCapacity: mocks.capacity }));
vi.mock('./subscriptions', () => ({ recordBillingEvent: mocks.event }));

import type { ManagementDatabase } from './abacatepay-management';
import {
  cancelPixReplacementIntent,
  getPixReplacementIntentOverview,
  requestPixReplacementIntent,
} from './abacatepay-pix-replacement-intent';

const dialect = new PgDialect();
const clinicId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const contractId = '33333333-3333-4333-8333-333333333333';
const subscriptionId = '44444444-4444-4444-8444-444444444444';
const accountId = '55555555-5555-4555-8555-555555555555';
const targetPlanId = '66666666-6666-4666-8666-666666666666';
const targetPriceId = '77777777-7777-4777-8777-777777777777';
const currentPriceId = '88888888-8888-4888-8888-888888888888';
const intentId = '99999999-9999-4999-8999-999999999999';
const periodEnd = new Date('2026-12-24T03:09:00.000Z');
const input = { clinicId, requestedBy: actorId, contractId, targetPlanId };
let tableReady = true;
let actorPresent = true;
let stored: {
  id: string;
  to_plan_id: string;
  target_amount_minor: string;
  prior_period_end: Date;
  state: 'requested' | 'cancelled';
} | null;
const execute = vi.fn(async (statement: SQL) => {
  const compiled = dialect.sqlToQuery(statement);
  const query = compiled.sql;
  if (query.includes("to_regclass('billing_gateway.pix_replacement_intents')"))
    return [{ ready: tableReady }];
  if (query.includes('FROM public.profiles')) return actorPresent ? [{ id: actorId }] : [];
  if (query.includes('FROM public.plans p JOIN public.prices pr'))
    return [{ plan_id: String(compiled.params[0]), price_id: targetPriceId, amount: '397.00' }];
  if (query.includes('FROM public.prices pr JOIN public.plans p'))
    return [{ code: 'consultorio_2026', eligible: true }];
  if (query.includes('FROM billing_gateway.pix_replacement_intents')) return stored ? [stored] : [];
  if (query.includes('INSERT INTO billing_gateway.pix_replacement_intents')) {
    stored = {
      id: intentId,
      to_plan_id: targetPlanId,
      target_amount_minor: '39700',
      prior_period_end: periodEnd,
      state: 'requested',
    };
    return [{ id: intentId }];
  }
  if (query.includes('UPDATE billing_gateway.pix_replacement_intents')) {
    if (!stored || stored.state !== 'requested') return [];
    stored.state = 'cancelled';
    return [{ id: intentId }];
  }
  throw new Error(`Unexpected synthetic SQL: ${query}`);
});
const database = {
  execute,
  transaction: vi.fn(),
} satisfies ManagementDatabase;

beforeEach(() => {
  vi.clearAllMocks();
  database.transaction.mockImplementation((work: (tx: ManagementDatabase) => Promise<unknown>) =>
    work(database),
  );
  tableReady = true;
  actorPresent = true;
  stored = null;
  mocks.management.mockResolvedValue({
    generation_id: contractId,
    subscription_id: subscriptionId,
    clinic_id: clinicId,
    account_id: accountId,
    external_subscription_id: 'subs_synthetic',
    billing_status: 'active',
    payment_method: 'PIX',
    period_ended: false,
    cancel_at_period_end: false,
    cancellation_requested: false,
    price_id: currentPriceId,
    period_end: periodEnd,
  });
});

describe('Pix replacement assistance intent', () => {
  it('records a price snapshot without changing or charging the paid subscription', async () => {
    await expect(requestPixReplacementIntent(database, input)).resolves.toEqual({
      state: 'requested',
      intentId,
    });
    expect(mocks.capacity).toHaveBeenCalledWith(database, clinicId, targetPlanId);
    expect(mocks.event).toHaveBeenCalledOnce();
    expect(
      execute.mock.calls.map(([statement]) => dialect.sqlToQuery(statement).sql).join('\n'),
    ).not.toMatch(
      /UPDATE public\.subscriptions|INSERT INTO public\.invoices|cancel_subscription|create_checkout/,
    );
  });

  it('reuses the same open request and rejects a competing target', async () => {
    await requestPixReplacementIntent(database, input);
    execute.mockClear();
    await expect(requestPixReplacementIntent(database, input)).resolves.toEqual({
      state: 'requested',
      intentId,
    });
    expect(
      execute.mock.calls.map(([statement]) => dialect.sqlToQuery(statement).sql).join('\n'),
    ).not.toContain('INSERT INTO billing_gateway.pix_replacement_intents');
    await expect(
      requestPixReplacementIntent(database, {
        ...input,
        targetPlanId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    ).rejects.toMatchObject({ code: 'pending_change' });
  });

  it('rejects card, ended or cancelled contracts before writing an intent', async () => {
    for (const condition of [
      { payment_method: 'CARD' },
      { period_ended: true },
      { cancellation_requested: true },
    ]) {
      mocks.management.mockResolvedValueOnce({
        generation_id: contractId,
        billing_status: 'active',
        payment_method: 'PIX',
        period_ended: false,
        cancel_at_period_end: false,
        cancellation_requested: false,
        ...condition,
      });
      await expect(requestPixReplacementIntent(database, input)).rejects.toMatchObject({
        code: 'not_eligible',
      });
    }
    expect(mocks.event).not.toHaveBeenCalled();
  });

  it('requires an active actor in the same clinic', async () => {
    actorPresent = false;
    await expect(requestPixReplacementIntent(database, input)).rejects.toMatchObject({
      code: 'not_eligible',
    });
    expect(mocks.event).not.toHaveBeenCalled();
  });

  it('cancels only the request, idempotently, and preserves the original mandate', async () => {
    await requestPixReplacementIntent(database, input);
    const cancellation = { clinicId, requestedBy: actorId, contractId, intentId };
    await expect(cancelPixReplacementIntent(database, cancellation)).resolves.toEqual({
      state: 'cancelled',
    });
    await expect(cancelPixReplacementIntent(database, cancellation)).resolves.toEqual({
      state: 'cancelled',
    });
    expect(mocks.event).toHaveBeenCalledTimes(2);
    expect(
      execute.mock.calls.map(([statement]) => dialect.sqlToQuery(statement).sql).join('\n'),
    ).not.toContain('/subscriptions/cancel');
  });

  it('does not advertise the request without its candidate table', async () => {
    tableReady = false;
    await expect(getPixReplacementIntentOverview(database, clinicId)).resolves.toBeNull();
    await expect(requestPixReplacementIntent(database, input)).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('reads the existing request for the current Pix generation', async () => {
    stored = {
      id: intentId,
      to_plan_id: targetPlanId,
      target_amount_minor: '39700',
      prior_period_end: periodEnd,
      state: 'requested',
    };
    await expect(getPixReplacementIntentOverview(database, clinicId)).resolves.toEqual({
      available: true,
      pending: {
        id: intentId,
        targetPlanId,
        amountMinor: 39700,
        priorPeriodEnd: periodEnd.toISOString(),
      },
    });
  });
});
