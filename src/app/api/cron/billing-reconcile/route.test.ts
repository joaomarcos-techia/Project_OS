import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  selectResults,
  listSubscriptionPayments,
  ensureInvoiceForPayment,
  markInvoicePaid,
  markInvoiceOverdue,
  markInvoiceRefunded,
  updateSubscription,
  applyScheduledPlanChange,
  emit,
} = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  listSubscriptionPayments: vi.fn(),
  ensureInvoiceForPayment: vi.fn(),
  markInvoicePaid: vi.fn(),
  markInvoiceOverdue: vi.fn(),
  markInvoiceRefunded: vi.fn(),
  updateSubscription: vi.fn(),
  applyScheduledPlanChange: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('@/lib/http/cron', () => ({ withCron: (_options: unknown, handler: unknown) => handler }));
vi.mock('@/lib/cron-heartbeat', () => ({ recordHeartbeat: vi.fn() }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));
vi.mock('@/lib/db', () => ({
  dbAdmin: {
    insert: () => ({ values: () => ({ returning: async () => [{ id: 'run_1' }] }) }),
    select: () => {
      const query = {
        innerJoin: () => query,
        leftJoin: () => query,
        where: () => ({
          orderBy: () => ({ limit: async () => selectResults.shift() ?? [] }),
          limit: async () => selectResults.shift() ?? [],
        }),
      };
      return { from: () => query };
    },
    transaction: async (callback: (tx: unknown) => unknown) => callback({}),
    execute: async () => [{ active_users: 1 }],
    update: () => ({ set: () => ({ where: async () => {} }) }),
  },
}));
vi.mock('@/contexts/billing/internal/providers/asaas', () => ({
  asaasProvider: { listSubscriptionPayments, getPayment: vi.fn(), updateSubscription },
}));
vi.mock('@/contexts/billing/internal/plan-changes', () => ({ applyScheduledPlanChange }));
vi.mock('@/contexts/billing/internal/subscriptions', () => ({
  ensureInvoiceForPayment,
  markInvoicePaid,
  markInvoiceOverdue,
  markInvoiceRefunded,
}));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  selectResults.length = 0;
  listSubscriptionPayments.mockResolvedValue([]);
  applyScheduledPlanChange.mockResolvedValue({ applied: true, kind: 'cancellation' });
});

describe('billing reconcile', () => {
  it('materializa e confirma cobrança pós-trial que chegou sem PAYMENT_CREATED', async () => {
    selectResults.push([{ clinicId: 'clinic_1', asaasSubscriptionId: 'sub_1' }], []);
    listSubscriptionPayments.mockResolvedValue([
      {
        paymentId: 'pay_1',
        status: 'CONFIRMED',
        value: 149,
        dueDate: '2026-08-02',
        invoiceUrl: null,
        subscriptionId: 'sub_1',
        billingType: 'CREDIT_CARD',
        externalReference: null,
      },
    ]);
    ensureInvoiceForPayment.mockResolvedValue({
      id: 'inv_1',
      clinicId: 'clinic_1',
      status: 'open',
    });

    const response = await GET(new Request('http://localhost/api/cron/billing-reconcile'));

    expect(listSubscriptionPayments).toHaveBeenCalledWith('sub_1', { attempts: 1 });
    expect(ensureInvoiceForPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ paymentId: 'pay_1', subscriptionId: 'sub_1' }),
    );
    expect(markInvoicePaid).toHaveBeenCalledWith(
      expect.anything(),
      'clinic_1',
      expect.objectContaining({ id: 'inv_1' }),
      expect.objectContaining({ providerPaymentId: 'pay_1' }),
    );
    expect(await response.json()).toEqual({
      ok: true,
      found: 1,
      fixed: 1,
      scheduledChangesApplied: 0,
    });
    expect(emit).toHaveBeenCalledWith(
      'billing.reconcile.run',
      expect.objectContaining({ subscriptionsScanned: 1, paymentsChecked: 1, fixed: 1 }),
    );
  });

  it('pausa no Asaas antes de aplicar o cancelamento local agendado', async () => {
    selectResults.push(
      [],
      [
        {
          id: 'change_cancel_1',
          clinicId: 'clinic_1',
          kind: 'cancellation',
          asaasSubscriptionId: 'sub_1',
          targetAmount: null,
        },
      ],
      [],
    );

    const response = await GET(new Request('http://localhost/api/cron/billing-reconcile'));

    expect(updateSubscription).toHaveBeenCalledWith('sub_1', {
      status: 'INACTIVE',
      updatePendingPayments: false,
    });
    expect(applyScheduledPlanChange).toHaveBeenCalledWith(expect.anything(), 'change_cancel_1');
    expect(await response.json()).toEqual({
      ok: true,
      found: 0,
      fixed: 0,
      scheduledChangesApplied: 1,
    });
  });
});
