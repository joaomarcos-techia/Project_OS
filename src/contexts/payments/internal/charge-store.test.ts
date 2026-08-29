/**
 * Conciliação do sinal (ADR-049 1.4) — `markDepositPaid`.
 *
 * É o ponto onde dinheiro recebido vira estado no sistema, e as garantias que
 * importam são de integridade financeira (§13 do plano):
 *   - dedup, conciliação e evento na MESMA transação — nunca dedup gravado com
 *     pagamento não reconhecido;
 *   - transição **monotônica**: o segundo webhook do mesmo pagamento não
 *     republica o evento (o que reconfirmaria um agendamento já cancelado depois);
 *   - re-entrega é aceita em silêncio, não vira erro.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  withTenant: vi.fn(),
  publishEvent: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/tenant', () => ({ withTenant: mocks.withTenant }));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent: mocks.publishEvent }));

import {
  closeCharge,
  findOpenCharge,
  findPayableCharge,
  insertDepositCharge,
  markDepositPaid,
  toPaymentMethodCode,
} from './charge-store';

const CHARGE = {
  id: '44444444-4444-4444-8444-444444444444',
  status: 'pending',
  appointmentId: '11111111-1111-4111-8111-111111111111',
  patientId: '22222222-2222-4222-8222-222222222222',
  kind: 'deposit' as const,
  amount: '150.00',
};

/**
 * tx falso encadeável. `dedup`/`charge`/`updated` controlam as três decisões da
 * função sem precisar de banco.
 */
function stubTx(opts: { dedup?: unknown[]; charge?: unknown[]; updated?: unknown[] }) {
  const tx = {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({ returning: async () => opts.dedup ?? [{ id: 'evt-row' }] }),
      }),
    }),
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => opts.charge ?? [CHARGE] }) }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: async () => opts.updated ?? [{ id: CHARGE.id }] }),
      }),
    }),
  };
  mocks.withTenant.mockImplementation((async (_c: string, fn: (t: unknown) => unknown) =>
    fn(tx)) as never);
}

const input = {
  clinicId: '33333333-3333-4333-8333-333333333333',
  providerPaymentId: 'pay_1',
  asaasEventId: 'evt_1',
  eventType: 'PAYMENT_RECEIVED',
  paidAt: new Date('2026-09-01T12:00:00.000Z'),
};

beforeEach(() => vi.clearAllMocks());

