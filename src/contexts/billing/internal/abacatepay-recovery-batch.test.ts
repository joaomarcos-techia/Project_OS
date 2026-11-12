import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sandbox: true,
  env: {
    ABACATEPAY_API_KEY: 'synthetic',
    ABACATEPAY_STORE_ID: 'store_synthetic',
    ABACATEPAY_SANDBOX_PROBE_PRODUCT_ID: 'prod_probe',
  },
  scan: vi.fn(),
  initial: vi.fn(),
  renewal: vi.fn(),
  transport: vi.fn(),
  request: vi.fn(),
  emit: vi.fn(),
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
vi.mock(import('@/lib/payments/saas/acquisition'), async (importOriginal) => ({
  ...(await importOriginal()),
  isAbacatePayRuntime: () => mocks.sandbox,
}));
vi.mock('@/lib/payments/abacatepay/transport', () => ({
  createAbacatePayTransport: mocks.transport,
}));
vi.mock('./abacatepay-statement-scan', () => ({ advanceAbacatePayStatementScans: mocks.scan }));
vi.mock('./abacatepay-renewal-recovery', () => ({
  reconcileAbacatePayMissingRenewal: mocks.renewal,
}));
import { reconcileAbacatePayRecoveryBatch } from './abacatepay-recovery-batch';
import type { ManagementDatabase } from './abacatepay-management';

const database: ManagementDatabase = {
  execute: vi.fn(),
  transaction: vi.fn(),
};
const empty = { scanned: 0, applied: 0, failed: 0, review: 0, deferred: false };
beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.sandbox = true;
  mocks.scan.mockResolvedValue({ pages: 3, failed: 0, deferred: false });
  mocks.renewal.mockResolvedValue(empty);
  mocks.initial.mockResolvedValue({ scanned: 0, applied: 0, review: 0 });
  mocks.transport.mockReturnValue(mocks.request);
  mocks.request.mockResolvedValue({ success: true, data: { id: 'prod_probe', devMode: true } });
});
describe('bounded shared recovery batch', () => {
  it.each([
    { id: 'prod_probe', devMode: false },
    { id: 'prod_other', devMode: true },
  ])(
    'refuses an unproven test resource %j before any bank scan or contract reconciliation',
    async (data) => {
      mocks.request.mockResolvedValue({ success: true, data });
      await expect(
        reconcileAbacatePayRecoveryBatch(database, Date.now() + 30_000, mocks.initial),
      ).rejects.toMatchObject({ code: 'environment_mismatch' });
      expect(mocks.scan).not.toHaveBeenCalled();
      expect(mocks.initial).not.toHaveBeenCalled();
      expect(mocks.renewal).not.toHaveBeenCalled();
    },
  );
  it('does not read provider or database in Production', async () => {
    mocks.sandbox = false;
    expect(
      (await reconcileAbacatePayRecoveryBatch(database, Date.now() + 30_000, mocks.initial))
        .scanned,
    ).toBe(0);
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(mocks.transport).not.toHaveBeenCalled();
  });
  it('resumes pages before recovering independent contracts and stops when empty', async () => {
    mocks.renewal.mockResolvedValueOnce({ ...empty, scanned: 1, applied: 1 });
    const result = await reconcileAbacatePayRecoveryBatch(
      database,
      Date.now() + 30_000,
      mocks.initial,
    );
    expect(result).toMatchObject({ pages: 3, scanned: 1, applied: 1 });
    expect(mocks.scan.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.renewal.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.renewal).toHaveBeenCalledTimes(2);
  });
  it('caps work per execution without limiting progress in later executions', async () => {
    mocks.renewal.mockResolvedValue({ ...empty, scanned: 1 });
    expect(
      (await reconcileAbacatePayRecoveryBatch(database, Date.now() + 30_000, mocks.initial))
        .deferred,
    ).toBe(true);
    expect(mocks.renewal).toHaveBeenCalledTimes(10);
    await reconcileAbacatePayRecoveryBatch(database, Date.now() + 30_000, mocks.initial);
    expect(mocks.renewal).toHaveBeenCalledTimes(20);
  });
  it('leaves a full read budget and makes no provider call when time is exhausted', async () => {
    expect(
      (await reconcileAbacatePayRecoveryBatch(database, Date.now() + 1000, mocks.initial)).deferred,
    ).toBe(true);
    expect(mocks.scan).not.toHaveBeenCalled();
  });
  it('rotates pending initial payments in a bounded phase before renewals', async () => {
    mocks.initial.mockResolvedValue({ scanned: 1, applied: 0, review: 0 });
    const result = await reconcileAbacatePayRecoveryBatch(
      database,
      Date.now() + 30_000,
      mocks.initial,
    );
    expect(mocks.initial).toHaveBeenCalledTimes(10);
    expect(result).toMatchObject({ scanned: 10, deferred: true });
    expect(mocks.renewal).toHaveBeenCalledOnce();
  });
  it('propagates persistence failure to the existing cron alert boundary', async () => {
    mocks.scan.mockRejectedValueOnce(new Error('Synthetic database failure'));
    await expect(
      reconcileAbacatePayRecoveryBatch(database, Date.now() + 30_000, mocks.initial),
    ).rejects.toThrow('Synthetic database failure');
    expect(mocks.renewal).not.toHaveBeenCalled();
  });
});
