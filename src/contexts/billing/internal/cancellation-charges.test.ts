import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/payments/asaas', () => ({
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

import { BillingProviderError, type ProviderPayment } from '@/lib/payments/asaas';

import { removeSubscriptionCharges } from './cancellation-charges';

function payment(paymentId: string, status: string, deleted = false): ProviderPayment {
  return {
    paymentId,
    status,
    value: 149,
    dueDate: '2026-09-28',
    invoiceUrl: null,
    subscriptionId: 'sub_1',
    billingType: 'CREDIT_CARD',
    externalReference: null,
    checkoutSessionId: null,
    deleted,
  };
}

/**
 * Um Asaas de mentira que se comporta como o medido no sandbox: `DELETE` faz a
 * cobrança sumir da listagem e o `GET` direto passa a responder `deleted: true`.
 */
function fakeAsaas(initial: ProviderPayment[], avulsas: ProviderPayment[] = []) {
  const vivas = new Map(initial.map((p) => [p.paymentId, p]));
  const soltas = new Map(avulsas.map((p) => [p.paymentId, p]));
  const calls: string[] = [];
  const provider = {
    updateSubscription: vi.fn(async (_id: string, input: { status?: string }) => {
      calls.push(`update:${input.status}`);
    }),
    listUnpaidSubscriptionPayments: vi.fn(async () => {
      calls.push('list');
      return [...vivas.values()].filter((p) =>
        ['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS'].includes(p.status),
      );
    }),
    getPayment: vi.fn(async (id: string) => {
      calls.push(`get:${id}`);
      const found = vivas.get(id) ?? soltas.get(id);
      if (!found) throw new BillingProviderError('not found', 'not_found', 404);
      return found;
    }),
    cancelPayment: vi.fn(async (id: string) => {
      calls.push(`delete:${id}`);
      const alvo = vivas.get(id) ?? soltas.get(id);
      if (!alvo) throw new BillingProviderError('not found', 'not_found', 404);
      vivas.delete(id);
      soltas.set(id, { ...alvo, deleted: true });
      return { deleted: true };
    }),
  };
  return { provider, calls, vivas, soltas };
}

beforeEach(() => vi.clearAllMocks());

