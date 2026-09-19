import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  sql: Object.assign(() => 'SQL', { raw: () => 'SQL' }),
}));
vi.mock('../schema', () => ({
  faturamentoPendencias: {
    appointmentId: 'fp.appointment_id',
    clinicId: 'fp.clinic_id',
    motivo: 'fp.motivo',
  },
  lancamentos: {
    id: 'l.id',
    clinicId: 'l.clinic_id',
    valor: 'l.valor',
    valorPago: 'l.valor_pago',
    status: 'l.status',
    paidAt: 'l.paid_at',
  },
  patientCreditAdjustments: { id: 'pca.id' },
  patientCredits: {
    id: 'pc.id',
    clinicId: 'pc.clinic_id',
    patientChargeId: 'pc.patient_charge_id',
    amount: 'pc.amount',
    allocatedAmount: 'pc.allocated_amount',
    allocatedLancamentoId: 'pc.allocated_lancamento_id',
    allocatedPaymentTransactionId: 'pc.allocated_payment_transaction_id',
    unallocatedReversedAmount: 'pc.unallocated_reversed_amount',
    allocatedReversedAmount: 'pc.allocated_reversed_amount',
    status: 'pc.status',
  },
  paymentTransactions: { id: 'pt.id' },
}));

import {
  CHARGEBACK_PENDING_REASON,
  PAYMENT_REVERSAL_MANUAL_REASON,
  applyPatientPaymentRisk,
  recordExcessRefund,
} from './patient-credit-adjustment';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const CHARGE = '22222222-2222-4222-8222-222222222222';
const APPOINTMENT = '33333333-3333-4333-8333-333333333333';
const EVENT = '44444444-4444-4444-8444-444444444444';

const calls = {
  inserts: [] as Array<{ table: unknown; value: Record<string, unknown> }>,
  updates: [] as Array<{ table: unknown; value: Record<string, unknown> }>,
};

function awaitable(run: () => void = () => undefined) {
  return {
    then(resolve: (value: unknown) => unknown) {
      run();
      return Promise.resolve(resolve(undefined));
    },
  };
}

function stubTx(opts: { selected: unknown[][]; adjustmentInserted?: boolean }) {
  const selected = [...opts.selected];
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          for: () => ({ limit: async () => selected.shift() ?? [] }),
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (value: Record<string, unknown>) => {
        calls.inserts.push({ table, value });
        return {
          ...awaitable(),
          onConflictDoNothing: () => ({
            returning: async () => (opts.adjustmentInserted === false ? [] : [{ id: 'adj-1' }]),
          }),
          onConflictDoUpdate: () => awaitable(),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => {
        calls.updates.push({ table, value });
        return { where: () => awaitable() };
      },
    }),
  } as never;
}

const credit = (overrides: Record<string, unknown> = {}) => ({
  id: 'credit-1',
  amount: '100.00',
  allocatedAmount: '0.00',
  allocatedLancamentoId: null,
  allocatedPaymentTransactionId: null,
  unallocatedReversedAmount: '0.00',
  allocatedReversedAmount: '0.00',
  status: 'available',
  ...overrides,
});

const riskPayload = (
  state: 'requested' | 'in_dispute' | 'awaiting_reversal' | 'reversed' | 'lost' | 'cash_undone',
) => ({
  clinicId: CLINIC,
  appointmentId: APPOINTMENT,
  chargeId: CHARGE,
  amount: 100,
  state,
  reason: null,
  changedAt: '2026-08-29T12:00:00.000Z',
});

beforeEach(() => {
  calls.inserts.length = 0;
  calls.updates.length = 0;
});

describe('recordExcessRefund', () => {
  it('registra compensação do excedente sem tocar no valor alocado', async () => {
    const tx = stubTx({
      selected: [[credit({ amount: '130.00', allocatedAmount: '100.00' })]],
    });

    await expect(
      recordExcessRefund(tx, {
        clinicId: CLINIC,
        appointmentId: APPOINTMENT,
        patientChargeId: CHARGE,
        amount: 30,
        sourceEventId: EVENT,
        occurredAt: new Date('2026-08-29T12:00:00.000Z'),
      }),
    ).resolves.toBe('recorded');

    expect(calls.inserts[0]?.value).toMatchObject({ kind: 'excess_refund', amount: '30.00' });
    expect(calls.updates.some(({ value }) => value.unallocatedReversedAmount === '30.00')).toBe(
      true,
    );
    expect(calls.updates.some(({ value }) => 'allocatedReversedAmount' in value)).toBe(false);
  });

  it('replay do evento não aplica o estorno duas vezes', async () => {
    const tx = stubTx({ selected: [[credit()]], adjustmentInserted: false });
    await expect(
      recordExcessRefund(tx, {
        clinicId: CLINIC,
        appointmentId: APPOINTMENT,
        patientChargeId: CHARGE,
        amount: 30,
        sourceEventId: EVENT,
        occurredAt: new Date(),
      }),
    ).resolves.toBe('duplicate');
    expect(calls.updates).toHaveLength(0);
  });
});

