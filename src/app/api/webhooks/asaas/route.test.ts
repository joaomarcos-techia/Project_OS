/**
 * A2 (auditoria de APIs) — verify-then-act no webhook Asaas.
 *
 * A propriedade sob teste: o corpo do webhook é NOTIFICAÇÃO. Como o Asaas só manda
 * um token estático (sem HMAC do corpo), quem tiver o token forja qualquer campo —
 * então nada que o corpo afirme (status, valor, subscription) pode dirigir estado.
 * A verdade vem de `getPayment()`.
 *
 * `parseWebhook` REAL (é ele que exige `body.id`); só `getPayment` e
 * `validateWebhookToken` são stubados. `dbAdmin` é mockado via vi.hoisted — um
 * `import { dbAdmin }` aqui violaria o arch:db-check (origem de conexão).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AsaasProviderModule from '@/contexts/billing/internal/providers/asaas';

const { transactionMock, getPayment, validateWebhookToken, emit } = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  getPayment: vi.fn(),
  validateWebhookToken: vi.fn(() => true),
  emit: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ dbAdmin: { transaction: transactionMock } }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));
vi.mock('@/lib/env', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  assertBillingWebhookReady: () => {},
}));
vi.mock('@/contexts/billing/internal/providers/asaas', async (orig) => {
  const actual = await orig<typeof AsaasProviderModule>();
  return {
    ...actual,
    asaasProvider: { ...actual.asaasProvider, getPayment, validateWebhookToken },
  };
});
vi.mock('@/contexts/billing/internal/subscriptions', () => ({
  ensureInvoiceForPayment: vi.fn(async () => ({
    id: 'inv-1',
    clinicId: 'clinic-1',
    status: 'open',
    dueDate: '2026-08-24',
    totalAmount: '199.00',
  })),
  findInvoiceByProviderPayment: vi.fn(async () => ({
    id: 'inv-1',
    clinicId: 'clinic-1',
    status: 'open',
    dueDate: '2026-08-24',
    totalAmount: '199.00',
  })),
  // BILLING-002 — devolve a invoice (possivelmente reconciliada) para o caller
  // pagar/vencer sobre o estado atual, não sobre o que estava em memória.
  syncInvoiceFromProviderPayment: vi.fn(async () => ({
    action: { kind: 'noop', reason: 'in_sync' },
    invoice: {
      id: 'inv-1',
      clinicId: 'clinic-1',
      status: 'open',
      dueDate: '2026-08-24',
      totalAmount: '199.00',
    },
  })),
  markInvoicePaid: vi.fn(async () => {}),
  markInvoiceOverdue: vi.fn(async () => {}),
  markInvoiceRefunded: vi.fn(async () => {}),
}));

import {
  ensureInvoiceForPayment,
  findInvoiceByProviderPayment,
  markInvoiceOverdue,
  markInvoicePaid,
  markInvoiceRefunded,
  syncInvoiceFromProviderPayment,
} from '@/contexts/billing/internal/subscriptions';
import { BillingProviderError } from '@/contexts/billing/internal/providers/asaas';

import { POST } from './route';

const PAYMENT = {
  paymentId: 'pay_1',
  status: 'PENDING',
  value: 100,
  dueDate: '2026-07-01',
  invoiceUrl: null,
  subscriptionId: 'sub_1',
  billingType: 'PIX',
  externalReference: null,
};

/** tx falso com dedup real: o 1º insert de um eventId ganha, os seguintes perdem. */
function fakeTx(seen: Set<string>) {
  return {
    insert: () => ({
      values: (v: { asaasEventId: string }) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (seen.has(v.asaasEventId)) return [];
            seen.add(v.asaasEventId);
            return [{ id: v.asaasEventId }];
          },
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request('https://qoro.app/api/webhooks/asaas', {
      method: 'POST',
      headers: { 'asaas-access-token': 'tok', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

const verifyMetric = () => emit.mock.calls.find((c) => c[0] === 'billing.webhook.verify')?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  validateWebhookToken.mockReturnValue(true);
  getPayment.mockResolvedValue(PAYMENT);
  const seen = new Set<string>();
  transactionMock.mockImplementation(((fn: (t: unknown) => unknown) => fn(fakeTx(seen))) as never);
});

describe('token', () => {
  it('token inválido → 401, sem consultar o provider', async () => {
    validateWebhookToken.mockReturnValue(false);
    const res = await post({ id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } });
    expect(res.status).toBe(401);
    expect(getPayment).not.toHaveBeenCalled();
  });
});

describe('dedup key (A2)', () => {
  it('sem body.id → 400 e nada é processado', async () => {
    const res = await post({
      event: 'PAYMENT_RECEIVED',
      payment: { id: 'pay_1', status: 'RECEIVED' },
    });
    expect(res.status).toBe(400);
    expect(getPayment).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('billing.webhook.unparseable', expect.anything());
  });

  it('corpo não-JSON → 400', async () => {
    expect((await post('not json')).status).toBe(400);
  });

  it('body.id presente → usa o id do provider como chave de dedup', async () => {
    getPayment.mockResolvedValue({ ...PAYMENT, status: 'RECEIVED' });
    await post({ id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } });
    expect(markInvoicePaid).toHaveBeenCalledWith(
      expect.anything(),
      'clinic-1',
      expect.anything(),
      expect.objectContaining({ idemSuffix: 'evt_1' }),
    );
  });
});

describe('verify-then-act (A2) — o corpo não dirige estado', () => {
  it('corpo forjado diz PAYMENT_CONFIRMED, provider diz PENDING → NÃO marca paga', async () => {
    getPayment.mockResolvedValue({ ...PAYMENT, status: 'PENDING' });
    const res = await post({
      id: 'evt_forjado',
      event: 'PAYMENT_CONFIRMED',
      payment: { id: 'pay_1', status: 'CONFIRMED', value: 999_999 },
    });
    expect(res.status).toBe(200);
    // Esta é a linha que fecha o A2: o vetor "reabrir clínica bloqueada com o
    // token vazado" morre aqui, porque markInvoicePaid → setClinicAccess.
    expect(markInvoicePaid).not.toHaveBeenCalled();
  });

  it('corpo diz OVERDUE, provider diz RECEIVED → segue o provider (marca paga)', async () => {
    getPayment.mockResolvedValue({ ...PAYMENT, status: 'RECEIVED' });
    await post({
      id: 'evt_2',
      event: 'PAYMENT_OVERDUE',
      payment: { id: 'pay_1', status: 'OVERDUE' },
    });
    expect(markInvoicePaid).toHaveBeenCalledTimes(1);
    expect(markInvoiceOverdue).not.toHaveBeenCalled();
  });

  it('valor/subscription persistidos vêm do provider, não do corpo', async () => {
    getPayment.mockResolvedValue({
      ...PAYMENT,
      status: 'RECEIVED',
      value: 100,
      subscriptionId: 'sub_1',
    });
    await post({
      id: 'evt_3',
      event: 'PAYMENT_RECEIVED',
      payment: { id: 'pay_1', value: 1, subscription: 'sub_de_outra_clinica' },
    });
    expect(ensureInvoiceForPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ value: 100, subscriptionId: 'sub_1' }),
    );
  });

  it('OVERDUE real → overdue; REFUNDED real → refunded', async () => {
    getPayment.mockResolvedValue({ ...PAYMENT, status: 'OVERDUE' });
    await post({ id: 'evt_4', event: 'PAYMENT_OVERDUE', payment: { id: 'pay_1' } });
    expect(markInvoiceOverdue).toHaveBeenCalledTimes(1);

    getPayment.mockResolvedValue({ ...PAYMENT, status: 'REFUNDED' });
    await post({ id: 'evt_5', event: 'PAYMENT_REFUNDED', payment: { id: 'pay_1' } });
    expect(markInvoiceRefunded).toHaveBeenCalledTimes(1);
  });

  it('status sem ação (PENDING) → materializa invoice, sem transição', async () => {
    await post({ id: 'evt_6', event: 'PAYMENT_CREATED', payment: { id: 'pay_1' } });
    expect(ensureInvoiceForPayment).toHaveBeenCalledTimes(1);
    expect(markInvoicePaid).not.toHaveBeenCalled();
    expect(markInvoiceOverdue).not.toHaveBeenCalled();
  });

  it('verificação usa attempts:1 (orçamento de 30s do maxDuration)', async () => {
    await post({ id: 'evt_7', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } });
    expect(getPayment).toHaveBeenCalledWith('pay_1', { attempts: 1 });
  });
});

