import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listClinics: vi.fn(),
  listCandidates: vi.fn(),
  getClient: vi.fn(),
  getPayment: vi.fn(),
  listRefunds: vi.fn(),
  confirm: vi.fn(),
  prepareManual: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
vi.mock('@/lib/payments/account-store', () => ({ getClinicAsaasClient: mocks.getClient }));
vi.mock('./deposit-scan', () => ({ listClinicsWithPendingRefundIntents: mocks.listClinics }));
vi.mock('./excess-refund', () => ({
  listRefundIntentReconcileCandidates: mocks.listCandidates,
  confirmRefundIntentFromReadback: mocks.confirm,
  prepareDisconnectedManualRefund: mocks.prepareManual,
}));

import { runExcessRefundReconcile } from './excess-refund-reconcile';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listClinics.mockResolvedValue(['clinic-a']);
  mocks.listCandidates.mockResolvedValue([
    { id: 'intent-1', providerPaymentId: 'pay-1' },
    { id: 'intent-2', providerPaymentId: 'pay-2' },
  ]);
  mocks.getClient.mockResolvedValue({
    getPayment: mocks.getPayment,
    listPaymentRefunds: mocks.listRefunds,
  });
  mocks.getPayment.mockResolvedValue({ status: 'RECEIVED' });
  mocks.listRefunds.mockResolvedValue([{ refundId: 'ref-1', status: 'DONE', value: 30 }]);
  mocks.confirm.mockResolvedValueOnce('confirmed').mockResolvedValueOnce('pending');
});

describe('runExcessRefundReconcile', () => {
  it('somente lê o provider e classifica confirmação ou pendência', async () => {
    await expect(runExcessRefundReconcile()).resolves.toEqual({
      clinics: 1,
      candidates: 2,
      confirmed: 1,
      pending: 1,
      failed: 0,
    });
    expect(mocks.listRefunds).toHaveBeenCalledTimes(2);
    expect(mocks.getPayment).toHaveBeenCalledTimes(2);
    expect(mocks.listRefunds).toHaveBeenCalledWith('pay-1', { attempts: 1 });
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'clinic-a', refunds: expect.any(Array) }),
    );
  });

  it('falha de uma intenção não impede reconciliar as demais', async () => {
    mocks.listRefunds.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce([]);
    mocks.confirm.mockReset().mockResolvedValue('pending');

    await expect(runExcessRefundReconcile()).resolves.toEqual({
      clinics: 1,
      candidates: 2,
      confirmed: 0,
      pending: 1,
      failed: 1,
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      'payments.excess_refund.reconcile_failed',
      expect.objectContaining({ clinicId: 'clinic-a', intentId: 'intent-1' }),
    );
  });

  it('conta como falha quando a clínica perdeu a conexão Asaas', async () => {
    mocks.getClient.mockResolvedValue(null);
    await expect(runExcessRefundReconcile()).resolves.toEqual({
      clinics: 1,
      candidates: 2,
      confirmed: 0,
      pending: 0,
      failed: 2,
    });
    expect(mocks.listRefunds).not.toHaveBeenCalled();
  });

  it('prepara baseline de pendência manual após reconexão antes do readback', async () => {
    const manualPreparation = {
      chargeId: 'charge-1',
      amount: 150,
      purpose: 'deposit_closeout',
      sourceEventId: 'event-1',
    };
    mocks.listCandidates.mockResolvedValue([
      { id: 'intent-1', providerPaymentId: 'pay-1', manualPreparation },
    ]);
    mocks.confirm.mockReset().mockResolvedValue('pending');

    await expect(runExcessRefundReconcile()).resolves.toEqual({
      clinics: 1,
      candidates: 1,
      confirmed: 0,
      pending: 1,
      failed: 0,
    });
    expect(mocks.prepareManual).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'clinic-a', manualPreparation }),
    );
    expect(mocks.prepareManual.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.confirm.mock.invocationCallOrder[0]!,
    );
  });
});
