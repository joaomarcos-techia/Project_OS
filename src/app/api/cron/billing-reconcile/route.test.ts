import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  selectResults,
  capacityRows,
  listSubscriptionPayments,
  getPayment,
  ensureInvoiceForPayment,
  markInvoicePaid,
  markInvoiceOverdue,
  markInvoiceRefunded,
  syncInvoiceFromProviderPayment,
  updateSubscription,
  listUnpaidSubscriptionPayments,
  cancelPayment,
  reopenReactivatedClinics,
  applyScheduledPlanChange,
  applyPaidUpgradeForPayment,
  getPaidUpgradeSyncContext,
  syncProviderPlanChange,
  emit,
} = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  capacityRows: [{ active_users: 1, user_limit: 1 }] as {
    active_users: number;
    user_limit: number | null;
  }[],
  listSubscriptionPayments: vi.fn(),
  getPayment: vi.fn(),
  ensureInvoiceForPayment: vi.fn(),
  markInvoicePaid: vi.fn(),
  markInvoiceOverdue: vi.fn(),
  markInvoiceRefunded: vi.fn(),
  syncInvoiceFromProviderPayment: vi.fn(),
  updateSubscription: vi.fn(),
  listUnpaidSubscriptionPayments: vi.fn(),
  cancelPayment: vi.fn(),
  reopenReactivatedClinics: vi.fn(),
  applyScheduledPlanChange: vi.fn(),
  applyPaidUpgradeForPayment: vi.fn(),
  getPaidUpgradeSyncContext: vi.fn(),
  syncProviderPlanChange: vi.fn(),
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
    execute: async () => capacityRows,
    update: () => ({ set: () => ({ where: async () => {} }) }),
  },
}));
vi.mock('@/lib/payments/asaas', () => ({
  asaasProvider: {
    listSubscriptionPayments,
    getPayment,
    updateSubscription,
    listUnpaidSubscriptionPayments,
    cancelPayment,
  },
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
vi.mock('@/contexts/billing/internal/plan-changes', () => ({
  applyScheduledPlanChange,
  applyPaidUpgradeForPayment,
  getPaidUpgradeSyncContext,
  fitsPlanUserLimit: (active: number, limit: number | null) =>
    active > 0 && limit !== null && active <= limit,
  planChangeExternalReference: (id: string) => `plan-change:${id}`,
}));
vi.mock('@/contexts/billing/internal/plan-change-provider-sync', () => ({
  syncProviderPlanChange,
}));
vi.mock('@/contexts/billing/internal/clinic-status', () => ({ reopenReactivatedClinics }));
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
  capacityRows.splice(0, capacityRows.length, { active_users: 1, user_limit: 1 });
  listSubscriptionPayments.mockResolvedValue([]);
  listUnpaidSubscriptionPayments.mockResolvedValue([]);
  cancelPayment.mockResolvedValue({ deleted: true });
  reopenReactivatedClinics.mockResolvedValue(0);
  applyScheduledPlanChange.mockResolvedValue({ applied: true, kind: 'cancellation' });
  applyPaidUpgradeForPayment.mockResolvedValue(true);
  getPaidUpgradeSyncContext.mockResolvedValue(null);
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
  it('aplica downgrade para Clínica com três usuários somente após confirmação remota', async () => {
    capacityRows.splice(0, capacityRows.length, { active_users: 3, user_limit: 5 });
    selectResults.push(
      [],
      [
        {
          id: 'change_down',
          clinicId: 'clinic_1',
          kind: 'downgrade',
          toPlanId: 'plan_clinica',
          effectiveAt: new Date('2026-11-01'),
          asaasSubscriptionId: 'sub_1',
          targetAmount: '397.00',
          previousAmount: '699.00',
        },
      ],
      [],
      [],
    );
    applyScheduledPlanChange.mockResolvedValue({ applied: true, kind: 'downgrade' });

    const response = await GET(new Request('http://localhost/api/cron/billing-reconcile'));

    expect(syncProviderPlanChange).toHaveBeenCalledWith(expect.anything(), {
      subscriptionId: 'sub_1',
      previousAmount: '699.00',
      amount: '397.00',
      firstDueDate: '2026-11-01',
    });
    expect(syncProviderPlanChange.mock.invocationCallOrder[0]).toBeLessThan(
      applyScheduledPlanChange.mock.invocationCallOrder[0]!,
    );
    expect((await response.json()).scheduledChangesApplied).toBe(1);
  });

  it('não altera o provedor nem o plano quando a clínica excede a capacidade', async () => {
    capacityRows.splice(0, capacityRows.length, { active_users: 6, user_limit: 5 });
    selectResults.push(
      [],
      [
        {
          id: 'change_down',
          clinicId: 'clinic_1',
          kind: 'downgrade',
          toPlanId: 'plan_clinica',
          effectiveAt: new Date('2026-11-01'),
          asaasSubscriptionId: 'sub_1',
          targetAmount: '397.00',
          previousAmount: '699.00',
        },
      ],
      [],
      [],
    );

    const response = await GET(new Request('http://localhost/api/cron/billing-reconcile'));

    expect(syncProviderPlanChange).not.toHaveBeenCalled();
    expect(applyScheduledPlanChange).not.toHaveBeenCalled();
    expect((await response.json()).scheduledChangesApplied).toBe(0);
  });

  it('retoma upgrade pago sem webhook, mas só após sincronizar a recorrência', async () => {
    selectResults.push([], [], [{ id: 'change_up', providerPaymentId: 'pay_rateio' }], []);
    getPayment.mockResolvedValue({
      paymentId: 'pay_rateio',
      status: 'CONFIRMED',
      externalReference: 'plan-change:change_up',
    });
    getPaidUpgradeSyncContext.mockResolvedValue({
      subscriptionId: 'sub_1',
      previousAmount: '397.00',
      amount: '699.00',
      firstDueDate: '2026-11-01',
    });

    const response = await GET(new Request('http://localhost/api/cron/billing-reconcile'));

    expect(syncProviderPlanChange).toHaveBeenCalledOnce();
    expect(applyPaidUpgradeForPayment).toHaveBeenCalledOnce();
    expect(syncProviderPlanChange.mock.invocationCallOrder[0]).toBeLessThan(
      applyPaidUpgradeForPayment.mock.invocationCallOrder[0]!,
    );
    expect((await response.json()).fixed).toBe(1);
  });

  it('mantém upgrade pendente quando a sincronização remota falha', async () => {
    selectResults.push([], [], [{ id: 'change_up', providerPaymentId: 'pay_rateio' }], []);
    getPayment.mockResolvedValue({
      paymentId: 'pay_rateio',
      status: 'CONFIRMED',
      externalReference: 'plan-change:change_up',
    });
    getPaidUpgradeSyncContext.mockResolvedValue({
      subscriptionId: 'sub_1',
      previousAmount: '397.00',
      amount: '699.00',
      firstDueDate: '2026-11-01',
    });
    syncProviderPlanChange.mockRejectedValueOnce(new Error('Asaas indisponível'));

    const response = await GET(new Request('http://localhost/api/cron/billing-reconcile'));

    expect(applyPaidUpgradeForPayment).not.toHaveBeenCalled();
    expect((await response.json()).fixed).toBe(0);
    expect(emit).toHaveBeenCalledWith(
      'billing.plan_change.upgrade_reconcile_error',
      expect.objectContaining({ changeId: 'change_up' }),
    );
  });

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

  function cancelamentoVencido() {
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
  }
  const pendenteHoje = {
    paymentId: 'pay_hoje',
    status: 'PENDING',
    value: 149,
    dueDate: '2026-09-28',
    invoiceUrl: null,
    subscriptionId: 'sub_1',
    billingType: 'CREDIT_CARD',
    externalReference: null,
    checkoutSessionId: null,
    deleted: false,
  };

  it('pausa no Asaas antes de aplicar o cancelamento local agendado', async () => {
    cancelamentoVencido();

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

  it('apaga a parcela que vence no dia do cancelamento ANTES de aplicá-lo', async () => {
    // O defeito medido: o Asaas cria a cobrança 40 dias antes; `INACTIVE` a deixa
    // viva, e ela vence exatamente no dia em que o cancelamento entra em vigor.
    cancelamentoVencido();
    listUnpaidSubscriptionPayments.mockResolvedValueOnce([pendenteHoje]).mockResolvedValueOnce([]);

    await GET(new Request('http://localhost/api/cron/billing-reconcile'));

    expect(cancelPayment).toHaveBeenCalledWith('pay_hoje');
    expect(updateSubscription.mock.invocationCallOrder[0]).toBeLessThan(
      cancelPayment.mock.invocationCallOrder[0]!,
    );
    expect(cancelPayment.mock.invocationCallOrder[0]).toBeLessThan(
      applyScheduledPlanChange.mock.invocationCallOrder[0]!,
    );
  });

  it('NÃO aplica o cancelamento local enquanto sobrar cobrança viva no Asaas', async () => {
    // Aplicar aqui tiraria a assinatura da varredura diária (que só olha
    // trial/active/past_due) — e a cobrança que sobrou nunca mais seria apagada.
    cancelamentoVencido();
    listUnpaidSubscriptionPayments.mockResolvedValue([pendenteHoje]);
    cancelPayment.mockRejectedValue(new Error('asaas fora'));
    getPayment.mockResolvedValue(pendenteHoje);

    const response = await GET(new Request('http://localhost/api/cron/billing-reconcile'));

    expect(applyScheduledPlanChange).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      'billing.plan_change.cancellation_charges_pending',
      expect.objectContaining({ changeId: 'change_cancel_1', reason: 'provider_unavailable' }),
    );
    expect((await response.json()).scheduledChangesApplied).toBe(0);
  });

  it('reabre clínicas que ficaram fechadas depois de uma reativação', async () => {
    reopenReactivatedClinics.mockResolvedValue(2);

    await GET(new Request('http://localhost/api/cron/billing-reconcile'));

    expect(reopenReactivatedClinics).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('billing.reactivation.reopened_by_cron', { reopened: 2 });
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