describe('falha da verificação', () => {
  it('getPayment indisponível → 500 e NADA é persistido (Asaas re-entrega)', async () => {
    getPayment.mockRejectedValue(new Error('timeout'));
    const res = await post({ id: 'evt_8', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } });
    expect(res.status).toBe(500);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(markInvoicePaid).not.toHaveBeenCalled();
  });

  it('métrica: outcome ok | timeout | failure', async () => {
    await post({ id: 'evt_9', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } });
    expect(verifyMetric()).toMatchObject({ outcome: 'ok' });
    expect(verifyMetric()).toHaveProperty('duration_ms', expect.any(Number));

    vi.clearAllMocks();
    getPayment.mockRejectedValue(new Error('boom')); // indeterminado
    await post({ id: 'evt_10', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } });
    expect(verifyMetric()).toMatchObject({ outcome: 'timeout' });

    vi.clearAllMocks();
    getPayment.mockRejectedValue(new BillingProviderError('404', 'not_found', 404)); // definitivo
    await post({ id: 'evt_11', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } });
    expect(verifyMetric()).toMatchObject({ outcome: 'failure' });
  });
});

describe('dedup / concorrência', () => {
  // Não prova a atomicidade do Postgres (isso é do UNIQUE + onConflictDoNothing);
  // prova que a ROTA honra o resultado do dedup em vez de processar duas vezes.
  it('duas entregas simultâneas do mesmo evento → uma única transição', async () => {
    getPayment.mockResolvedValue({ ...PAYMENT, status: 'RECEIVED' });
    const body = { id: 'evt_dup', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } };

    const [a, b] = await Promise.all([post(body), post(body)]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(markInvoicePaid).toHaveBeenCalledTimes(1);
  });

  it('re-entrega sequencial → duplicate, sem segunda transição', async () => {
    getPayment.mockResolvedValue({ ...PAYMENT, status: 'RECEIVED' });
    const body = { id: 'evt_seq', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } };
    await post(body);
    await post(body);
    expect(markInvoicePaid).toHaveBeenCalledTimes(1);
  });
});

