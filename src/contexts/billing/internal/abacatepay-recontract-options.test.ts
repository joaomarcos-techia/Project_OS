import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  management: vi.fn(),
  env: {
    NODE_ENV: 'test',
    ABACATEPAY_STORE_ID: 'store_synthetic',
    ABACATEPAY_SANDBOX_PLAN_PRODUCTS: '{"consultorio_2026":"prod_one","clinica_2026_2":"prod_two"}',
  },
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('./abacatepay-management', () => ({ getAbacatePayManagementContext: mocks.management }));
vi.mock('./plan-changes', () => ({ assertTargetPlanCapacity: vi.fn() }));
vi.mock('./subscriptions', () => ({ recordBillingEvent: vi.fn() }));

import type { ManagementDatabase } from './abacatepay-management';
import { getAbacatePayRecontractOptions } from './abacatepay-plan-changes';

const clinicId = '22222222-2222-4222-8222-222222222222';
const subscriptionId = '11111111-1111-4111-8111-111111111111';
const database: ManagementDatabase = { execute: mocks.execute, transaction: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.management.mockResolvedValue({
    cancellation_confirmed: true,
    cancel_at_period_end: true,
    period_ended: true,
    subscription_id: subscriptionId,
    external_subscription_id: 'subs_old',
  });
});

describe('recontract plan selection after the paid period', () => {
  it('does not offer a second subscription while the old period is active', async () => {
    mocks.management.mockResolvedValue({
      cancellation_confirmed: true,
      cancel_at_period_end: true,
      period_ended: false,
    });
    expect(await getAbacatePayRecontractOptions(database, clinicId)).toEqual({
      options: [],
      pendingPlanId: null,
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('offers only configured monthly plans once the old period has ended', async () => {
    mocks.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'aaaa1111-1111-4111-8111-111111111111',
        name: 'Consultório',
        code: 'consultorio_2026',
        price_id: 'bbbb1111-1111-4111-8111-111111111111',
        amount: '197.00',
      },
      {
        id: 'aaaa2222-2222-4222-8222-222222222222',
        name: 'Clínica',
        code: 'clinica_2026_2',
        price_id: 'bbbb2222-2222-4222-8222-222222222222',
        amount: '397.00',
      },
    ]);
    const result = await getAbacatePayRecontractOptions(database, clinicId);
    expect(result.pendingPlanId).toBeNull();
    expect(result.options.map((option) => option.amountMinor)).toEqual([19700, 39700]);
  });

  it('locks the choice to the existing unpaid checkout, even if the catalog changed', async () => {
    const targetId = 'aaaa2222-2222-4222-8222-222222222222';
    mocks.execute.mockResolvedValueOnce([
      { plan_id: targetId, name: 'Clínica', code: 'clinica_2026_2', amount_minor: '39700' },
    ]);
    expect(await getAbacatePayRecontractOptions(database, clinicId)).toEqual({
      options: [{ id: targetId, name: 'Clínica', code: 'clinica_2026_2', amountMinor: 39700 }],
      pendingPlanId: targetId,
    });
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
});
