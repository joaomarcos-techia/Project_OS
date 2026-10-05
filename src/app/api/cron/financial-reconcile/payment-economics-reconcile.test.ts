import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getClinicAsaasClient: vi.fn(),
  reconcilePaidChargeEconomics: vi.fn(),
  markDepositPaid: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('@/lib/payments/account-store', () => ({
  getClinicAsaasClient: mocks.getClinicAsaasClient,
}));
vi.mock('@/contexts/payments/internal/charge-store', () => ({
  reconcilePaidChargeEconomics: mocks.reconcilePaidChargeEconomics,
  markDepositPaid: mocks.markDepositPaid,
}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));

import {
  reconcileQuarantinedPatientPayments,
  reconcilePendingPaymentEconomics,
  scanQuarantinedPatientPayments,
  scanPendingPaymentEconomics,
} from './payment-economics-reconcile';

const candidate = {
  chargeId: 'charge-1',
  clinicId: 'clinic-1',
  providerPaymentId: 'pay-1',
};
const anomaly = { ...candidate, failureCode: 'payment_method_mismatch' };

beforeEach(() => vi.clearAllMocks());

describe('scanPendingPaymentEconomics', () => {
  it('busca somente cobranças pagas ainda sem economia conciliada', async () => {
    const execute = vi.fn().mockResolvedValue([candidate]);
    await expect(scanPendingPaymentEconomics({ execute } as never, 25)).resolves.toEqual([
      candidate,
    ]);

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as SQL);
    expect(query.sql).toMatch(/status = 'paid'/i);
    expect(query.sql).toMatch(/economics_reconciled_at is null/i);
    expect(query.sql).toMatch(/provider_reconcile_checked_at = now\(\)/i);
    expect(query.sql).toMatch(/order by provider_reconcile_checked_at asc nulls first/i);
    expect(query.sql).toMatch(/for update skip locked/i);
    expect(query.params).toContain(25);
  });
});

describe('quarantined patient payments', () => {
  it('scans only pending charges with persisted provider identity and mismatch', async () => {
    const execute = vi.fn().mockResolvedValue([anomaly]);
    await expect(scanQuarantinedPatientPayments({ execute } as never, 5)).resolves.toEqual([
      anomaly,
    ]);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as SQL);
    expect(query.sql).toMatch(/status = 'pending'/i);
    expect(query.sql).toMatch(/provider_payment_id IS NOT NULL/i);
    expect(query.sql).toMatch(/payment_installment_mismatch/i);
    expect(query.sql).toMatch(/provider_reconcile_checked_at = now\(\)/i);
    expect(query.sql).toMatch(/for update skip locked/i);
    expect(query.params).toContain(5);
  });

  it('recovers only after authoritative readback matches the requested condition', async () => {
    mocks.getClinicAsaasClient.mockResolvedValue({
      getPayment: vi.fn().mockResolvedValue({
        status: 'RECEIVED',
        deleted: false,
        value: 150,
        netValue: 145,
        billingType: 'PIX',
        checkoutSessionId: null,
      }),
    });
    mocks.markDepositPaid.mockResolvedValueOnce('method_mismatch').mockResolvedValueOnce('paid');
    const now = new Date('2026-10-03T12:00:00.000Z');

    await expect(reconcileQuarantinedPatientPayments([anomaly], now)).resolves.toEqual({
      recovered: 0,
      mismatched: 1,
      skipped: 0,
      failed: 0,
    });
    await expect(reconcileQuarantinedPatientPayments([anomaly], now)).resolves.toEqual({
      recovered: 1,
      mismatched: 0,
      skipped: 0,
      failed: 0,
    });
    expect(mocks.markDepositPaid).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: candidate.clinicId,
        providerPaymentId: candidate.providerPaymentId,
        asaasEventId: `recovery:${candidate.chargeId}:${candidate.providerPaymentId}`,
        eventType: 'PAYMENT_RECONCILE',
        providerGrossAmount: 150,
        providerNetAmount: 145,
      }),
    );
  });
});

describe('reconcilePendingPaymentEconomics', () => {
  it('relê o Asaas e persiste somente os valores reais do provider', async () => {
    const getPayment = vi.fn().mockResolvedValue({
      status: 'RECEIVED',
      value: 150,
      netValue: 145,
      billingType: 'PIX',
      installmentId: null,
      installmentNumber: null,
    });
    mocks.getClinicAsaasClient.mockResolvedValue({
      getPayment,
    });
    mocks.reconcilePaidChargeEconomics.mockResolvedValue('economics_reconciled');
    const now = new Date('2026-10-02T12:00:00.000Z');

    await expect(reconcilePendingPaymentEconomics([candidate], now)).resolves.toEqual({
      candidates: 1,
      reconciled: 1,
      pending: 0,
      skipped: 0,
      mismatched: 0,
      failed: 0,
    });
    expect(mocks.reconcilePaidChargeEconomics).toHaveBeenCalledWith(
      expect.objectContaining({
        ...candidate,
        reconciledAt: now,
        providerGrossAmount: 150,
        providerNetAmount: 145,
        billingType: 'PIX',
      }),
    );
    expect(getPayment).toHaveBeenCalledWith('pay-1', { attempts: 1, timeoutMs: 4_000 });
  });

  it('mantém pendente quando o Asaas ainda não informa netValue', async () => {
    mocks.getClinicAsaasClient.mockResolvedValue({
      getPayment: vi.fn().mockResolvedValue({
        status: 'CONFIRMED',
        value: 150,
        netValue: null,
      }),
    });

    const result = await reconcilePendingPaymentEconomics([candidate], new Date());

    expect(result.pending).toBe(1);
    expect(mocks.reconcilePaidChargeEconomics).not.toHaveBeenCalled();
  });

  it('isola falha de um tenant e continua o lote', async () => {
    mocks.getClinicAsaasClient
      .mockRejectedValueOnce(new Error('provider indisponível'))
      .mockResolvedValueOnce(null);

    const result = await reconcilePendingPaymentEconomics(
      [candidate, { ...candidate, chargeId: 'charge-2', clinicId: 'clinic-2' }],
      new Date(),
    );

    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(mocks.emit).toHaveBeenCalledWith(
      'financial.reconcile.payment_economics_error',
      expect.objectContaining({ clinicId: 'clinic-1' }),
    );
  });
});