describe('markDepositPaid', () => {
  it('concilia e publica o evento que faz a agenda confirmar', async () => {
    stubTx({});

    await expect(markDepositPaid(input)).resolves.toBe('paid');

    const [, published] = mocks.publishEvent.mock.calls[0]!;
    expect(published.eventType).toBe('payments.patient_charge.paid');
    expect(published.payload).toMatchObject({
      chargeId: CHARGE.id,
      appointmentId: CHARGE.appointmentId,
      amount: 150,
      paidAt: '2026-09-01T12:00:00.000Z',
    });
    expect(published.idempotencyKey).toBe(`charge-paid:${CHARGE.id}`);
  });

  it('re-entrega do mesmo evento não reprocessa nem republica', async () => {
    stubTx({ dedup: [] });

    await expect(markDepositPaid(input)).resolves.toBe('ignored');
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it('pagamento de cobrança desconhecida não inventa conciliação', async () => {
    stubTx({ charge: [] });

    await expect(markDepositPaid(input)).resolves.toBe('unknown_charge');
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it('cobrança já paga não publica o evento de novo', async () => {
    stubTx({ charge: [{ ...CHARGE, status: 'paid' }] });

    await expect(markDepositPaid(input)).resolves.toBe('already_paid');
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it('perder a corrida do UPDATE não republica — quem ganhou já publicou', async () => {
    stubTx({ updated: [] });

    await expect(markDepositPaid(input)).resolves.toBe('already_paid');
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it('roda tudo dentro do escopo do tenant', async () => {
    stubTx({});

    await markDepositPaid(input);

    expect(mocks.withTenant).toHaveBeenCalledWith(input.clinicId, expect.any(Function));
    // Os eventos são publicados com o `tx` da MESMA transação, não fora dela.
    // São dois desde a 1.5b.1: `charge.paid` (agenda) e `credit.granted`
    // (financeiro) — o mesmo dinheiro, contado para dois domínios.
    expect(mocks.publishEvent).toHaveBeenCalledTimes(2);
    for (const [tx] of mocks.publishEvent.mock.calls) expect(tx).toBeDefined();
  });
});

describe('findOpenCharge — só devolve o que ainda pode ser fechado', () => {
  const openCharge = {
    id: CHARGE.id,
    status: 'pending',
    kind: 'deposit',
    amount: '150.00',
    providerPaymentId: 'pay_1',
  };

  it.each(['pending', 'paid'])('devolve a cobrança em %s', async (status) => {
    stubTx({ charge: [{ ...openCharge, status }] });

    await expect(findOpenCharge(input.clinicId, CHARGE.appointmentId)).resolves.toMatchObject({
      id: CHARGE.id,
      status,
      amount: 150,
    });
  });

  it.each(['expired', 'refunded', 'cancelled', 'failed'])(
    'devolve null em %s — estado terminal não se reabre',
    async (status) => {
      stubTx({ charge: [{ ...openCharge, status }] });

      await expect(findOpenCharge(input.clinicId, CHARGE.appointmentId)).resolves.toBeNull();
    },
  );

  it('sem cobrança devolve null', async () => {
    stubTx({ charge: [] });

    await expect(findOpenCharge(input.clinicId, CHARGE.appointmentId)).resolves.toBeNull();
  });
});

describe('closeCharge — fechamento monotônico', () => {
  const closing = {
    clinicId: input.clinicId,
    chargeId: CHARGE.id,
    from: 'paid' as const,
    outcome: 'refunded' as const,
    kind: 'deposit' as const,
    appointmentId: CHARGE.appointmentId,
    amount: 150,
    closedAt: new Date('2026-09-02T10:00:00.000Z'),
  };

  it('fecha e publica o evento que a agenda projeta, na MESMA transação', async () => {
    stubTx({});

    await expect(closeCharge(closing)).resolves.toBe(true);
    // Dois desde a 1.5b.1: o fechamento da cobrança (agenda) e a liberação do
    // crédito (financeiro). O estorno move dinheiro nos dois lados.
    expect(mocks.publishEvent).toHaveBeenCalledTimes(2);
    const [, args] = mocks.publishEvent.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(args.eventType).toBe('payments.patient_charge.closed');
    expect(args.payload).toMatchObject({ outcome: 'refunded', amount: 150 });
    // A cobrança só fecha uma vez ⇒ ela própria é a chave de idempotência.
    expect(args.idempotencyKey).toBe(`charge-closed:${CHARGE.id}`);
  });

  it('reentrega não republica: o UPDATE não acha a linha no estado de origem', async () => {
    stubTx({ updated: [] });

    await expect(closeCharge(closing)).resolves.toBe(false);
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it('roda dentro do escopo do tenant', async () => {
    stubTx({});

    await closeCharge(closing);
    expect(mocks.withTenant).toHaveBeenCalledWith(input.clinicId, expect.any(Function));
  });
});

/**
 * `findPayableCharge` (1.6a) — a guarda que impede mandar link de cobrança que
 * já não pode ser paga.
 *
 * Ela mora no seam, e não no chamador, de propósito: quem entrega a mensagem não
 * pode ser o responsável por lembrar de perguntar se ela ainda faz sentido.
 * Mandar link de cobrança JÁ PAGA é o pior desfecho desta fase.
 */
describe('findPayableCharge — só devolve link que ainda dá para pagar', () => {
  const PAGAVEL = {
    id: CHARGE.id,
    appointmentId: CHARGE.appointmentId,
    amount: '150.00',
    invoiceUrl: 'https://www.asaas.com/i/abc123',
    holdExpiresAt: new Date('2099-08-26T17:00:00.000Z'),
    providerCheckoutId: 'checkout-1',
    checkoutExpiresAt: new Date('2099-08-26T17:00:00.000Z'),
    collectionExpiresAt: new Date('2099-09-01T17:00:00.000Z'),
  };

  it('devolve a cobrança pendente com o link', async () => {
    stubTx({ charge: [PAGAVEL] });

    await expect(findPayableCharge('clinic-1', CHARGE.id)).resolves.toEqual({
      chargeId: CHARGE.id,
      appointmentId: CHARGE.appointmentId,
      amount: 150,
      invoiceUrl: 'https://www.asaas.com/i/abc123',
      holdExpiresAt: new Date('2099-08-26T17:00:00.000Z'),
    });
  });

  it('cobrança que não está mais pendente não volta (o WHERE é a trava)', async () => {
    // Paga, estornada, cancelada ou expirada: o filtro de status é do SQL, então
    // a linha simplesmente não vem.
    stubTx({ charge: [] });

    await expect(findPayableCharge('clinic-1', CHARGE.id)).resolves.toBeNull();
  });

  it('cobrança sem link não vira mensagem — não há o que o paciente abrir', async () => {
    stubTx({ charge: [{ ...PAGAVEL, invoiceUrl: null }] });

    await expect(findPayableCharge('clinic-1', CHARGE.id)).resolves.toBeNull();
  });

  it('link de geração expirada não é entregue', async () => {
    stubTx({
      charge: [
        {
          ...PAGAVEL,
          checkoutExpiresAt: new Date('2020-01-01T00:00:00.000Z'),
        },
      ],
    });

    await expect(findPayableCharge('clinic-1', CHARGE.id)).resolves.toBeNull();
  });

  it('cobrança sem identidade de Checkout não reutiliza link legado UNDEFINED', async () => {
    stubTx({ charge: [{ ...PAGAVEL, providerCheckoutId: null }] });

    await expect(findPayableCharge('clinic-1', CHARGE.id)).resolves.toBeNull();
  });

  it('lê pelo caminho tenant (RLS), nunca por dbAdmin', async () => {
    stubTx({ charge: [PAGAVEL] });

    await findPayableCharge('clinic-1', CHARGE.id);

    expect(mocks.withTenant).toHaveBeenCalledWith('clinic-1', expect.any(Function));
  });
});

/**
 * `insertDepositCharge` publica DOIS eventos, e a diferença entre eles importa.
 *
 * `created` é para a AGENDA (segura a vaga) e sempre sai. `link_ready` é para a
 * ENTREGA (1.6a) e só sai quando existe link — `invoiceUrl` é nullable, e
 * enfileirar mensagem sem link deixaria o paciente com um "pague neste link:"
 * seguido de nada, para uma consulta que ele perde se não pagar.
 */
describe('insertDepositCharge — os dois eventos', () => {
  const novaCobranca = {
    clinicId: 'clinic-1',
    appointmentId: CHARGE.appointmentId,
    patientId: CHARGE.patientId,
    amount: 150,
    providerPaymentId: 'pay_1',
    holdExpiresAt: new Date('2026-08-26T17:00:00.000Z'),
  };

  const publicados = () =>
    mocks.publishEvent.mock.calls.map((c) => (c[1] as { eventType: string }).eventType);

  beforeEach(() => {
    // `returning` do INSERT devolve a linha criada.
    stubTx({ dedup: [{ id: CHARGE.id }] });
  });

  it('com link: publica created (agenda) E link_ready (entrega)', async () => {
    await insertDepositCharge({ ...novaCobranca, invoiceUrl: 'https://www.asaas.com/i/abc' });

    expect(publicados()).toEqual([
      'payments.patient_charge.created',
      'payments.patient_charge.link_ready',
    ]);
  });

  it('SEM link: publica só o created — não há o que entregar', async () => {
    await insertDepositCharge({ ...novaCobranca, invoiceUrl: null });

    expect(publicados()).toEqual(['payments.patient_charge.created']);
  });

  it('o link NÃO entra no payload de nenhum dos dois eventos', async () => {
    await insertDepositCharge({ ...novaCobranca, invoiceUrl: 'https://www.asaas.com/i/abc' });

    // O outbox é lido por operador e por worker: link de pagamento ali é link
    // de pagamento vazado.
    const payloads = mocks.publishEvent.mock.calls.map(
      (c) => (c[1] as { payload: unknown }).payload,
    );
    expect(JSON.stringify(payloads)).not.toMatch(/https?:\/\//);
  });

  it('a corrida perdedora não publica nada (UNIQUE barrou o insert)', async () => {
    stubTx({ dedup: [] });

    await expect(
      insertDepositCharge({ ...novaCobranca, invoiceUrl: 'https://www.asaas.com/i/abc' }),
    ).resolves.toBeNull();
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });
});

/**
 * ADR-051 1.5b.1 — o MESMO dinheiro, contado também para o Financial.
 *
 * Os dois eventos saem na MESMA transação de propósito: reconhecer o pagamento
 * sem registrar o crédito deixaria dinheiro recebido que o Caixa nunca vê.
 */
describe('markDepositPaid — evento de crédito para o Financial', () => {
  const input = {
    clinicId: 'clinic-1',
    providerPaymentId: 'pay_1',
    asaasEventId: 'evt_1',
    eventType: 'PAYMENT_RECEIVED',
    paidAt: new Date('2026-08-25T12:00:00.000Z'),
  };

  const publicados = () =>
    mocks.publishEvent.mock.calls.map((c) => (c[1] as { eventType: string }).eventType);
  const creditPayload = () =>
    mocks.publishEvent.mock.calls.find(
      (c) => (c[1] as { eventType: string }).eventType === 'payments.patient_credit.granted',
    )?.[1] as { payload: Record<string, unknown> } | undefined;

  it('pagamento conciliado publica charge.paid E credit.granted', async () => {
    stubTx({});

    await expect(markDepositPaid({ ...input, billingType: 'PIX' })).resolves.toBe('paid');

    expect(publicados()).toEqual([
      'payments.patient_charge.paid',
      'payments.patient_credit.granted',
    ]);
  });

  it('o crédito leva a forma de pagamento traduzida para o catálogo', async () => {
    stubTx({});

    await markDepositPaid({ ...input, billingType: 'CREDIT_CARD' });

    expect(creditPayload()?.payload).toMatchObject({
      chargeId: CHARGE.id,
      appointmentId: CHARGE.appointmentId,
      kind: 'deposit',
      amount: 150,
      paymentMethod: 'cartao_credito',
    });
  });

  it('sem billingType reconhecido, o crédito vai sem forma de pagamento', async () => {
    stubTx({});

    await markDepositPaid({ ...input, billingType: 'UNDEFINED' });

    expect(creditPayload()?.payload).toMatchObject({ paymentMethod: null });
  });

  it('reentrega do webhook não publica crédito de novo', async () => {
    // Dedup do webhook já barra: nada é publicado.
    stubTx({ dedup: [] });

    await expect(markDepositPaid({ ...input, billingType: 'PIX' })).resolves.toBe('ignored');
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it('cobrança do restante vira crédito de `remaining_payment`', async () => {
    stubTx({ charge: [{ ...CHARGE, kind: 'remainder' }] });

    await markDepositPaid({ ...input, billingType: 'PIX' });

    expect(creditPayload()?.payload).toMatchObject({ kind: 'remaining_payment' });
  });
});

describe('closeCharge — liberação do crédito', () => {
  const base = {
    clinicId: 'clinic-1',
    chargeId: CHARGE.id,
    kind: 'deposit' as const,
    appointmentId: CHARGE.appointmentId,
    amount: 150,
    closedAt: new Date('2026-08-25T13:00:00.000Z'),
  };
  const publicados = () =>
    mocks.publishEvent.mock.calls.map((c) => (c[1] as { eventType: string }).eventType);

  it('estorno publica charge.closed E credit.released{refunded}', async () => {
    stubTx({});

    await closeCharge({ ...base, from: 'paid', outcome: 'refunded' });

    expect(publicados()).toEqual([
      'payments.patient_charge.closed',
      'payments.patient_credit.released',
    ]);
    const rel = mocks.publishEvent.mock.calls[1]![1] as { payload: Record<string, unknown> };
    expect(rel.payload).toMatchObject({ disposition: 'refunded' });
  });

  it.each(['cancelled', 'expired'] as const)(
    '%s NÃO libera crédito — cobrança não paga nunca virou crédito',
    async (outcome) => {
      stubTx({});

      await closeCharge({ ...base, from: 'pending', outcome });

      expect(publicados()).toEqual(['payments.patient_charge.closed']);
    },
  );
});

describe('toPaymentMethodCode — gateway → catálogo do Financial', () => {
  it.each([
    ['PIX', 'pix'],
    ['CREDIT_CARD', 'cartao_credito'],
  ] as const)('%s → %s', (billingType, code) => {
    expect(toPaymentMethodCode(billingType)).toBe(code);
  });

  it.each(['BOLETO', 'UNDEFINED', 'ALGO_NOVO', null, undefined])(
    '%s → null (baixa sem forma é honesta; com forma inventada, não)',
    (billingType) => {
      expect(toPaymentMethodCode(billingType)).toBeNull();
    },
  );
});
