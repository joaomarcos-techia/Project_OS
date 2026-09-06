/**
 * Webhook Asaas do PACIENTE (ADR-049 1.4) — espelha os 23 testes do webhook de
 * assinatura, com o que muda por a conta ser da CLÍNICA.
 *
 * O invariante que a maioria destes testes protege é um só: **o corpo não decide
 * nada.** Ele traz identificadores; status e valor vêm de `getPayment` com a chave
 * daquela clínica. Sem isso, um `PAYMENT_RECEIVED` forjado confirmaria uma consulta
 * sem ninguém ter pago.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  markDepositPaid: vi.fn(),
  parseWebhook: vi.fn(),
  getPayment: vi.fn(),
  findPaymentByCheckoutSession: vi.fn(),
  listPaymentRefunds: vi.fn(),
  reconcileRefundIntentsForPayment: vi.fn(),
  classifyPatientPaymentRisk: vi.fn(),
  reconcilePatientPaymentRisk: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/observability/capture', () => ({ captureBackgroundError: vi.fn() }));
vi.mock('@/lib/observability/context', () => ({
  runWithContext: (_c: unknown, fn: () => unknown) => fn(),
}));
vi.mock('@/lib/audit/request-context', () => ({
  buildRequestContext: () => ({ requestId: 'req-1' }),
}));
vi.mock('@/lib/payments/account-store', () => ({ resolvePatientWebhookAccount: mocks.resolve }));
vi.mock('@/contexts/payments/internal/charge-store', () => ({
  markDepositPaid: mocks.markDepositPaid,
}));
vi.mock('@/contexts/payments/internal/excess-refund', () => ({
  reconcileRefundIntentsForPayment: mocks.reconcileRefundIntentsForPayment,
}));
vi.mock('@/contexts/payments/internal/patient-payment-risk', () => ({
  classifyPatientPaymentRisk: mocks.classifyPatientPaymentRisk,
  reconcilePatientPaymentRisk: mocks.reconcilePatientPaymentRisk,
}));

import { metrics } from '@/lib/observability/metrics';

import { POST } from './route';

const REF = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'token-desta-clinica';

const params = (ref = REF) => ({ params: Promise.resolve({ ref }) });

function request(opts?: { token?: string | null; body?: string; contentLength?: string }) {
  const headers = new Headers();
  if (opts?.token !== null) headers.set('asaas-access-token', opts?.token ?? TOKEN);
  if (opts?.contentLength) headers.set('content-length', opts.contentLength);
  return new Request('https://app.test/api/webhooks/asaas/patient/' + REF, {
    method: 'POST',
    headers,
    body: opts?.body ?? '{"id":"evt_1","event":"PAYMENT_RECEIVED","payment":{"id":"pay_1"}}',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.parseWebhook.mockReturnValue({
    eventId: 'evt_1',
    event: 'PAYMENT_RECEIVED',
    paymentId: 'pay_1',
    checkoutId: null,
  });
  mocks.getPayment.mockResolvedValue({
    paymentId: 'pay_1',
    status: 'RECEIVED',
    value: 150,
    dueDate: '2026-09-01',
    invoiceUrl: null,
    subscriptionId: null,
    billingType: 'PIX',
    externalReference: 'deposit:apt-1',
    checkoutSessionId: null,
    deleted: false,
  });
  mocks.resolve.mockResolvedValue({
    clinicId: 'clinic-1',
    webhookToken: TOKEN,
    client: {
      parseWebhook: mocks.parseWebhook,
      getPayment: mocks.getPayment,
      findPaymentByCheckoutSession: mocks.findPaymentByCheckoutSession,
      listPaymentRefunds: mocks.listPaymentRefunds,
    },
  });
  mocks.findPaymentByCheckoutSession.mockResolvedValue(null);
  mocks.listPaymentRefunds.mockResolvedValue([]);
  mocks.reconcileRefundIntentsForPayment.mockImplementation(
    async (input: { loadRefunds: () => Promise<unknown> }) => {
      await input.loadRefunds();
      return 0;
    },
  );
  mocks.classifyPatientPaymentRisk.mockReturnValue(null);
  mocks.reconcilePatientPaymentRisk.mockResolvedValue('changed');
  mocks.markDepositPaid.mockResolvedValue('paid');
});

describe('resolução do ref', () => {
  it('ref que não resolve devolve 404 — nunca um erro específico', async () => {
    mocks.resolve.mockResolvedValue(null);
    const res = await POST(request(), params());
    expect(res.status).toBe(404);
  });

  it('ref com formato inválido nem chega ao banco', async () => {
    const res = await POST(request(), params('nao-e-uuid'));
    expect(res.status).toBe(404);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('conta inativa/sem token é indistinguível de ref inexistente', async () => {
    mocks.resolve.mockResolvedValue(null);
    const res = await POST(request(), params());
    expect(await res.text()).toBe('not found');
  });
});

describe('token da clínica', () => {
  it('token errado devolve 401 e não consulta o gateway', async () => {
    const res = await POST(request({ token: 'token-de-outra-clinica' }), params());
    expect(res.status).toBe(401);
    expect(mocks.getPayment).not.toHaveBeenCalled();
  });

  it('sem header de token devolve 401', async () => {
    const res = await POST(request({ token: null }), params());
    expect(res.status).toBe(401);
  });

  it('token de OUTRA clínica não vale nesta rota', async () => {
    mocks.resolve.mockResolvedValue({
      clinicId: 'clinic-2',
      webhookToken: 'token-da-clinica-2',
      client: {
        parseWebhook: mocks.parseWebhook,
        getPayment: mocks.getPayment,
        findPaymentByCheckoutSession: mocks.findPaymentByCheckoutSession,
        listPaymentRefunds: mocks.listPaymentRefunds,
      },
    });
    const res = await POST(request({ token: TOKEN }), params());
    expect(res.status).toBe(401);
    expect(mocks.markDepositPaid).not.toHaveBeenCalled();
  });
});

describe('estorno e risco financeiro', () => {
  it('evento de estorno confirma D50 somente após read-back do provider', async () => {
    mocks.parseWebhook.mockReturnValue({
      eventId: 'evt_refund',
      event: 'PAYMENT_PARTIALLY_REFUNDED',
      paymentId: 'pay_1',
      checkoutId: null,
    });
    mocks.getPayment.mockResolvedValue({
      paymentId: 'pay_1',
      status: 'REFUNDED',
      value: 150,
      dueDate: '2026-09-01',
      invoiceUrl: null,
      subscriptionId: null,
      billingType: 'PIX',
      externalReference: null,
    });
    const refunds = [{ refundId: 'ref_1', status: 'REFUNDED', value: 50 }];
    mocks.listPaymentRefunds.mockResolvedValue(refunds);
    mocks.reconcileRefundIntentsForPayment.mockImplementation(
      async (input: { loadRefunds: () => Promise<unknown> }) => {
        await input.loadRefunds();
        return 1;
      },
    );

    const res = await POST(request(), params());

    expect(res.status).toBe(200);
    expect(mocks.listPaymentRefunds).toHaveBeenCalledWith('pay_1', { attempts: 1 });
    expect(mocks.reconcileRefundIntentsForPayment).toHaveBeenCalledWith({
      clinicId: 'clinic-1',
      providerPaymentId: 'pay_1',
      loadRefunds: expect.any(Function),
      providerPaymentStatus: 'REFUNDED',
    });
    expect(mocks.markDepositPaid).not.toHaveBeenCalled();
  });

  it('chargeback usa o pagamento verificado e não entra no fluxo de baixa', async () => {
    mocks.parseWebhook.mockReturnValue({
      eventId: 'evt_cb',
      event: 'PAYMENT_CHARGEBACK_DISPUTE',
      paymentId: 'pay_1',
      checkoutId: null,
    });
    mocks.classifyPatientPaymentRisk.mockReturnValue('in_dispute');

    const res = await POST(request(), params());

    expect(res.status).toBe(200);
    expect(mocks.reconcilePatientPaymentRisk).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: 'clinic-1',
        providerPaymentId: 'pay_1',
        asaasEventId: 'evt_cb',
        state: 'in_dispute',
      }),
    );
    expect(mocks.markDepositPaid).not.toHaveBeenCalled();
  });
});

describe('tamanho e formato', () => {
  it('content-length acima do teto devolve 413 antes de ler o corpo', async () => {
    const res = await POST(request({ contentLength: '2000000' }), params());
    expect(res.status).toBe(413);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('corpo maior que o teto devolve 413 mesmo sem content-length', async () => {
    const res = await POST(request({ body: 'x'.repeat(1_000_001) }), params());
    expect(res.status).toBe(413);
  });

  it('corpo impossível de parsear devolve 400', async () => {
    mocks.parseWebhook.mockImplementation(() => {
      throw new Error('sem id');
    });
    const res = await POST(request(), params());
    expect(res.status).toBe(400);
  });

  it('evento sem paymentId é aceito e ignorado', async () => {
    mocks.parseWebhook.mockReturnValue({
      eventId: 'evt_1',
      event: 'PAYMENT_CREATED',
      paymentId: null,
      checkoutId: null,
    });
    const res = await POST(request(), params());
    expect(res.status).toBe(200);
    expect(mocks.getPayment).not.toHaveBeenCalled();
  });
});

describe('o corpo NÃO decide', () => {
  it('consulta o pagamento com a chave da clínica antes de qualquer escrita', async () => {
    await POST(request(), params());
    expect(mocks.getPayment).toHaveBeenCalledWith('pay_1', { attempts: 1 });
  });

  it('corpo diz RECEIVED mas o gateway diz PENDING: não concilia nada', async () => {
    mocks.getPayment.mockResolvedValue({
      paymentId: 'pay_1',
      status: 'PENDING',
      value: 150,
      dueDate: '2026-09-01',
      invoiceUrl: null,
      subscriptionId: null,
      billingType: 'PIX',
      externalReference: null,
    });

    const res = await POST(request(), params());

    expect(res.status).toBe(200);
    expect(mocks.markDepositPaid).not.toHaveBeenCalled();
  });

  it('falha ao verificar devolve 500 para o Asaas re-entregar', async () => {
    mocks.getPayment.mockRejectedValue(new Error('timeout'));
    const res = await POST(request(), params());
    expect(res.status).toBe(500);
    expect(mocks.markDepositPaid).not.toHaveBeenCalled();
  });

  it('usa o paymentId VERIFICADO, não o do corpo', async () => {
    mocks.getPayment.mockResolvedValue({
      paymentId: 'pay_real',
      status: 'CONFIRMED',
      value: 150,
      dueDate: '2026-09-01',
      invoiceUrl: null,
      subscriptionId: null,
      billingType: 'PIX',
      externalReference: null,
    });

    await POST(request(), params());

    expect(mocks.markDepositPaid).toHaveBeenCalledWith(
      expect.objectContaining({ providerPaymentId: 'pay_real' }),
    );
  });
});

describe('conciliação', () => {
  it('pagamento confirmado concilia e responde 200', async () => {
    const res = await POST(request(), params());
    expect(res.status).toBe(200);
    expect(mocks.markDepositPaid).toHaveBeenCalledWith({
      clinicId: 'clinic-1',
      providerPaymentId: 'pay_1',
      asaasEventId: 'evt_1',
      eventType: 'PAYMENT_RECEIVED',
      paidAt: expect.any(Date),
      // ADR-051 1.5b.1 — a forma de pagamento vem do `getPayment` (fonte da
      // verdade), NUNCA do corpo do webhook: é ela que vira a forma da baixa no
      // Caixa, e o corpo é forjável por quem tiver o token.
      billingType: 'PIX',
      checkoutSessionId: null,
    });
  });

  it('CHECKOUT_PAID resolve a cobrança pela sessão antes de conciliar', async () => {
    mocks.parseWebhook.mockReturnValue({
      eventId: 'evt_checkout_paid',
      event: 'CHECKOUT_PAID',
      paymentId: null,
      checkoutId: 'checkout-1',
    });
    mocks.findPaymentByCheckoutSession.mockResolvedValue({
      paymentId: 'pay-checkout-1',
      status: 'RECEIVED',
      value: 150,
      dueDate: '2026-09-01',
      invoiceUrl: null,
      subscriptionId: null,
      billingType: 'CREDIT_CARD',
      externalReference: 'deposit:apt-1:g1',
      checkoutSessionId: 'checkout-1',
      deleted: false,
    });

    const res = await POST(request(), params());

    expect(res.status).toBe(200);
    expect(mocks.getPayment).not.toHaveBeenCalled();
    expect(mocks.findPaymentByCheckoutSession).toHaveBeenCalledWith('checkout-1', {
      attempts: 1,
    });
    expect(mocks.markDepositPaid).toHaveBeenCalledWith(
      expect.objectContaining({
        providerPaymentId: 'pay-checkout-1',
        checkoutSessionId: 'checkout-1',
        billingType: 'CREDIT_CARD',
      }),
    );
  });

  it('CHECKOUT_PAID ainda não consultável devolve 500 para reentrega', async () => {
    mocks.parseWebhook.mockReturnValue({
      eventId: 'evt_checkout_paid',
      event: 'CHECKOUT_PAID',
      paymentId: null,
      checkoutId: 'checkout-1',
    });

    const res = await POST(request(), params());

    expect(res.status).toBe(500);
    expect(mocks.markDepositPaid).not.toHaveBeenCalled();
  });

  it('RECEIVED_IN_CASH também conta como pago', async () => {
    mocks.getPayment.mockResolvedValue({
      paymentId: 'pay_1',
      status: 'RECEIVED_IN_CASH',
      value: 150,
      dueDate: '2026-09-01',
      invoiceUrl: null,
      subscriptionId: null,
      billingType: 'PIX',
      externalReference: null,
    });

    await POST(request(), params());
    expect(mocks.markDepositPaid).toHaveBeenCalled();
  });

  it('re-entrega do mesmo evento é aceita sem reprocessar', async () => {
    mocks.markDepositPaid.mockResolvedValue('ignored');
    const res = await POST(request(), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: 'ignored' });
  });

  it('pagamento de cobrança desconhecida responde 200 sem quebrar', async () => {
    mocks.markDepositPaid.mockResolvedValue('unknown_charge');
    const res = await POST(request(), params());
    expect(res.status).toBe(200);
  });

  it('erro ao conciliar devolve 500 para o Asaas re-entregar', async () => {
    mocks.markDepositPaid.mockRejectedValue(new Error('deadlock'));
    const res = await POST(request(), params());
    expect(res.status).toBe(500);
  });

  it('OVERDUE não move nada — quem libera a vaga é a expiração do hold', async () => {
    mocks.getPayment.mockResolvedValue({
      paymentId: 'pay_1',
      status: 'OVERDUE',
      value: 150,
      dueDate: '2026-09-01',
      invoiceUrl: null,
      subscriptionId: null,
      billingType: 'PIX',
      externalReference: null,
    });

    await POST(request(), params());
    expect(mocks.markDepositPaid).not.toHaveBeenCalled();
  });
});

describe('observabilidade', () => {
  it('token inválido é métrica com a clínica, para investigar forja', async () => {
    await POST(request({ token: 'errado' }), params());
    expect(metrics.emit).toHaveBeenCalledWith('payments.webhook.invalid_token', {
      clinicId: 'clinic-1',
    });
  });

  it('ref desconhecido NÃO carrega clínica na métrica (não há clínica)', async () => {
    mocks.resolve.mockResolvedValue(null);
    await POST(request(), params());
    expect(metrics.emit).toHaveBeenCalledWith('payments.webhook.unknown_ref', {});
  });

  it('registra o desfecho da conciliação', async () => {
    await POST(request(), params());
    expect(metrics.emit).toHaveBeenCalledWith('payments.webhook.processed', {
      clinicId: 'clinic-1',
      outcome: 'paid',
    });
  });
});
