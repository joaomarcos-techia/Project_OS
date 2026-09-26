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

import {
  __testing__,
  asaasProvider,
  BillingCircuitOpenError,
  BillingProviderError,
  createAsaasClient,
} from './index';

beforeEach(() => {
  __testing__.resetCircuit();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('compensacao de cliente de checkout', () => {
  it('identifica explicitamente a integração nas chamadas ao Asaas', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 'cus_1' }));

    await asaasProvider.createCustomer({ name: 'Gestora', email: 'gestora@example.test' });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        'User-Agent': 'ClinicaOS/1.0 (billing-integration)',
        access_token: 'test-key',
      }),
    );
  });

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
          checkoutSessionId: null,
          // 1.5: o Asaas responde 200 para cobrança apagada, com o status
          // congelado — `deleted` é o único campo que diz a verdade.
          deleted: false,
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
      cycle: null,
      nextDueDate: null,
      billingType: null,
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
        providerErrorCodes: [],
      }),
    );
    if (!(error instanceof BillingProviderError)) throw new Error('expected BillingProviderError');
    expect(error.message).not.toContain(pan);
    expect(error.message).not.toContain(cvv);
  });

  it('preserva apenas códigos seguros do provedor para diagnóstico', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [
            {
              code: 'invalid_creditCard',
              description: 'dados refletidos que nunca devem ser logados',
            },
            { code: 'invalid_creditCard', description: 'duplicado' },
            { code: 'CPF-123', description: 'código fora da allowlist' },
          ],
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );

    const error = await asaasProvider.getPayment('pay_1', { attempts: 1 }).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toEqual(expect.objectContaining({ providerErrorCodes: ['invalid_creditCard'] }));
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

describe('Checkout hospedado de paciente (D24)', () => {
  it('cria somente PIX/cartão, avulso e deixa os dados do pagador para o Checkout', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        id: 'checkout_1',
        status: 'ACTIVE',
        link: 'https://sandbox.asaas.com/checkoutSession/show?id=checkout_1',
        externalReference: 'remainder:appointment-1:g1',
      }),
    );
    const clinica = createAsaasClient({ apiKey: 'chave-da-clinica' });

    await expect(
      clinica.createCheckout({
        value: 75,
        description: 'Restante do atendimento',
        externalReference: 'remainder:appointment-1:g1',
        minutesToExpire: 1_440,
        callback: {
          successUrl: 'https://qoro.example/pagamento/sucesso',
          cancelUrl: 'https://qoro.example/pagamento/cancelado',
          expiredUrl: 'https://qoro.example/pagamento/expirado',
        },
      }),
    ).resolves.toEqual({
      checkoutId: 'checkout_1',
      status: 'ACTIVE',
      link: 'https://sandbox.asaas.com/checkoutSession/show?id=checkout_1',
      externalReference: 'remainder:appointment-1:g1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.asaas.com/api/v3/checkouts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          billingTypes: ['PIX', 'CREDIT_CARD'],
          chargeTypes: ['DETACHED'],
          minutesToExpire: 1_440,
          externalReference: 'remainder:appointment-1:g1',
          callback: {
            successUrl: 'https://qoro.example/pagamento/sucesso',
            cancelUrl: 'https://qoro.example/pagamento/cancelado',
            expiredUrl: 'https://qoro.example/pagamento/expirado',
          },
          items: [
            {
              name: 'Restante do atendimento',
              description: 'Restante do atendimento',
              quantity: 1,
              value: 75,
            },
          ],
        }),
      }),
    );
  });

  it.each([9, 1_441, 10.5])('rejeita expiração inválida (%s) antes da rede', async (minutes) => {
    const clinica = createAsaasClient({ apiKey: 'k' });

    await expect(
      clinica.createCheckout({
        value: 10,
        description: 'Sinal do agendamento',
        externalReference: 'deposit:appointment-1:g1',
        minutesToExpire: minutes,
        callback: {
          successUrl: 'https://qoro.example/sucesso',
          cancelUrl: 'https://qoro.example/cancelado',
          expiredUrl: 'https://qoro.example/expirado',
        },
      }),
    ).rejects.toMatchObject({ code: 'checkout_expiration_invalid' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancela sem retry e escapa o id do Checkout', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 'checkout_1', status: 'CANCELED' }));

    await expect(
      createAsaasClient({ apiKey: 'k' }).cancelCheckout('checkout/../../admin'),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.asaas.com/api/v3/checkouts/checkout%2F..%2F..%2Fadmin/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('resolve a cobrança autoritativa pelo checkoutSession', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        data: [
          {
            id: 'pay_1',
            status: 'RECEIVED',
            value: 75,
            dueDate: '2026-08-30',
            invoiceUrl: 'https://asaas.test/i/pay_1',
            billingType: 'PIX',
            externalReference: 'remainder:appointment-1:g1',
            checkoutSession: 'checkout_1',
          },
        ],
      }),
    );

    await expect(
      createAsaasClient({ apiKey: 'k' }).findPaymentByCheckoutSession('checkout_1', {
        attempts: 1,
      }),
    ).resolves.toEqual({
      paymentId: 'pay_1',
      status: 'RECEIVED',
      value: 75,
      dueDate: '2026-08-30',
      invoiceUrl: 'https://asaas.test/i/pay_1',
      subscriptionId: null,
      billingType: 'PIX',
      externalReference: 'remainder:appointment-1:g1',
      checkoutSessionId: 'checkout_1',
      deleted: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.asaas.com/api/v3/payments?checkoutSession=checkout_1&limit=10&offset=0',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('não aceita uma cobrança de outra sessão retornada pelo provider', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ data: [{ id: 'pay_other', checkoutSession: 'checkout_other' }] }),
    );

    await expect(
      createAsaasClient({ apiKey: 'k' }).findPaymentByCheckoutSession('checkout_1', {
        attempts: 1,
      }),
    ).resolves.toBeNull();
  });
});

