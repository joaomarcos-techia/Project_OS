import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('@/lib/env', () => ({
  assertBillingRuntimeReady: vi.fn(),
  env: {
    ASAAS_BASE_URL: 'https://sandbox.asaas.com/api/v3',
    ASAAS_API_KEY: 'test-key',
    ASAAS_HTTP_TIMEOUT_MS: 1_000,
    ASAAS_WEBHOOK_TOKEN: 'webhook-token',
  },
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));

import { __testing__, asaasProvider } from './asaas';

beforeEach(() => {
  __testing__.resetCircuit();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('compensacao de cliente de checkout', () => {
  it('remove cliente pelo endpoint do Asaas sem incluir dados de cartao', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      asaasProvider.deleteCustomer('cus_created_for_failed_checkout'),
    ).resolves.toBeUndefined();

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox.asaas.com/api/v3/customers/cus_created_for_failed_checkout');
    expect(request.method).toBe('DELETE');
    expect(request.body).toBeUndefined();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listSubscriptionPayments', () => {
  it('lê cobranças da assinatura e preserva o vínculo do endpoint', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        data: [
          {
            id: 'pay_1',
            status: 'CONFIRMED',
            value: 149,
            dueDate: '2026-08-02',
            invoiceUrl: 'https://asaas.test/invoice',
            billingType: 'CREDIT_CARD',
          },
        ],
      }),
    );

    await expect(asaasProvider.listSubscriptionPayments('sub_1', { attempts: 1 })).resolves.toEqual(
      [
        {
          paymentId: 'pay_1',
          status: 'CONFIRMED',
          value: 149,
          dueDate: '2026-08-02',
          invoiceUrl: 'https://asaas.test/invoice',
          subscriptionId: 'sub_1',
          billingType: 'CREDIT_CARD',
          externalReference: null,
        },
      ],
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.asaas.com/api/v3/subscriptions/sub_1/payments',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('reconciliação de assinatura', () => {
  it('recupera assinatura anterior pela externalReference do onboarding', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        data: [
          {
            id: 'sub_onboarding',
            customer: 'cus_onboarding',
            status: 'ACTIVE',
            value: 149,
            externalReference: 'onboarding:00000000-0000-0000-0000-000000000001',
          },
        ],
      }),
    );

    await expect(
      asaasProvider.findSubscriptionByExternalReference(
        'onboarding:00000000-0000-0000-0000-000000000001',
        { attempts: 1 },
      ),
    ).resolves.toEqual({
      subscriptionId: 'sub_onboarding',
      customerId: 'cus_onboarding',
      status: 'ACTIVE',
      value: 149,
      externalReference: 'onboarding:00000000-0000-0000-0000-000000000001',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.asaas.com/api/v3/subscriptions?externalReference=onboarding%3A00000000-0000-0000-0000-000000000001&limit=1',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('erros HTTP do Asaas', () => {
  it('não propaga o corpo potencialmente sensível do gateway', async () => {
    const pan = '4111111111111111';
    const cvv = '123';
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ description: `card=${pan}; ccv=${cvv}` }] }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const error = await asaasProvider.getPayment('pay_1', { attempts: 1 }).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toEqual(
      expect.objectContaining({
        name: 'BillingProviderError',
        message: 'asaas GET /payments/pay_1 → HTTP 400',
      }),
    );
    if (!(error instanceof Error)) throw new Error('expected BillingProviderError');
    expect(error.message).not.toContain(pan);
    expect(error.message).not.toContain(cvv);
  });
});

describe('alteração de assinatura e recuperação de cobrança', () => {
  it('atualiza somente cobranças futuras da assinatura', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 'sub_1' }));

    await asaasProvider.updateSubscription('sub_1', { value: 199, updatePendingPayments: false });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.asaas.com/api/v3/subscriptions/sub_1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ value: 199, updatePendingPayments: false }),
      }),
    );
  });

  it('reativa uma assinatura com nova data de cobrança', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 'sub_1' }));

    await asaasProvider.updateSubscription('sub_1', {
      value: 149,
      status: 'ACTIVE',
      nextDueDate: '2026-08-04',
      updatePendingPayments: false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.asaas.com/api/v3/subscriptions/sub_1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          value: 149,
          status: 'ACTIVE',
          nextDueDate: '2026-08-04',
          updatePendingPayments: false,
        }),
      }),
    );
  });

  it('recupera cobrança já criada pela externalReference antes de novo POST', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        data: [
          {
            id: 'pay_upgrade',
            status: 'PENDING',
            value: 25,
            dueDate: '2026-08-03',
            externalReference: 'plan-change:00000000-0000-0000-0000-000000000001',
          },
        ],
      }),
    );

    await expect(
      asaasProvider.findPaymentByExternalReference(
        'plan-change:00000000-0000-0000-0000-000000000001',
        { attempts: 1 },
      ),
    ).resolves.toMatchObject({
      paymentId: 'pay_upgrade',
      externalReference: 'plan-change:00000000-0000-0000-0000-000000000001',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.asaas.com/api/v3/payments?externalReference=plan-change%3A00000000-0000-0000-0000-000000000001&limit=1',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
