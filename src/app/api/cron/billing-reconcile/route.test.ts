import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  selectResults,
  listSubscriptionPayments,
  getPayment,
  ensureInvoiceForPayment,
  markInvoicePaid,
  markInvoiceOverdue,
  markInvoiceRefunded,
  syncInvoiceFromProviderPayment,
  updateSubscription,
  applyScheduledPlanChange,
  emit,
} = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  listSubscriptionPayments: vi.fn(),
  getPayment: vi.fn(),
  ensureInvoiceForPayment: vi.fn(),
  markInvoicePaid: vi.fn(),
  markInvoiceOverdue: vi.fn(),
  markInvoiceRefunded: vi.fn(),
  syncInvoiceFromProviderPayment: vi.fn(),
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
vi.mock('@/lib/payments/asaas', () => ({
  asaasProvider: { listSubscriptionPayments, getPayment, updateSubscription },
  // BILLING-002 — a rota distingue 404 (cobranca removida) de indisponibilidade.
  BillingProviderError: class BillingProviderError extends Error {
    constructor(
      message: string,
      readonly code = 'billing_provider_error',
      readonly httpStatus: number | null = null,
    ) {
      super(message);
      this.name = 'BillingProviderError';
    }
  },
}));
vi.mock('@/contexts/billing/internal/plan-changes', () => ({ applyScheduledPlanChange }));
vi.mock('@/contexts/billing/internal/subscriptions', () => ({
  ensureInvoiceForPayment,
  markInvoicePaid,
  markInvoiceOverdue,
  markInvoiceRefunded,
  syncInvoiceFromProviderPayment,
}));

import { BillingProviderError } from '@/lib/payments/asaas';

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  selectResults.length = 0;
  listSubscriptionPayments.mockResolvedValue([]);
  applyScheduledPlanChange.mockResolvedValue({ applied: true, kind: 'cancellation' });
  // BILLING-002 — por padrão local e provedor concordam: a reconciliação é
  // no-op e devolve a mesma invoice para a transição seguinte.
  syncInvoiceFromProviderPayment.mockImplementation(
    async (_tx: unknown, _clinicId: string, invoice: unknown) => ({
      action: { kind: 'noop', reason: 'in_sync' },
      invoice,
    }),
  );
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

// ---------------------------------------------------------------------------
// BILLING-002 — o reconcile é o backstop que NÃO depende de habilitar eventos
// novos no Asaas. É por aqui que uma cobrança editada ou excluída no painel
// deixa de ficar divergente do ClinicaOS.
// ---------------------------------------------------------------------------

describe('BILLING-002 — divergência com o painel', () => {
  /** Uma invoice aberta com pagamento no provedor, no 2º scan da rota. */
  function openInvoice() {
    selectResults.push(
      [],
      [],
      [
        {
          id: 'inv_9',
          clinicId: 'clinic_1',
          status: 'open',
          dueDate: '2026-08-24',
          totalAmount: '199.00',
          asaasPaymentId: 'pay_9',
          paymentMethod: 'PIX',
        },
      ],
    );
  }

  it('cobrança EXCLUÍDA no painel (404) é reconciliada, não ignorada', async () => {
    // Antes, o catch tratava tudo como indisponibilidade e dava `continue`: a
    // invoice ficava `open` para sempre e o dunning cobrava algo inexistente.
    openInvoice();
    getPayment.mockRejectedValue(new BillingProviderError('not found', 'not_found', 404));
    syncInvoiceFromProviderPayment.mockResolvedValue({
      action: { kind: 'terminalize', status: 'cancelled' },
      invoice: { id: 'inv_9', clinicId: 'clinic_1', status: 'cancelled' },
    });

    await GET(new Request('http://localhost/api/cron/billing-reconcile'));

    const [, , , provider, opts] = syncInvoiceFromProviderPayment.mock.calls[0]!;
    expect(provider).toEqual({ exists: false });
    expect(opts).toMatchObject({ providerConfirmedMissing: true });
    expect(markInvoicePaid).not.toHaveBeenCalled();
  });

  it('indisponibilidade do provedor NÃO cancela nada — a próxima run tenta', async () => {
    openInvoice();
    getPayment.mockRejectedValue(new Error('timeout'));

    await GET(new Request('http://localhost/api/cron/billing-reconcile'));

    expect(syncInvoiceFromProviderPayment).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      'billing.reconcile.provider_error',
      expect.objectContaining({ invoiceId: 'inv_9' }),
    );
  });

  it('data/valor divergentes são reconciliados mesmo sem transição a fazer', async () => {
    openInvoice();
    getPayment.mockResolvedValue({
      paymentId: 'pay_9',
      status: 'PENDING',
      value: 249,
      dueDate: '2026-09-05',
      invoiceUrl: null,
      subscriptionId: 'sub_1',
      billingType: 'PIX',
      externalReference: null,
    });
    syncInvoiceFromProviderPayment.mockResolvedValue({
      action: { kind: 'update', dueDate: '2026-09-05', totalCents: 24_900, amountChanged: true },
      invoice: { id: 'inv_9', clinicId: 'clinic_1', status: 'open', dueDate: '2026-09-05' },
    });

    const response = await GET(new Request('http://localhost/api/cron/billing-reconcile'));

    const [, , , provider] = syncInvoiceFromProviderPayment.mock.calls[0]!;
    expect(provider).toMatchObject({ exists: true, dueDate: '2026-09-05', totalCents: 24_900 });
    // PENDING não paga; a divergência sozinha já conta como corrigida.
    expect(markInvoicePaid).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ found: 1, fixed: 1 });
  });

  it('paga sobre a invoice RECONCILIADA, não sobre a lida antes', async () => {
    openInvoice();
    getPayment.mockResolvedValue({
      paymentId: 'pay_9',
      status: 'CONFIRMED',
      value: 199,
      dueDate: '2026-09-05',
      invoiceUrl: null,
      subscriptionId: 'sub_1',
      billingType: 'PIX',
      externalReference: null,
    });
    syncInvoiceFromProviderPayment.mockResolvedValue({
      action: { kind: 'update', dueDate: '2026-09-05', amountChanged: false },
      invoice: { id: 'inv_9', clinicId: 'clinic_1', status: 'open', dueDate: '2026-09-05' },
    });

    await GET(new Request('http://localhost/api/cron/billing-reconcile'));

    // BILLING-001 deriva o período do due_date: pagar com o vencimento antigo
    // em memória abriria o ciclo errado.
    const [, , invoiceArg] = markInvoicePaid.mock.calls[0]!;
    expect(invoiceArg).toMatchObject({ dueDate: '2026-09-05' });
  });
});