describe('parseWebhook — identidade mínima de Checkout', () => {
  it('extrai checkout.id sem confiar em status ou valor do evento', () => {
    const client = createAsaasClient({ apiKey: 'k' });

    expect(
      client.parseWebhook(
        JSON.stringify({
          id: 'evt_checkout_paid',
          event: 'CHECKOUT_PAID',
          checkout: { id: 'checkout_1', status: 'PAID', value: 999_999 },
        }),
      ),
    ).toEqual({
      eventId: 'evt_checkout_paid',
      event: 'CHECKOUT_PAID',
      paymentId: null,
      checkoutId: 'checkout_1',
    });
  });

  it('extrai checkoutSession de evento de cobrança para correlação', () => {
    const client = createAsaasClient({ apiKey: 'k' });

    expect(
      client.parseWebhook(
        JSON.stringify({
          id: 'evt_payment_received',
          event: 'PAYMENT_RECEIVED',
          payment: { id: 'pay_1', checkoutSession: 'checkout_1', status: 'RECEIVED' },
        }),
      ),
    ).toEqual({
      eventId: 'evt_payment_received',
      event: 'PAYMENT_RECEIVED',
      paymentId: 'pay_1',
      checkoutId: 'checkout_1',
    });
  });
});

describe('criação de webhook', () => {
  it('envia todos os campos obrigatórios do contrato v3 do Asaas', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ data: [] }))
      .mockResolvedValueOnce(Response.json({ id: 'wh_1' }));
    const clinica = createAsaasClient({ apiKey: 'chave-da-clinica' });

    await expect(
      clinica.createWebhook({
        name: 'Qoro — cobrança de paciente',
        url: 'https://example.test/api/webhooks/asaas/patient/ref-1',
        email: 'gestor@example.test',
        authToken: 'token-seguro-com-mais-de-32-caracteres',
        events: ['PAYMENT_RECEIVED'],
      }),
    ).resolves.toEqual({ webhookId: 'wh_1' });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://sandbox.asaas.com/api/v3/webhooks?offset=0&limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://sandbox.asaas.com/api/v3/webhooks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Qoro — cobrança de paciente',
          url: 'https://example.test/api/webhooks/asaas/patient/ref-1',
          email: 'gestor@example.test',
          enabled: true,
          interrupted: false,
          apiVersion: 3,
          authToken: 'token-seguro-com-mais-de-32-caracteres',
          sendType: 'SEQUENTIALLY',
          events: ['PAYMENT_RECEIVED'],
        }),
      }),
    );
  });

  it('atualiza a mesma rota quando o webhook já existe', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              id: 'wh_existing',
              name: 'Qoro — cobranca de paciente',
              url: 'https://preview.qoro.test/api/webhooks/asaas/patient/ref-1?x-vercel-protection-bypass=segredo-antigo',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json({ id: 'wh_existing' }));
    const clinica = createAsaasClient({ apiKey: 'chave-da-clinica' });

    await expect(
      clinica.createWebhook({
        name: 'Qoro — cobranca de paciente',
        url: 'https://preview.qoro.test/api/webhooks/asaas/patient/ref-1?x-vercel-protection-bypass=segredo-atual',
        email: 'gestor@example.test',
        authToken: 'token-atual-com-mais-de-32-caracteres',
        events: ['PAYMENT_RECEIVED'],
      }),
    ).resolves.toEqual({ webhookId: 'wh_existing' });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://sandbox.asaas.com/api/v3/webhooks/wh_existing',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          name: 'Qoro — cobranca de paciente',
          url: 'https://preview.qoro.test/api/webhooks/asaas/patient/ref-1?x-vercel-protection-bypass=segredo-atual',
          enabled: true,
          interrupted: false,
          authToken: 'token-atual-com-mais-de-32-caracteres',
          sendType: 'SEQUENTIALLY',
          events: ['PAYMENT_RECEIVED'],
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('converge por PUT quando outro request cria o webhook entre GET e POST', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ data: [] }))
      .mockResolvedValueOnce(
        Response.json(
          { errors: [{ code: 'invalid_object', description: 'conflito' }] },
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              id: 'wh_raced',
              name: 'Qoro — cobranca de paciente',
              url: 'https://preview.qoro.test/api/webhooks/asaas/patient/ref-1',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json({ id: 'wh_raced' }));
    const clinica = createAsaasClient({ apiKey: 'chave-da-clinica' });

    await expect(
      clinica.createWebhook({
        name: 'Qoro — cobranca de paciente',
        url: 'https://preview.qoro.test/api/webhooks/asaas/patient/ref-1',
        email: 'gestor@example.test',
        authToken: 'token-atual-com-mais-de-32-caracteres',
        events: ['PAYMENT_RECEIVED'],
      }),
    ).resolves.toEqual({ webhookId: 'wh_raced' });

    expect(fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method)).toEqual([
      'GET',
      'POST',
      'GET',
      'PUT',
    ]);
  });
});