describe('B5 — corpo da resposta', () => {
  it('200 devolve { received: true } e NÃO vaza clinicId', async () => {
    getPayment.mockResolvedValue({ ...PAYMENT, status: 'RECEIVED' });
    const res = await post({ id: 'evt_b5', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } });
    const json = await res.json();

    expect(json).toEqual({ received: true });
    expect(JSON.stringify(json)).not.toContain('clinic-1');
  });

  it('evento sem payment.id → 200 sem tocar no banco', async () => {
    const res = await post({ id: 'evt_nopay', event: 'PAYMENT_DELETED', payment: {} });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// BILLING-002 — reconciliação com o painel do Asaas.
// ---------------------------------------------------------------------------

describe('BILLING-002 — update e delete do painel', () => {
  it('reconcilia a invoice ANTES de decidir a transição', async () => {
    // `ensureInvoiceForPayment` devolve a invoice existente sem olhar data ou
    // valor: sem esta chamada, uma alteração no painel ficava divergente para
    // sempre. Precisa vir antes porque o período pago (BILLING-001) sai do
    // `due_date`.
    getPayment.mockResolvedValue({ ...PAYMENT, status: 'RECEIVED', dueDate: '2026-09-05' });
    await post({ id: 'evt_sync', event: 'PAYMENT_UPDATED', payment: { id: 'pay_1' } });

    expect(syncInvoiceFromProviderPayment).toHaveBeenCalledTimes(1);
    const [, , , provider] = vi.mocked(syncInvoiceFromProviderPayment).mock.calls[0]!;
    expect(provider).toMatchObject({ exists: true, dueDate: '2026-09-05', totalCents: 10_000 });
    expect(vi.mocked(syncInvoiceFromProviderPayment).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(markInvoicePaid).mock.invocationCallOrder[0]!,
    );
  });

  it('paga sobre a invoice RECONCILIADA, não sobre a que estava em memória', async () => {
    vi.mocked(syncInvoiceFromProviderPayment).mockResolvedValueOnce({
      action: { kind: 'update', dueDate: '2026-09-05', amountChanged: false },
      invoice: { id: 'inv-1', clinicId: 'clinic-1', status: 'open', dueDate: '2026-09-05' },
    } as never);
    getPayment.mockResolvedValue({ ...PAYMENT, status: 'RECEIVED', dueDate: '2026-09-05' });

    await post({ id: 'evt_sync2', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } });

    const [, , invoiceArg] = vi.mocked(markInvoicePaid).mock.calls[0]!;
    expect(invoiceArg).toMatchObject({ dueDate: '2026-09-05' });
  });

  it('PAYMENT_DELETED com 404 no GET → cancela a invoice, sem 500', async () => {
    // Antes, um delete legítimo virava 500 eterno e a invoice ficava `open`.
    getPayment.mockRejectedValue(new BillingProviderError('not found', 'not_found', 404));

    const res = await post({ id: 'evt_del', event: 'PAYMENT_DELETED', payment: { id: 'pay_1' } });

    expect(res.status).toBe(200);
    const [, , , provider, opts] = vi.mocked(syncInvoiceFromProviderPayment).mock.calls[0]!;
    expect(provider).toEqual({ exists: false });
    expect(opts).toMatchObject({ providerConfirmedMissing: true });
    // Delete NUNCA vira estorno.
    expect(markInvoiceRefunded).not.toHaveBeenCalled();
    expect(markInvoicePaid).not.toHaveBeenCalled();
  });

  it('404 em evento que NÃO alega remoção continua sendo 500 (anomalia)', async () => {
    // Um `PAYMENT_RECEIVED` cujo pagamento não existe é corpo forjado ou
    // apagado — merece re-entrega e investigação, não cancelamento silencioso.
    getPayment.mockRejectedValue(new BillingProviderError('not found', 'not_found', 404));

    const res = await post({ id: 'evt_404', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } });

    expect(res.status).toBe(500);
    expect(syncInvoiceFromProviderPayment).not.toHaveBeenCalled();
  });

  it('timeout do provider em PAYMENT_DELETED NÃO cancela nada', async () => {
    // Sem o 404 autoritativo não há prova de remoção: o Asaas re-entrega.
    getPayment.mockRejectedValue(new Error('timeout'));

    const res = await post({ id: 'evt_to', event: 'PAYMENT_DELETED', payment: { id: 'pay_1' } });

    expect(res.status).toBe(500);
    expect(syncInvoiceFromProviderPayment).not.toHaveBeenCalled();
  });

  it('delete de pagamento sem invoice local é ignorado, sem erro', async () => {
    getPayment.mockRejectedValue(new BillingProviderError('not found', 'not_found', 404));
    vi.mocked(findInvoiceByProviderPayment).mockResolvedValueOnce(null);

    const res = await post({ id: 'evt_del2', event: 'PAYMENT_DELETED', payment: { id: 'pay_x' } });

    expect(res.status).toBe(200);
    expect(syncInvoiceFromProviderPayment).not.toHaveBeenCalled();
  });

  it('replay do delete é deduplicado pelo eventId', async () => {
    getPayment.mockRejectedValue(new BillingProviderError('not found', 'not_found', 404));
    const body = { id: 'evt_del_dup', event: 'PAYMENT_DELETED', payment: { id: 'pay_1' } };

    await post(body);
    await post(body);

    expect(syncInvoiceFromProviderPayment).toHaveBeenCalledTimes(1);
  });
});