describe('removeSubscriptionCharges', () => {
  it('pausa a recorrência ANTES de apagar, e apaga pendente e vencida', async () => {
    const { provider, calls } = fakeAsaas([
      payment('pay_proximo_ciclo', 'PENDING'),
      payment('pay_vencida', 'OVERDUE'),
      payment('pay_paga', 'CONFIRMED'),
    ]);

    const result = await removeSubscriptionCharges(provider, {
      asaasSubscriptionId: 'sub_1',
      extraPaymentIds: [],
    });

    expect(result).toEqual({
      ok: true,
      removedPaymentIds: ['pay_proximo_ciclo', 'pay_vencida'],
      paidPaymentIds: [],
    });
    // Apagar antes de pausar deixaria o Asaas gerar a próxima cobrança depois
    // da varredura. `INACTIVE` sozinho era o defeito: a pendente sobrevivia.
    expect(calls[0]).toBe('update:INACTIVE');
    expect(calls.indexOf('update:INACTIVE')).toBeLessThan(
      calls.indexOf('delete:pay_proximo_ciclo'),
    );
    expect(provider.cancelPayment).not.toHaveBeenCalledWith('pay_paga');
  });

  it('só diz ok depois de uma RELEITURA sem cobrança viva', async () => {
    const { provider, calls } = fakeAsaas([payment('pay_1', 'PENDING')]);

    await removeSubscriptionCharges(provider, {
      asaasSubscriptionId: 'sub_1',
      extraPaymentIds: [],
    });

    expect(calls.filter((c) => c === 'list')).toHaveLength(2);
    expect(calls.lastIndexOf('list')).toBeGreaterThan(calls.indexOf('delete:pay_1'));
  });

  it('falha se a releitura ainda vê cobrança viva (DELETE respondeu, mas não surtiu efeito)', async () => {
    const { provider } = fakeAsaas([payment('pay_teimosa', 'PENDING')]);
    provider.cancelPayment.mockResolvedValue({ deleted: true }); // "apagou", mas nada mudou

    const result = await removeSubscriptionCharges(provider, {
      asaasSubscriptionId: 'sub_1',
      extraPaymentIds: [],
    });

    expect(result).toMatchObject({ ok: false, reason: 'provider_unavailable' });
  });

  it('apaga as cobranças avulsas que o sistema conhece (rateio de upgrade, invoice em aberto)', async () => {
    const { provider } = fakeAsaas([], [payment('pay_upgrade', 'PENDING')]);

    const result = await removeSubscriptionCharges(provider, {
      asaasSubscriptionId: 'sub_1',
      extraPaymentIds: ['pay_upgrade'],
    });

    expect(result).toMatchObject({ ok: true, removedPaymentIds: ['pay_upgrade'] });
  });

  it('cobrança avulsa que já sumiu (404) ou já foi apagada conta como feita', async () => {
    const { provider } = fakeAsaas([], [payment('pay_ja_apagada', 'PENDING', true)]);

    const result = await removeSubscriptionCharges(provider, {
      asaasSubscriptionId: null,
      extraPaymentIds: ['pay_inexistente', 'pay_ja_apagada'],
    });

    expect(result).toEqual({ ok: true, removedPaymentIds: [], paidPaymentIds: [] });
    expect(provider.cancelPayment).not.toHaveBeenCalled();
    expect(provider.updateSubscription).not.toHaveBeenCalled();
  });

  it('cartão em análise não pode ser apagado: devolve in_flight para tentar depois', async () => {
    const { provider } = fakeAsaas([payment('pay_analise', 'AWAITING_RISK_ANALYSIS')]);

    const result = await removeSubscriptionCharges(provider, {
      asaasSubscriptionId: 'sub_1',
      extraPaymentIds: [],
    });

    expect(result).toMatchObject({ ok: false, reason: 'in_flight' });
    expect(provider.cancelPayment).not.toHaveBeenCalled();
  });

  it('DELETE recusado porque o cartão foi cobrado no meio: segue, e reporta o pagamento', async () => {
    const { provider, vivas } = fakeAsaas([payment('pay_corrida', 'PENDING')]);
    provider.cancelPayment.mockImplementation(async (id: string) => {
      vivas.set(id, payment(id, 'CONFIRMED')); // o cartão passou antes do DELETE
      throw new BillingProviderError('cannot delete received', 'invalid_action', 400);
    });

    const result = await removeSubscriptionCharges(provider, {
      asaasSubscriptionId: 'sub_1',
      extraPaymentIds: [],
    });

    // Não há o que apagar — o dinheiro entrou. O cancelamento segue e o caso
    // sai daqui para estorno humano, em vez de sumir.
    expect(result).toEqual({ ok: true, removedPaymentIds: [], paidPaymentIds: ['pay_corrida'] });
  });

  it('DELETE falhou e a cobrança continua pendente: falha, sem afirmar nada', async () => {
    const { provider } = fakeAsaas([payment('pay_1', 'PENDING')]);
    provider.cancelPayment.mockRejectedValue(new Error('timeout'));

    const result = await removeSubscriptionCharges(provider, {
      asaasSubscriptionId: 'sub_1',
      extraPaymentIds: [],
    });

    expect(result).toMatchObject({ ok: false, reason: 'provider_unavailable' });
  });

  it('pausa recusada pelo Asaas: não apaga nada e falha', async () => {
    const { provider } = fakeAsaas([payment('pay_1', 'PENDING')]);
    provider.updateSubscription.mockRejectedValue(new Error('asaas fora'));

    const result = await removeSubscriptionCharges(provider, {
      asaasSubscriptionId: 'sub_1',
      extraPaymentIds: [],
    });

    expect(result).toMatchObject({ ok: false, reason: 'provider_unavailable' });
    expect(provider.cancelPayment).not.toHaveBeenCalled();
  });

  it('listagem truncada vira falha, nunca "não sobrou nada"', async () => {
    const { provider } = fakeAsaas([]);
    provider.listUnpaidSubscriptionPayments.mockRejectedValue(
      new BillingProviderError('truncada', 'unpaid_listing_truncated'),
    );

    const result = await removeSubscriptionCharges(provider, {
      asaasSubscriptionId: 'sub_1',
      extraPaymentIds: [],
    });

    expect(result).toMatchObject({ ok: false, reason: 'provider_unavailable' });
  });

  it('é idempotente: repetir depois de sucesso não apaga nada de novo e segue ok', async () => {
    const { provider } = fakeAsaas([payment('pay_1', 'PENDING')]);
    await removeSubscriptionCharges(provider, {
      asaasSubscriptionId: 'sub_1',
      extraPaymentIds: [],
    });
    provider.cancelPayment.mockClear();

    const again = await removeSubscriptionCharges(provider, {
      asaasSubscriptionId: 'sub_1',
      extraPaymentIds: ['pay_1'],
    });

    expect(again).toEqual({ ok: true, removedPaymentIds: [], paidPaymentIds: [] });
    expect(provider.cancelPayment).not.toHaveBeenCalled();
  });
});