describe('createAsaasClient — uma instância por credencial', () => {
  it('usa a chave da própria credencial, não a do env', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 'cus_1' }));
    const clinica = createAsaasClient({ apiKey: 'chave-da-clinica' });

    await clinica.createCustomer({ name: 'Paciente', email: 'paciente@example.test' });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.headers).toEqual(expect.objectContaining({ access_token: 'chave-da-clinica' }));
  });

  it('mantém o circuit breaker isolado entre credenciais', async () => {
    const contaA = createAsaasClient({ apiKey: 'chave-a' });
    const contaB = createAsaasClient({ apiKey: 'chave-b' });

    // 3 falhas indeterminadas (POST não re-tenta) abrem o breaker da conta A.
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    for (let i = 0; i < 3; i++) {
      await expect(
        contaA.createCustomer({ name: 'A', email: 'a@example.test' }),
      ).rejects.toBeInstanceOf(Error);
    }
    fetchMock.mockResolvedValue(Response.json({ id: 'cus_b' }));

    // A continua barrada pelo próprio circuito...
    await expect(contaA.createCustomer({ name: 'A', email: 'a@example.test' })).rejects.toThrow(
      BillingCircuitOpenError,
    );
    // ...e B, que nunca falhou, segue chamando o Asaas normalmente.
    await expect(contaB.createCustomer({ name: 'B', email: 'b@example.test' })).resolves.toEqual({
      customerId: 'cus_b',
    });
  });

  it('cai no ASAAS_BASE_URL do env quando a credencial não traz baseUrl', async () => {
    // `mockImplementation` (e não `mockResolvedValue`): o corpo de um Response só
    // pode ser lido uma vez, e este teste faz duas chamadas.
    fetchMock.mockImplementation(() => Response.json({ id: 'cus_1' }));
    const semBase = createAsaasClient({ apiKey: 'k' });
    const comBase = createAsaasClient({ apiKey: 'k', baseUrl: 'https://api.asaas.com/v3' });

    await semBase.createCustomer({ name: 'X', email: 'x@example.test' });
    await comBase.createCustomer({ name: 'X', email: 'x@example.test' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://sandbox.asaas.com/api/v3/customers');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.asaas.com/v3/customers');
  });

  it('sem webhookToken, nenhum token é aceito — inclusive o do env', () => {
    const semToken = createAsaasClient({ apiKey: 'k' });
    const comToken = createAsaasClient({ apiKey: 'k', webhookToken: 'token-da-clinica' });

    expect(semToken.validateWebhookToken('webhook-token')).toBe(false);
    expect(semToken.validateWebhookToken(null)).toBe(false);
    expect(comToken.validateWebhookToken('token-da-clinica')).toBe(true);
    expect(comToken.validateWebhookToken('webhook-token')).toBe(false);
  });

  it('lê credencial em função a CADA request (leitura tardia, como o client do env)', async () => {
    fetchMock.mockImplementation(() => Response.json({ id: 'cus_1' }));
    const chaves = ['primeira', 'segunda'];
    const rotativo = createAsaasClient({ apiKey: () => chaves.shift() ?? 'esgotada' });

    await rotativo.createCustomer({ name: 'X', email: 'x@example.test' });
    await rotativo.createCustomer({ name: 'X', email: 'x@example.test' });

    const primeira = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    const segunda = (fetchMock.mock.calls[1] as [string, RequestInit])[1];
    expect(primeira.headers).toEqual(expect.objectContaining({ access_token: 'primeira' }));
    expect(segunda.headers).toEqual(expect.objectContaining({ access_token: 'segunda' }));
  });
});

