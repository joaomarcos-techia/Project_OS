import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
  correctCreditEconomics: vi.fn(),
  recordProviderFeeAdjustment: vi.fn(),
  refreshProfessionalPayout: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
vi.mock('@/contexts/payments', () => ({
  PAYMENTS_EVENTS: { PAYMENT_ECONOMICS_CORRECTED: 'payments.patient_payment.economics_corrected' },
}));
vi.mock('../credit-store', () => ({ correctCreditEconomics: mocks.correctCreditEconomics }));
vi.mock('../provider-expense', () => ({
  recordProviderFeeAdjustment: mocks.recordProviderFeeAdjustment,
}));
vi.mock('../professional-payout', () => ({
  refreshProfessionalPayout: mocks.refreshProfessionalPayout,
}));

import { PoisonPillError } from '@/lib/outbox/errors';

import './patient-payment-economics-corrected';

const handler = mocks.registerHandler.mock.calls[0]![1] as (ctx: {
  tx: unknown;
  clinicId: string;
  eventId: string;
  payload: Record<string, unknown>;
}) => Promise<void>;

const payload = {
  chargeId: 'charge-1',
  clinicId: 'clinic-1',
  appointmentId: 'apt-1',
  providerPaymentId: 'pay-1',
  revision: 2,
  providerGrossAmount: 150,
  providerFeeAmount: 7,
  providerNetAmount: 143,
  observedAt: '2026-10-06T12:00:00.000Z',
};
const ctx = { tx: 'TX', clinicId: 'clinic-1', eventId: 'event-1', payload };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.correctCreditEconomics.mockResolvedValue({ outcome: 'corrected', deltaCents: 200 });
});

describe('handler da correção tardia da tarifa', () => {
  it('atualiza crédito, acrescenta somente o ajuste e recalcula o repasse', async () => {
    await handler(ctx);
    expect(mocks.correctCreditEconomics).toHaveBeenCalledWith(
      'TX',
      expect.objectContaining({
        patientChargeId: 'charge-1',
        revision: 2,
        feeAmount: 7,
        netAmount: 143,
      }),
    );
    expect(mocks.recordProviderFeeAdjustment).toHaveBeenCalledWith(
      'TX',
      expect.objectContaining({
        sourceEventId: 'event-1',
        revision: 2,
        deltaCents: 200,
      }),
    );
    expect(mocks.refreshProfessionalPayout).toHaveBeenCalledWith('TX', {
      clinicId: 'clinic-1',
      appointmentId: 'apt-1',
    });
  });

  it('replay ou evento antigo não duplica dinheiro', async () => {
    mocks.correctCreditEconomics.mockResolvedValue({ outcome: 'already_applied' });
    for (let attempt = 0; attempt < 10; attempt += 1) await handler(ctx);
    expect(mocks.recordProviderFeeAdjustment).not.toHaveBeenCalled();
    expect(mocks.refreshProfessionalPayout).not.toHaveBeenCalled();
  });

  it('crédito ausente mantém o evento pendente para retry', async () => {
    mocks.correctCreditEconomics.mockResolvedValue({ outcome: 'pending' });
    await expect(handler(ctx)).rejects.toThrow('pendente');
    expect(mocks.recordProviderFeeAdjustment).not.toHaveBeenCalled();
  });

  it('tenant divergente é poison pill antes de qualquer escrita', async () => {
    await expect(handler({ ...ctx, clinicId: 'clinic-2' })).rejects.toBeInstanceOf(PoisonPillError);
    expect(mocks.correctCreditEconomics).not.toHaveBeenCalled();
  });
});
