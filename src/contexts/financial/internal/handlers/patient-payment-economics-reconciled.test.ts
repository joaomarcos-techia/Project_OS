import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
  reconcileCreditEconomics: vi.fn(),
  recordProviderExpense: vi.fn(),
  refreshProfessionalPayout: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
vi.mock('@/contexts/payments', () => ({
  PAYMENTS_EVENTS: {
    PAYMENT_ECONOMICS_RECONCILED: 'payments.patient_payment.economics_reconciled',
  },
}));
vi.mock('../credit-store', () => ({ reconcileCreditEconomics: mocks.reconcileCreditEconomics }));
vi.mock('../provider-expense', () => ({ recordProviderExpense: mocks.recordProviderExpense }));
vi.mock('../professional-payout', () => ({
  refreshProfessionalPayout: mocks.refreshProfessionalPayout,
}));

import { PoisonPillError } from '@/lib/outbox/errors';

import './patient-payment-economics-reconciled';

const handler = mocks.registerHandler.mock.calls[0]![1] as (ctx: {
  tx: unknown;
  clinicId: string;
  payload: Record<string, unknown>;
}) => Promise<void>;

const payload = {
  chargeId: 'charge-1',
  clinicId: 'clinic-1',
  appointmentId: 'apt-1',
  providerGrossAmount: 150,
  providerFeeAmount: 5,
  providerNetAmount: 145,
  earlySettlementFeeAmount: null,
  installmentNumber: null,
  paidAt: '2026-10-02T12:00:00.000Z',
  paymentMethod: 'pix',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reconcileCreditEconomics.mockResolvedValue('reconciled');
  mocks.refreshProfessionalPayout.mockResolvedValue('calculated');
});

describe('handler da economia tardia', () => {
  it('completa o crédito, registra a taxa e recalcula o repasse', async () => {
    await handler({ tx: 'TX', clinicId: 'clinic-1', payload });

    expect(mocks.reconcileCreditEconomics).toHaveBeenCalledWith(
      'TX',
      expect.objectContaining({
        patientChargeId: 'charge-1',
        providerGrossAmount: 150,
        providerFeeAmount: 5,
        providerNetAmount: 145,
      }),
    );
    expect(mocks.recordProviderExpense).toHaveBeenCalledWith(
      'TX',
      expect.objectContaining({ kind: 'payment_processing_fee', amount: 5 }),
    );
    expect(mocks.refreshProfessionalPayout).toHaveBeenCalledWith('TX', {
      clinicId: 'clinic-1',
      appointmentId: 'apt-1',
    });
  });

  it('reentrega não duplica despesa nem recalcula', async () => {
    mocks.reconcileCreditEconomics.mockResolvedValue('already_reconciled');

    await handler({ tx: 'TX', clinicId: 'clinic-1', payload });

    expect(mocks.recordProviderExpense).not.toHaveBeenCalled();
    expect(mocks.refreshProfessionalPayout).not.toHaveBeenCalled();
  });

  it('crédito ainda ausente falha para o outbox tentar de novo', async () => {
    mocks.reconcileCreditEconomics.mockResolvedValue('not_found');

    await expect(handler({ tx: 'TX', clinicId: 'clinic-1', payload })).rejects.toThrow(
      'crédito ausente',
    );
  });

  it('payload de outro tenant é poison pill', async () => {
    await expect(
      handler({ tx: 'TX', clinicId: 'clinic-1', payload: { ...payload, clinicId: 'clinic-2' } }),
    ).rejects.toBeInstanceOf(PoisonPillError);
  });
});
