import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  selectResults,
  listSubscriptionPayments,
  ensureInvoiceForPayment,
  markInvoicePaid,
  markInvoiceOverdue,
  markInvoiceRefunded,
  emit,
} = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  listSubscriptionPayments: vi.fn(),
  ensureInvoiceForPayment: vi.fn(),
  markInvoicePaid: vi.fn(),
  markInvoiceOverdue: vi.fn(),
  markInvoiceRefunded: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('@/lib/http/cron', () => ({ withCron: (_options: unknown, handler: unknown) => handler }));
vi.mock('@/lib/cron-heartbeat', () => ({ recordHeartbeat: vi.fn() }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));
vi.mock('@/lib/db', () => ({
  dbAdmin: {
    insert: () => ({ values: () => ({ returning: async () => [{ id: 'run_1' }] }) }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => selectResults.shift() ?? [] }),
          limit: async () => selectResults.shift() ?? [],
        }),
      }),
    }),
    transaction: async (callback: (tx: unknown) => unknown) => callback({}),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  },
}));
vi.mock('@/contexts/billing/internal/providers/asaas', () => ({
  asaasProvider: { listSubscriptionPayments, getPayment: vi.fn() },
}));
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
    expect(await response.json()).toEqual({ ok: true, found: 1, fixed: 1 });
    expect(emit).toHaveBeenCalledWith(
      'billing.reconcile.run',
      expect.objectContaining({ subscriptionsScanned: 1, paymentsChecked: 1, fixed: 1 }),
    );
  });
});
