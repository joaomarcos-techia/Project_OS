/**
 * Crédito confirmado depois de o recebível existir (restante e pagamento tardio).
 * Protege a atomicidade lógica: baixa única, saldo limitado e ledger/evento.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  allocateCredit: vi.fn(),
  publishEvent: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  inArray: (column: unknown, values: unknown[]) => ({ inArray: [column, values] }),
  sql: Object.assign(() => 'NOW', { raw: () => 'NOW' }),
}));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent: mocks.publishEvent }));
vi.mock('../events', () => ({
  FINANCIAL_EVENTS: { LANCAMENTO_PAID: 'financial.lancamento.paid' },
}));
vi.mock('../schema', () => ({
  lancamentos: {
    id: 'l.id',
    clinicId: 'l.clinic_id',
    appointmentId: 'l.appointment_id',
    tipo: 'l.tipo',
    status: 'l.status',
    valor: 'l.valor',
    valorPago: 'l.valor_pago',
  },
  paymentTransactions: { id: 'pt.id' },
}));
vi.mock('./credit-store', () => ({ allocateCredit: mocks.allocateCredit }));

import { applyCreditToExistingReceivable } from './credit-allocation';

const calls = {
  sets: [] as unknown[],
  values: [] as unknown[],
};

function stubTx(
  opts: {
    selected?: unknown[];
    updated?: unknown[];
    payment?: unknown[];
  } = {},
) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          for: () => ({ limit: async () => opts.selected ?? [] }),
        }),
      }),
    }),
    update: () => ({
      set: (value: unknown) => {
        calls.sets.push(value);
        return {
          where: () => ({ returning: async () => opts.updated ?? [{ id: 'lanc-1' }] }),
        };
      },
    }),
    insert: () => ({
      values: (value: unknown) => {
        calls.values.push(value);
        return { returning: async () => opts.payment ?? [{ id: 'tx-1' }] };
      },
    }),
  } as never;
}

const input = (over: Record<string, unknown> = {}) => ({
  clinicId: 'clinic-1',
  appointmentId: 'apt-1',
  creditId: 'credit-1',
  patientChargeId: 'charge-1',
  amount: 100,
  paymentMethod: 'pix',
  paidAt: new Date('2026-08-27T12:00:00.000Z'),
  correlationId: 'event-1',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  calls.sets.length = 0;
  calls.values.length = 0;
  mocks.allocateCredit.mockResolvedValue(true);
});

describe('applyCreditToExistingReceivable', () => {
  it('sem recebível aberto mantém o crédito disponível para alocação posterior', async () => {
    await expect(applyCreditToExistingReceivable(stubTx(), input())).resolves.toEqual({
      outcome: 'deferred',
      reason: 'receivable_not_open',
    });
    expect(mocks.allocateCredit).not.toHaveBeenCalled();
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it('restante quita o recebível, grava ledger e publica o mesmo fato financeiro', async () => {
    const tx = stubTx({ selected: [{ id: 'lanc-1', valor: '200.00', valorPago: '100.00' }] });

    await expect(applyCreditToExistingReceivable(tx, input())).resolves.toMatchObject({
      outcome: 'applied',
      appliedAmount: 100,
      unappliedAmount: 0,
      status: 'pago',
    });

    expect(mocks.allocateCredit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ creditId: 'credit-1', lancamentoId: 'lanc-1', amount: 100 }),
    );
    expect(calls.sets[0]).toMatchObject({
      valorPago: '200.00',
      status: 'pago',
      paidAt: new Date('2026-08-27T12:00:00.000Z'),
    });
    expect(calls.values[0]).toMatchObject({
      clinicId: 'clinic-1',
      lancamentoId: 'lanc-1',
      kind: 'payment',
      amount: '100.00',
      paymentMethod: 'pix',
    });
    expect(mocks.publishEvent).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: 'financial.lancamento.paid',
        idempotencyKey: 'patient-credit-applied:charge-1',
        correlationId: 'event-1',
        payload: expect.objectContaining({ valorPago: 200, status: 'pago', amount: 100 }),
      }),
    );
  });

  it('pagamento parcial aumenta apenas o valorPago e mantém status parcial', async () => {
    const tx = stubTx({ selected: [{ id: 'lanc-1', valor: '200.00', valorPago: '40.00' }] });

    await expect(applyCreditToExistingReceivable(tx, input({ amount: 50 }))).resolves.toMatchObject(
      {
        outcome: 'applied',
        appliedAmount: 50,
        status: 'parcial',
      },
    );
    expect(calls.sets[0]).toMatchObject({ valorPago: '90.00', status: 'parcial' });
    expect(calls.sets[0]).not.toHaveProperty('paidAt');
  });

  it('baixa manual posterior limita a aplicação ao saldo e preserva o excesso', async () => {
    const tx = stubTx({ selected: [{ id: 'lanc-1', valor: '200.00', valorPago: '180.00' }] });

    await expect(applyCreditToExistingReceivable(tx, input({ amount: 50 }))).resolves.toMatchObject(
      {
        outcome: 'applied',
        appliedAmount: 20,
        unappliedAmount: 30,
        status: 'pago',
      },
    );
    expect(mocks.allocateCredit).toHaveBeenCalledWith(tx, expect.objectContaining({ amount: 20 }));
    expect(calls.values[0]).toMatchObject({ amount: '20.00' });
  });

  it('se o crédito não estiver disponível aborta antes de mover o recebível', async () => {
    mocks.allocateCredit.mockResolvedValue(false);
    const tx = stubTx({ selected: [{ id: 'lanc-1', valor: '200.00', valorPago: '100.00' }] });

    await expect(applyCreditToExistingReceivable(tx, input())).rejects.toThrow(
      'não estava disponível',
    );
    expect(calls.sets).toHaveLength(0);
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });
});
