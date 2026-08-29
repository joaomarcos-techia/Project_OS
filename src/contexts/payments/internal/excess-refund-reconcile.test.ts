import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listClinics: vi.fn(),
  listCandidates: vi.fn(),
  getClient: vi.fn(),
  listRefunds: vi.fn(),
  confirm: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
vi.mock('@/lib/payments/account-store', () => ({ getClinicAsaasClient: mocks.getClient }));
vi.mock('./deposit-scan', () => ({ listClinicsWithDepositEnabled: mocks.listClinics }));
vi.mock('./excess-refund', () => ({
  listRefundIntentReconcileCandidates: mocks.listCandidates,
  confirmRefundIntentFromReadback: mocks.confirm,
}));

import { runExcessRefundReconcile } from './excess-refund-reconcile';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listClinics.mockResolvedValue(['clinic-a']);
  mocks.listCandidates.mockResolvedValue([
    { id: 'intent-1', providerPaymentId: 'pay-1' },
    { id: 'intent-2', providerPaymentId: 'pay-2' },
  ]);
  mocks.getClient.mockResolvedValue({ listPaymentRefunds: mocks.listRefunds });
  mocks.listRefunds.mockResolvedValue([{ refundId: 'ref-1', status: 'REFUNDED', value: 30 }]);
  mocks.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
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
    expect(mocks.listRefunds).toHaveBeenCalledWith('pay-1', { attempts: 1 });
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
  });

  it('falha de uma intenção não impede reconciliar as demais', async () => {
    mocks.listRefunds.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce([]);
    mocks.confirm.mockReset().mockResolvedValue(false);

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
});
