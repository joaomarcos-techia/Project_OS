import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listClinics: vi.fn(),
  listExpiryCandidates: vi.fn(),
  expire: vi.fn(),
  listCandidates: vi.fn(),
  findCustomer: vi.fn(),
  getClient: vi.fn(),
  renew: vi.fn(),
  findPaymentByCheckoutSession: vi.fn(),
  getPayment: vi.fn(),
  cancelPayment: vi.fn(),
  markPaid: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/payments/account-store', () => ({
  getClinicAsaasClient: mocks.getClient,
}));
vi.mock('./deposit-scan', () => ({ listClinicsWithDepositEnabled: mocks.listClinics }));
vi.mock('./charge-store', () => ({
  expireRemainderCheckoutCollection: mocks.expire,
  listRemainderCheckoutExpiryCandidates: mocks.listExpiryCandidates,
  listRemainderCheckoutRenewalCandidates: mocks.listCandidates,
  findPaymentCustomer: mocks.findCustomer,
  markDepositPaid: mocks.markPaid,
}));
vi.mock('./hosted-checkout', () => ({
  renewRemainderHostedCheckout: mocks.renew,
}));

import { runRemainderCheckoutRenewal } from './remainder-checkout-renewal';

const NOW = new Date('2026-08-29T12:00:00.000Z');
const CANDIDATE = {
  chargeId: 'charge-1',
  appointmentId: 'appointment-1',
  patientId: 'patient-1',
  amount: 75,
  generation: 1,
  providerCheckoutId: 'checkout-1',
  collectionExpiresAt: new Date('2026-09-05T12:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listClinics.mockResolvedValue(['clinic-1']);
  mocks.listExpiryCandidates.mockResolvedValue([]);
  mocks.expire.mockResolvedValue(true);
  mocks.listCandidates.mockResolvedValue([CANDIDATE]);
  mocks.findCustomer.mockResolvedValue('cus-1');
  mocks.getClient.mockResolvedValue({
    findPaymentByCheckoutSession: mocks.findPaymentByCheckoutSession,
    getPayment: mocks.getPayment,
    cancelPayment: mocks.cancelPayment,
  });
  mocks.renew.mockResolvedValue('created');
  mocks.findPaymentByCheckoutSession.mockResolvedValue(null);
  mocks.cancelPayment.mockResolvedValue({ deleted: true });
  mocks.markPaid.mockResolvedValue('paid');
});

describe('runRemainderCheckoutRenewal', () => {
  it('renova pelo customer da mesma clínica e contabiliza a geração', async () => {
    await expect(runRemainderCheckoutRenewal({ now: NOW })).resolves.toEqual({
      clinics: 1,
      candidates: 1,
      renewed: 1,
      paymentExists: 0,
      expired: 0,
      failed: 0,
    });
    expect(mocks.renew).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: 'clinic-1',
        customerId: 'cus-1',
        candidate: CANDIDATE,
        now: NOW,
      }),
    );
  });

  it('não renova quando a geração anterior já produziu payment', async () => {
    mocks.renew.mockResolvedValue('payment_exists');

    const result = await runRemainderCheckoutRenewal({ now: NOW });

    expect(result).toMatchObject({ renewed: 0, paymentExists: 1, failed: 0 });
  });

  it('expira o instrumento ao final dos 7 dias sem quitar o recebível aqui', async () => {
    mocks.listExpiryCandidates.mockResolvedValue([
      {
        chargeId: 'charge-expired',
        providerPaymentId: null,
        providerCheckoutId: 'checkout-expired',
      },
    ]);
    mocks.listCandidates.mockResolvedValue([]);

    const result = await runRemainderCheckoutRenewal({ now: NOW });

    expect(result).toMatchObject({ expired: 1, candidates: 0, renewed: 0 });
    expect(mocks.renew).not.toHaveBeenCalled();
    expect(mocks.expire).toHaveBeenCalledWith({
      clinicId: 'clinic-1',
      chargeId: 'charge-expired',
      expiredAt: NOW,
    });
  });

  it('concilia pagamento confirmado no limite em vez de expirar a dívida', async () => {
    mocks.listExpiryCandidates.mockResolvedValue([
      {
        chargeId: 'charge-paid',
        providerPaymentId: null,
        providerCheckoutId: 'checkout-paid',
      },
    ]);
    mocks.listCandidates.mockResolvedValue([]);
    mocks.findPaymentByCheckoutSession.mockResolvedValue({
      paymentId: 'pay-1',
      status: 'RECEIVED',
      deleted: false,
      checkoutSessionId: 'checkout-paid',
      billingType: 'PIX',
    });

    const result = await runRemainderCheckoutRenewal({ now: NOW });

    expect(result).toMatchObject({ expired: 0, paymentExists: 1, failed: 0 });
    expect(mocks.markPaid).toHaveBeenCalledWith(
      expect.objectContaining({
        providerPaymentId: 'pay-1',
        checkoutSessionId: 'checkout-paid',
      }),
    );
    expect(mocks.expire).not.toHaveBeenCalled();
  });

  it('isola falha por cobrança', async () => {
    mocks.renew.mockRejectedValue(new Error('gateway indisponível'));

    const result = await runRemainderCheckoutRenewal({ now: NOW });

    expect(result).toMatchObject({ failed: 1, renewed: 0 });
  });
});