describe('getMyAccount — validação de credencial', () => {
  it('consulta /myAccount com a chave da própria credencial', async () => {
    fetchMock.mockImplementation(() => Response.json({ name: 'Clínica X', email: 'c@x.test' }));
    const clinica = createAsaasClient({ apiKey: 'chave-da-clinica' });

    await expect(clinica.getMyAccount()).resolves.toEqual({
      name: 'Clínica X',
      email: 'c@x.test',
    });

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox.asaas.com/api/v3/myAccount');
    expect(request.method).toBe('GET');
    expect(request.headers).toEqual(expect.objectContaining({ access_token: 'chave-da-clinica' }));
  });

  it('tolera payload sem os campos esperados (o formato é do Asaas, não nosso)', async () => {
    fetchMock.mockImplementation(() => Response.json({ algoNovo: 123 }));

    await expect(createAsaasClient({ apiKey: 'k' }).getMyAccount()).resolves.toEqual({
      name: null,
      email: null,
    });
  });

  it('propaga 401 como erro definitivo, sem re-tentar', async () => {
    fetchMock.mockImplementation(() =>
      Response.json({ errors: [{ code: 'invalid_apiKey' }] }, { status: 401 }),
    );

    const error = await createAsaasClient({ apiKey: 'errada' })
      .getMyAccount({ attempts: 1 })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BillingProviderError);
    expect((error as BillingProviderError).providerErrorCodes).toEqual(['invalid_apiKey']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('estorno e cancelamento de cobrança (ADR-049 1.5)', () => {
  it('expõe o estado autoritativo do objeto chargeback no GET da cobrança', async () => {
    fetchMock.mockImplementation(() =>
      Response.json({
        id: 'pay_1',
        status: 'CONFIRMED',
        value: 100,
        chargeback: { status: 'IN_DISPUTE', reason: 'COMMERCIAL_DISAGREEMENT' },
      }),
    );

    await expect(
      createAsaasClient({ apiKey: 'k' }).getPayment('pay_1', { attempts: 1 }),
    ).resolves.toMatchObject({
      chargebackStatus: 'IN_DISPUTE',
      chargebackReason: 'COMMERCIAL_DISAGREEMENT',
    });
  });

  it('estorna pelo endpoint de refund, com a chave da própria clínica', async () => {
    fetchMock.mockImplementation(() =>
      Response.json({
        id: 'pay_1',
        status: 'RECEIVED',
        value: 150,
        refunds: [{ status: 'PENDING', value: 150 }],
      }),
    );
    const clinica = createAsaasClient({ apiKey: 'chave-da-clinica' });

    await expect(clinica.refundPayment('pay_1')).resolves.toEqual({
      refundId: null,
      status: 'PENDING',
      value: 150,
    });

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox.asaas.com/api/v3/payments/pay_1/refund');
    expect(request.method).toBe('POST');
    expect(request.headers).toEqual(expect.objectContaining({ access_token: 'chave-da-clinica' }));
    // Estorno TOTAL por padrão: nenhum caminho do Qoro devolve sinal pela metade.
    expect(JSON.parse(String(request.body))).toEqual({});
  });

  it('NÃO re-tenta o estorno: um segundo POST seria um segundo estorno', async () => {
    fetchMock.mockImplementation(() => new Response(null, { status: 502 }));

    await expect(createAsaasClient({ apiKey: 'k' }).refundPayment('pay_1')).rejects.toBeInstanceOf(
      Error,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lista estornos para read-back sem repetir o POST', async () => {
    fetchMock.mockImplementation(() =>
      Response.json({
        data: [
          { id: 'ref_1', status: 'DONE', value: 30 },
          { id: 'ref_2', status: 'PENDING', value: '10.50' },
        ],
      }),
    );

    await expect(
      createAsaasClient({ apiKey: 'k' }).listPaymentRefunds('pay/1', { attempts: 1 }),
    ).resolves.toEqual([
      { refundId: 'ref_1', status: 'DONE', value: 30 },
      { refundId: 'ref_2', status: 'PENDING', value: 10.5 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.asaas.com/api/v3/payments/pay%2F1/refunds?offset=0&limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('tolera lista de estornos sem data', async () => {
    fetchMock.mockImplementation(() => Response.json({ unexpected: true }));

    await expect(
      createAsaasClient({ apiKey: 'k' }).listPaymentRefunds('pay_1', { attempts: 1 }),
    ).resolves.toEqual([]);
  });

  it('escapa o id na URL (id do provedor nunca é concatenado cru)', async () => {
    fetchMock.mockImplementation(() => Response.json({ deleted: true }));

    await createAsaasClient({ apiKey: 'k' }).cancelPayment('pay/../../admin');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox.asaas.com/api/v3/payments/pay%2F..%2F..%2Fadmin');
  });

  it('remove a cobrança não paga pelo DELETE', async () => {
    fetchMock.mockImplementation(() => Response.json({ deleted: true, id: 'pay_1' }));

    await expect(createAsaasClient({ apiKey: 'k' }).cancelPayment('pay_1')).resolves.toEqual({
      deleted: true,
    });

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox.asaas.com/api/v3/payments/pay_1');
    expect(request.method).toBe('DELETE');
  });

  it('204 sem corpo também é remoção bem-sucedida', async () => {
    fetchMock.mockImplementation(() => new Response(null, { status: 204 }));

    await expect(createAsaasClient({ apiKey: 'k' }).cancelPayment('pay_1')).resolves.toEqual({
      deleted: true,
    });
  });

  it('404 sobe com httpStatus — é assim que o chamador sabe que já não existe', async () => {
    fetchMock.mockImplementation(() =>
      Response.json({ errors: [{ code: 'not_found' }] }, { status: 404 }),
    );

    const error = await createAsaasClient({ apiKey: 'k' })
      .cancelPayment('pay_sumiu')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BillingProviderError);
    expect((error as BillingProviderError).httpStatus).toBe(404);
  });
});
