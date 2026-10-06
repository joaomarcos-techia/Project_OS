import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { recordProviderExpense, recordProviderFeeAdjustment } from './provider-expense';

const calls = {
  lancamento: vi.fn(),
  transaction: vi.fn(),
};

function tx(created = true) {
  let insertCount = 0;
  return {
    insert: () => {
      insertCount += 1;
      if (insertCount === 1) {
        return {
          values: (value: unknown) => {
            calls.lancamento(value);
            return {
              onConflictDoNothing: () => ({
                returning: async () => (created ? [{ id: 'expense-1' }] : []),
              }),
            };
          },
        };
      }
      return {
        values: async (value: unknown) => {
          calls.transaction(value);
        },
      };
    },
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('recordProviderExpense', () => {
  it('registra a taxa como pagar já quitado e cria a baixa correspondente', async () => {
    const occurredAt = new Date('2026-10-02T12:00:00.000Z');

    await expect(
      recordProviderExpense(tx(), {
        clinicId: 'clinic-1',
        patientChargeId: 'charge-1',
        kind: 'payment_processing_fee',
        amount: 5,
        occurredAt,
      }),
    ).resolves.toBe('expense-1');

    expect(calls.lancamento).toHaveBeenCalledWith({
      clinicId: 'clinic-1',
      tipo: 'pagar',
      descricao: 'Taxa Asaas — cobrança de paciente',
      valor: '5.00',
      valorPago: '5.00',
      status: 'pago',
      paidAt: occurredAt,
      sourcePatientChargeId: 'charge-1',
      financialExpenseKind: 'payment_processing_fee',
      createdVia: 'auto',
    });
    expect(calls.transaction).toHaveBeenCalledWith({
      clinicId: 'clinic-1',
      lancamentoId: 'expense-1',
      kind: 'payment',
      amount: '5.00',
      occurredAt,
    });
  });

  it('reentrega não cria segunda despesa nem segunda baixa', async () => {
    await expect(
      recordProviderExpense(tx(false), {
        clinicId: 'clinic-1',
        patientChargeId: 'charge-1',
        kind: 'payment_processing_fee',
        amount: 5,
        occurredAt: new Date(),
      }),
    ).resolves.toBeNull();
    expect(calls.transaction).not.toHaveBeenCalled();
  });

  it('taxa zero não cria lançamento artificial', async () => {
    await expect(
      recordProviderExpense(tx(), {
        clinicId: 'clinic-1',
        patientChargeId: 'charge-1',
        kind: 'payment_processing_fee',
        amount: 0,
        occurredAt: new Date(),
      }),
    ).resolves.toBeNull();
    expect(calls.lancamento).not.toHaveBeenCalled();
  });
});

describe('recordProviderFeeAdjustment', () => {
  const base = {
    clinicId: 'clinic-1',
    patientChargeId: 'charge-1',
    providerPaymentId: 'pay-1',
    sourceEventId: 'event-1',
    revision: 2,
    occurredAt: new Date('2026-10-06T12:00:00Z'),
  };

  it.each([
    [200, 'pagar', '2.00'],
    [-200, 'receber', '2.00'],
  ] as const)(
    'lança delta %s como %s com revisão e correlação',
    async (deltaCents, tipo, amount) => {
      await expect(recordProviderFeeAdjustment(tx(), { ...base, deltaCents })).resolves.toBe(
        'expense-1',
      );
      expect(calls.lancamento).toHaveBeenCalledWith(
        expect.objectContaining({
          clinicId: base.clinicId,
          tipo,
          valor: amount,
          valorPago: amount,
          financialExpenseKind: 'payment_processing_fee_adjustment',
          providerEconomicsRevision: 2,
          sourceEventId: base.sourceEventId,
          providerPaymentId: base.providerPaymentId,
        }),
      );
      expect(calls.transaction).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'payment',
          amount,
        }),
      );
    },
  );

  it('replay com UNIQUE não cria segunda baixa', async () => {
    await expect(
      recordProviderFeeAdjustment(tx(false), { ...base, deltaCents: 200 }),
    ).resolves.toBeNull();
    expect(calls.transaction).not.toHaveBeenCalled();
  });

  it('delta zero não cria lançamento artificial', async () => {
    await expect(recordProviderFeeAdjustment(tx(), { ...base, deltaCents: 0 })).resolves.toBeNull();
    expect(calls.lancamento).not.toHaveBeenCalled();
  });
});
