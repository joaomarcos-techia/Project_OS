import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withTenantMock } = vi.hoisted(() => ({ withTenantMock: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/tenant', () => ({ withTenant: withTenantMock }));

import { listAppointmentFinancialEconomics } from './queries';

function queryResolving(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const query = Object.assign(promise, { from: vi.fn(), innerJoin: vi.fn(), where: vi.fn() });
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  return query;
}

beforeEach(() => vi.clearAllMocks());

describe('listAppointmentFinancialEconomics', () => {
  it('agrega em centavos, preserva desconhecido e anexa o snapshot imutável', async () => {
    const reads = [
      [
        {
          appointmentId: 'appointment-1',
          allocatedAmount: '100.00',
          allocatedReversedAmount: '0.00',
          allocatedPaymentTransactionId: 'payment-1',
          providerGrossAmount: '100.00',
          providerFeeAmount: '2.00',
          earlySettlementFeeAmount: null,
          providerNetAmount: '98.00',
        },
        {
          appointmentId: 'appointment-1',
          allocatedAmount: '150.00',
          allocatedReversedAmount: '0.00',
          allocatedPaymentTransactionId: 'payment-2',
          providerGrossAmount: '150.00',
          providerFeeAmount: '3.00',
          earlySettlementFeeAmount: '1.00',
          providerNetAmount: '146.00',
        },
      ],
      [],
      [
        {
          appointmentId: 'appointment-1',
          calculationBasis: 'gross',
          basisAmount: '250.00',
          payoutAmount: '125.00',
          status: 'calculated',
        },
      ],
    ];
    withTenantMock.mockImplementation(
      async (_clinicId: string, operation: (tx: unknown) => unknown) =>
        operation({ select: () => queryResolving(reads.shift() ?? []) }),
    );

    await expect(listAppointmentFinancialEconomics('clinic-1', ['appointment-1'])).resolves.toEqual(
      [
        {
          appointmentId: 'appointment-1',
          providerGrossAmount: 250,
          providerFeeAmount: 5,
          earlySettlementFeeAmount: null,
          providerNetAmount: 244,
          payout: {
            calculationBasis: 'gross',
            basisAmount: 250,
            payoutAmount: 125,
            status: 'calculated',
          },
        },
      ],
    );
    expect(withTenantMock).toHaveBeenCalledWith('clinic-1', expect.any(Function));
  });

  it('não abre transação tenant sem atendimentos para enriquecer', async () => {
    await expect(listAppointmentFinancialEconomics('clinic-1', [])).resolves.toEqual([]);
    expect(withTenantMock).not.toHaveBeenCalled();
  });

  it('desconta principal revertido sem presumir devolução de taxa ou líquido', async () => {
    const reads = [
      [
        {
          appointmentId: 'appointment-1',
          allocatedAmount: '100.00',
          allocatedReversedAmount: '30.00',
          allocatedPaymentTransactionId: 'payment-1',
          providerGrossAmount: '100.00',
          providerFeeAmount: '2.00',
          earlySettlementFeeAmount: '1.00',
          providerNetAmount: '97.00',
        },
        {
          appointmentId: 'appointment-1',
          allocatedAmount: '50.00',
          allocatedReversedAmount: '0.00',
          allocatedPaymentTransactionId: 'payment-2',
          providerGrossAmount: '50.00',
          providerFeeAmount: '1.00',
          earlySettlementFeeAmount: null,
          providerNetAmount: '49.00',
        },
      ],
      [{ originalPaymentId: 'payment-1', amount: '30.00' }],
      [
        {
          appointmentId: 'appointment-1',
          calculationBasis: 'net',
          basisAmount: null,
          payoutAmount: null,
          status: 'pending_economics',
        },
      ],
    ];
    withTenantMock.mockImplementation(
      async (_clinicId: string, operation: (tx: unknown) => unknown) =>
        operation({ select: () => queryResolving(reads.shift() ?? []) }),
    );

    await expect(listAppointmentFinancialEconomics('clinic-1', ['appointment-1'])).resolves.toEqual(
      [
        {
          appointmentId: 'appointment-1',
          providerGrossAmount: 120,
          providerFeeAmount: null,
          earlySettlementFeeAmount: null,
          providerNetAmount: null,
          payout: {
            calculationBasis: 'net',
            basisAmount: null,
            payoutAmount: null,
            status: 'pending_economics',
          },
        },
      ],
    );
  });

  it('não soma crédito integralmente revertido ao Caixa', async () => {
    const reads = [
      [
        {
          appointmentId: 'appointment-1',
          allocatedAmount: '100.00',
          allocatedReversedAmount: '0.00',
          allocatedPaymentTransactionId: 'payment-1',
          providerGrossAmount: '100.00',
          providerFeeAmount: '2.00',
          earlySettlementFeeAmount: null,
          providerNetAmount: '98.00',
        },
      ],
      [{ originalPaymentId: 'payment-1', amount: '100.00' }],
      [
        {
          appointmentId: 'appointment-1',
          calculationBasis: 'gross',
          basisAmount: null,
          payoutAmount: null,
          status: 'cancelled',
        },
      ],
    ];
    withTenantMock.mockImplementation(
      async (_clinicId: string, operation: (tx: unknown) => unknown) =>
        operation({ select: () => queryResolving(reads.shift() ?? []) }),
    );

    await expect(listAppointmentFinancialEconomics('clinic-1', ['appointment-1'])).resolves.toEqual(
      [
        {
          appointmentId: 'appointment-1',
          providerGrossAmount: null,
          providerFeeAmount: null,
          earlySettlementFeeAmount: null,
          providerNetAmount: null,
          payout: {
            calculationBasis: 'gross',
            basisAmount: null,
            payoutAmount: null,
            status: 'cancelled',
          },
        },
      ],
    );
  });
});
