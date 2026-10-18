import { describe, expect, it, vi } from 'vitest';

import type { ProviderPayment, ProviderSubscription } from '@/lib/payments/asaas';

import { syncProviderPlanChange } from './plan-change-provider-sync';

const INPUT = {
  subscriptionId: 'sub_test',
  previousAmount: '699.00',
  amount: '397.00',
  firstDueDate: '2026-11-01',
};

function payment(id: string, dueDate: string, value: number, status = 'PENDING'): ProviderPayment {
  return {
    paymentId: id,
    subscriptionId: INPUT.subscriptionId,
    status,
    dueDate,
    value,
    invoiceUrl: null,
    billingType: 'CREDIT_CARD',
    externalReference: null,
    checkoutSessionId: null,
    deleted: false,
  };
}

function fixture(initialPayments: ProviderPayment[]) {
  const subscription: ProviderSubscription = {
    subscriptionId: INPUT.subscriptionId,
    status: 'ACTIVE',
    value: 699,
    customerId: 'cus_test',
    externalReference: null,
    cycle: 'MONTHLY',
    nextDueDate: INPUT.firstDueDate,
    billingType: 'CREDIT_CARD',
  };
  const payments = initialPayments.map((item) => ({ ...item }));
  const provider = {
    getSubscription: vi.fn(async () => ({ ...subscription })),
    updateSubscription: vi.fn(async (_id: string, input: { value?: number }) => {
      if (input.value !== undefined) subscription.value = input.value;
    }),
    listAllSubscriptionPayments: vi.fn(async () => payments.map((item) => ({ ...item }))),
    getPayment: vi.fn(async (id: string) => {
      const found = payments.find((item) => item.paymentId === id);
      if (!found) throw new Error('unknown payment');
      return { ...found };
    }),
    updatePayment: vi.fn(async (id: string, input: { value: number }) => {
      const found = payments.find((item) => item.paymentId === id);
      if (!found) throw new Error('unknown payment');
      found.value = input.value;
    }),
  };
  return { provider, subscription, payments };
}

describe('sincronização da troca de plano com o Asaas', () => {
  it('altera a recorrência e só a parcela emitida para o novo ciclo', async () => {
    const oldDebt = payment('pay_old', '2026-10-01', 699, 'OVERDUE');
    const next = payment('pay_next', '2026-11-01', 699);
    const { provider, subscription, payments } = fixture([oldDebt, next]);

    await syncProviderPlanChange(provider, INPUT);

    expect(subscription.value).toBe(397);
    expect(payments.find((item) => item.paymentId === 'pay_old')?.value).toBe(699);
    expect(payments.find((item) => item.paymentId === 'pay_next')?.value).toBe(397);
    expect(provider.updateSubscription).toHaveBeenCalledWith(INPUT.subscriptionId, {
      value: 397,
      updatePendingPayments: false,
    });
    expect(provider.updatePayment).toHaveBeenCalledWith('pay_next', {
      value: 397,
      billingType: 'CREDIT_CARD',
      dueDate: '2026-11-01',
    });
  });

  it('não altera nada se a parcela do novo ciclo já foi paga pelo preço antigo', async () => {
    const { provider } = fixture([payment('pay_paid', '2026-11-01', 699, 'CONFIRMED')]);

    await expect(syncProviderPlanChange(provider, INPUT)).rejects.toMatchObject({
      code: 'provider_payment_not_editable',
    });
    expect(provider.updateSubscription).not.toHaveBeenCalled();
    expect(provider.updatePayment).not.toHaveBeenCalled();
  });

  it('não sobrescreve preço alterado fora do contrato local', async () => {
    const { provider, subscription } = fixture([]);
    subscription.value = 499;

    await expect(syncProviderPlanChange(provider, INPUT)).rejects.toMatchObject({
      code: 'provider_subscription_unexpected_price',
    });
    expect(provider.updateSubscription).not.toHaveBeenCalled();
  });

  it('retoma após falha parcial e não repete PUTs já confirmados', async () => {
    const { provider, subscription, payments } = fixture([payment('pay_next', '2026-11-01', 699)]);
    provider.updatePayment.mockRejectedValueOnce(new Error('Asaas indisponível'));

    await expect(syncProviderPlanChange(provider, INPUT)).rejects.toThrow('Asaas indisponível');
    expect(subscription.value).toBe(397);
    expect(payments[0]?.value).toBe(699);

    await syncProviderPlanChange(provider, INPUT);
    await syncProviderPlanChange(provider, INPUT);

    expect(payments[0]?.value).toBe(397);
    expect(provider.updateSubscription).toHaveBeenCalledTimes(1);
    expect(provider.updatePayment).toHaveBeenCalledTimes(2);
  });

  it('bloqueia a aplicação local quando o readback não confirma o valor', async () => {
    const { provider } = fixture([payment('pay_next', '2026-11-01', 699)]);
    provider.updatePayment.mockImplementation(async () => {});

    await expect(syncProviderPlanChange(provider, INPUT)).rejects.toMatchObject({
      code: 'provider_payment_mismatch',
    });
  });

  it('detecta parcela criada durante a sincronização e a corrige no retry', async () => {
    const { provider, subscription, payments } = fixture([payment('pay_next', '2026-11-01', 699)]);
    provider.updatePayment.mockImplementationOnce(async (id, input) => {
      const current = payments.find((item) => item.paymentId === id);
      if (!current) throw new Error('unknown payment');
      current.value = input.value;
      payments.push(payment('pay_race', '2026-12-01', 699));
    });

    await expect(syncProviderPlanChange(provider, INPUT)).rejects.toMatchObject({
      code: 'provider_payment_mismatch',
    });
    expect(subscription.value).toBe(397);
    expect(payments.find((item) => item.paymentId === 'pay_race')?.value).toBe(699);

    await syncProviderPlanChange(provider, INPUT);
    expect(payments.every((item) => item.value === 397)).toBe(true);
    expect(provider.updateSubscription).toHaveBeenCalledTimes(1);
  });

  it('sincroniza a assinatura sem inventar cobrança que ainda não foi emitida', async () => {
    const { provider, subscription } = fixture([]);

    await syncProviderPlanChange(provider, INPUT);

    expect(subscription.value).toBe(397);
    expect(provider.updatePayment).not.toHaveBeenCalled();
  });
});
