import { describe, expect, it, vi } from 'vitest';

import type { ProviderPayment, ProviderSubscription } from '@/lib/payments/asaas';

import { syncProviderBillingCycle } from './billing-cycle-provider-sync';

const INPUT = {
  subscriptionId: 'sub_test',
  previousAmount: '397.00',
  amount: '3970.00',
  firstDueDate: '2026-11-05',
  fromCycle: 'MONTHLY' as const,
  toCycle: 'YEARLY' as const,
};

function fixture(withPayment = true) {
  const subscription: ProviderSubscription = {
    subscriptionId: INPUT.subscriptionId,
    status: 'ACTIVE',
    value: 397,
    customerId: 'cus_test',
    externalReference: null,
    cycle: 'MONTHLY',
    nextDueDate: withPayment ? '2026-12-05' : '2026-11-05',
    billingType: 'CREDIT_CARD',
  };
  const payments: ProviderPayment[] = withPayment
    ? [
        {
          paymentId: 'pay_test',
          status: 'PENDING',
          value: 397,
          dueDate: INPUT.firstDueDate,
          invoiceUrl: null,
          subscriptionId: INPUT.subscriptionId,
          billingType: 'CREDIT_CARD',
          externalReference: null,
          checkoutSessionId: null,
          deleted: false,
        },
      ]
    : [];
  const provider = {
    getSubscription: vi.fn(async () => ({ ...subscription })),
    updateSubscription: vi.fn(
      async (
        _id: string,
        input: {
          cycle?: 'MONTHLY' | 'YEARLY';
          value?: number;
          nextDueDate?: string;
        },
      ) => {
        subscription.cycle = input.cycle ?? subscription.cycle;
        subscription.value = input.value ?? subscription.value;
        subscription.nextDueDate = input.nextDueDate ?? subscription.nextDueDate;
      },
    ),
    listAllSubscriptionPayments: vi.fn(async () => payments.map((p) => ({ ...p }))),
    getPayment: vi.fn(async (id: string) => {
      const payment = payments.find((p) => p.paymentId === id);
      if (!payment) throw new Error('payment missing');
      return { ...payment };
    }),
    updatePayment: vi.fn(async (id: string, input: { value: number }) => {
      const payment = payments.find((p) => p.paymentId === id);
      if (!payment) throw new Error('payment missing');
      payment.value = input.value;
    }),
  };
  return { provider, subscription, payments };
}

describe('troca de ciclo no Asaas', () => {
  it('parcela já emitida: preserva o ID, cobra anual na data e renova só no ano seguinte', async () => {
    const { provider, subscription, payments } = fixture();

    await syncProviderBillingCycle(provider, INPUT);

    expect(provider.updateSubscription).toHaveBeenCalledWith(INPUT.subscriptionId, {
      cycle: 'YEARLY',
      value: 3970,
      nextDueDate: '2027-11-05',
      updatePendingPayments: false,
    });
    expect(subscription.nextDueDate).toBe('2027-11-05');
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ paymentId: 'pay_test', value: 3970 });
  });

  it('sem parcela emitida: próximo vencimento continua na data contratada', async () => {
    const { provider, subscription } = fixture(false);
    await syncProviderBillingCycle(provider, INPUT);
    expect(subscription.nextDueDate).toBe('2026-11-05');
    expect(provider.updatePayment).not.toHaveBeenCalled();
  });

  it('repetição e retomada após PUT parcial não criam nova cobrança', async () => {
    const { provider, payments } = fixture();
    provider.updatePayment.mockRejectedValueOnce(new Error('timeout'));
    await expect(syncProviderBillingCycle(provider, INPUT)).rejects.toThrow('timeout');
    await syncProviderBillingCycle(provider, INPUT);
    await syncProviderBillingCycle(provider, INPUT);
    expect(payments).toHaveLength(1);
    expect(provider.updateSubscription).toHaveBeenCalledTimes(1);
    expect(provider.updatePayment).toHaveBeenCalledTimes(2);
  });

  it('recusa PIX, boleto, outra data e cobrança já paga pelo preço anterior sem PUT', async () => {
    const { provider, subscription, payments } = fixture();
    subscription.billingType = 'PIX';
    await expect(syncProviderBillingCycle(provider, INPUT)).rejects.toMatchObject({
      code: 'cycle_change_provider_mismatch',
    });
    subscription.billingType = 'CREDIT_CARD';
    payments[0]!.status = 'CONFIRMED';
    await expect(syncProviderBillingCycle(provider, INPUT)).rejects.toMatchObject({
      code: 'cycle_change_payment_conflict',
    });
    payments[0]!.status = 'PENDING';
    subscription.nextDueDate = '2026-12-06';
    await expect(syncProviderBillingCycle(provider, INPUT)).rejects.toMatchObject({
      code: 'cycle_change_due_date_mismatch',
    });
    expect(provider.updateSubscription).not.toHaveBeenCalled();
  });

  it('não altera dívida antiga nem aceita segunda parcela mensal futura', async () => {
    const { provider, payments } = fixture();
    payments.push({
      ...payments[0]!,
      paymentId: 'pay_old',
      dueDate: '2026-10-05',
      status: 'OVERDUE',
    });
    await syncProviderBillingCycle(provider, INPUT);
    expect(payments.find((p) => p.paymentId === 'pay_old')?.value).toBe(397);

    const second = fixture();
    second.payments.push({
      ...second.payments[0]!,
      paymentId: 'pay_extra',
      dueDate: '2026-12-05',
    });
    await expect(syncProviderBillingCycle(second.provider, INPUT)).rejects.toMatchObject({
      code: 'cycle_change_payment_conflict',
    });
    expect(second.provider.updateSubscription).not.toHaveBeenCalled();
  });
});