describe('applyPatientPaymentRisk', () => {
  it('disputa bloqueia o crédito e abre pendência, sem compensar dinheiro', async () => {
    const tx = stubTx({ selected: [[credit()]] });
    await expect(
      applyPatientPaymentRisk(tx, {
        clinicId: CLINIC,
        payload: riskPayload('in_dispute'),
        sourceEventId: EVENT,
      }),
    ).resolves.toBe('dispute_opened');
    expect(calls.updates[0]?.value).toMatchObject({ disputeStatus: 'in_dispute' });
    expect(calls.inserts.at(-1)?.value).toMatchObject({ motivo: CHARGEBACK_PENDING_REASON });
    expect(calls.inserts.some(({ value }) => value.kind === 'chargeback_loss')).toBe(false);
  });

  it('disputa ganha libera o bloqueio sem criar segundo pagamento', async () => {
    const tx = stubTx({ selected: [[credit()]] });
    await expect(
      applyPatientPaymentRisk(tx, {
        clinicId: CLINIC,
        payload: riskPayload('reversed'),
        sourceEventId: EVENT,
      }),
    ).resolves.toBe('dispute_reversed');
    expect(calls.updates[0]?.value).toMatchObject({ disputeStatus: 'reversed' });
    expect(calls.inserts).toHaveLength(0);
  });

  it('perda não alocada fica append-only e nunca cria baixa de recebível', async () => {
    const tx = stubTx({ selected: [[credit()]] });
    await expect(
      applyPatientPaymentRisk(tx, {
        clinicId: CLINIC,
        payload: riskPayload('lost'),
        sourceEventId: EVENT,
      }),
    ).resolves.toBe('loss_recorded');
    expect(calls.inserts[0]?.value).toMatchObject({
      kind: 'chargeback_loss',
      amount: '100.00',
    });
    expect(calls.updates.some(({ value }) => value.unallocatedReversedAmount === '100.00')).toBe(
      true,
    );
    expect(calls.inserts.some(({ value }) => value.kind === 'refund')).toBe(false);
  });

  it('perda alocada cria refund ligado à baixa e reabre somente o saldo financeiro', async () => {
    const tx = stubTx({
      selected: [
        [
          credit({
            allocatedAmount: '100.00',
            allocatedLancamentoId: 'lanc-1',
            allocatedPaymentTransactionId: 'payment-tx-1',
            status: 'allocated',
          }),
        ],
        [{ id: 'lanc-1', valor: '200.00', valorPago: '100.00', status: 'parcial' }],
      ],
    });

    await expect(
      applyPatientPaymentRisk(tx, {
        clinicId: CLINIC,
        payload: riskPayload('cash_undone'),
        sourceEventId: EVENT,
      }),
    ).resolves.toBe('loss_recorded');

    expect(calls.inserts.some(({ value }) => value.kind === 'cash_undone')).toBe(true);
    expect(calls.inserts).toContainEqual(
      expect.objectContaining({
        value: expect.objectContaining({
          kind: 'refund',
          amount: '100.00',
          originalPaymentId: 'payment-tx-1',
        }),
      }),
    );
    expect(calls.updates.some(({ value }) => value.valorPago === '0.00')).toBe(true);
    expect(calls.updates.some(({ value }) => value.status === 'pendente')).toBe(true);
  });

  it('linha histórica ambígua vai para revisão, sem inventar vínculo no ledger', async () => {
    const tx = stubTx({
      selected: [
        [
          credit({
            allocatedAmount: '100.00',
            allocatedLancamentoId: 'lanc-1',
            allocatedPaymentTransactionId: null,
          }),
        ],
      ],
    });
    await expect(
      applyPatientPaymentRisk(tx, {
        clinicId: CLINIC,
        payload: riskPayload('lost'),
        sourceEventId: EVENT,
      }),
    ).resolves.toBe('manual_review');
    expect(calls.inserts.at(-1)?.value).toMatchObject({ motivo: PAYMENT_REVERSAL_MANUAL_REASON });
    expect(calls.inserts.some(({ value }) => value.kind === 'refund')).toBe(false);
  });
});
