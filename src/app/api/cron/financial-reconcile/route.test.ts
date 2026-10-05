import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transactionMock, execute, emit, recordHeartbeat, publishEvent, withTenant } = vi.hoisted(
  () => ({
    transactionMock: vi.fn(),
    execute: vi.fn(),
    emit: vi.fn(),
    recordHeartbeat: vi.fn(),
    publishEvent: vi.fn(),
    withTenant: vi.fn(),
  }),
);

vi.mock('@/lib/http/cron', () => ({ withCron: (_options: unknown, handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({ dbAdmin: { transaction: transactionMock } }));
vi.mock('@/lib/db/tenant', () => ({ withTenant }));
vi.mock('@/lib/cron-heartbeat', () => ({ recordHeartbeat }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent }));
vi.mock('@/contexts/financial', () => ({
  FINANCIAL_EVENTS: { FATURAMENTO_PENDENTE: 'financial.faturamento.pendente' },
  faturamentoPendencias: {},
}));

import { GET } from './route';

const dialect = new PgDialect();

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue([]);
  transactionMock.mockImplementation(
    async (callback: (tx: { execute: typeof execute }) => unknown) => callback({ execute }),
  );
});

describe('financial reconcile', () => {
  it('restaura o papel administrativo antes do scan cross-tenant', async () => {
    const response = await GET(new Request('https://app.qoro.dev/api/cron/financial-reconcile'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      opened: 0,
      clinics: 0,
      paymentEconomicsReconciled: 0,
    });
    expect(transactionMock).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(6);

    const statements = execute.mock.calls.map(([query]) => dialect.sqlToQuery(query as SQL).sql);
    expect(statements[0]).toMatch(/^RESET ROLE$/i);
    expect(statements[1]).toMatch(/from appointments/i);
    expect(statements[1]).toMatch(/not exists \(select 1 from lancamentos/i);
    expect(statements[2]).toMatch(/from patient_credits c/i);
    expect(statements[2]).toMatch(/left join appointments a/i);
    expect(statements[2]).toMatch(/c\.status = 'available'/i);
    expect(statements[2]).toMatch(/c\.granted_at < now\(\) - interval '30 days'/i);
    expect(statements[2]).toMatch(/a\.id is null or a\.scheduled_at < now\(\)/i);
    expect(statements[3]).toMatch(/^RESET ROLE$/i);
    expect(statements[4]).toMatch(/from patient_charges/i);
    expect(statements[4]).toMatch(/economics_reconciled_at is null/i);
    expect(statements[5]).toMatch(/payment_method_mismatch/i);
    expect(emit).toHaveBeenCalledWith('financial.reconcile.run', {
      opened: 0,
      clinics: 0,
      orphanCredits: 0,
      orphanClinics: 0,
      paymentEconomicsCandidates: 0,
      paymentEconomicsReconciled: 0,
      paymentEconomicsPending: 0,
      paymentEconomicsSkipped: 0,
      paymentEconomicsMismatched: 0,
      paymentEconomicsFailed: 0,
      paymentAnomalyCandidates: 0,
      paymentAnomalyRecovered: 0,
      paymentAnomalyMismatched: 0,
      paymentAnomalySkipped: 0,
      paymentAnomalyFailed: 0,
      paymentBackstopSkippedForBudget: false,
    });
  });

  it('agrega créditos órfãos por tenant/status sem mover dinheiro', async () => {
    execute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { clinicId: 'clinic-a', appointmentStatus: 'cancelado', count: 2 },
        { clinicId: 'clinic-a', appointmentStatus: 'agendado', count: 3 },
        { clinicId: 'clinic-b', appointmentStatus: 'faltou', count: 1 },
        { clinicId: 'clinic-b', appointmentStatus: 'missing', count: 1 },
      ]);

    const response = await GET(new Request('https://app.qoro.dev/api/cron/financial-reconcile'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      opened: 0,
      clinics: 0,
      paymentEconomicsReconciled: 0,
    });
    expect(emit).toHaveBeenCalledWith('financial.reconcile.orphan_credit_detected', {
      credits: 7,
      clinics: 2,
      terminal: 3,
      staleActive: 3,
      missingAppointment: 1,
      ageDays: 30,
    });
    expect(recordHeartbeat).toHaveBeenCalledWith('financial-reconcile', 'success', {
      opened: 0,
      clinics: 0,
      orphanCredits: 7,
      orphanClinics: 2,
      paymentEconomicsCandidates: 0,
      paymentEconomicsReconciled: 0,
      paymentEconomicsPending: 0,
      paymentEconomicsSkipped: 0,
      paymentEconomicsMismatched: 0,
      paymentEconomicsFailed: 0,
      paymentAnomalyCandidates: 0,
      paymentAnomalyRecovered: 0,
      paymentAnomalyMismatched: 0,
      paymentAnomalySkipped: 0,
      paymentAnomalyFailed: 0,
      paymentBackstopSkippedForBudget: false,
    });
    expect(withTenant).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('preserva a abertura idempotente da pendência de recebível', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const tenantTx = { insert: vi.fn(() => ({ values })) };
    withTenant.mockImplementation(
      async (_clinicId: string, callback: (tx: typeof tenantTx) => Promise<void>) =>
        callback(tenantTx),
    );
    publishEvent.mockResolvedValue(undefined);
    execute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'appointment-a', clinic_id: 'clinic-a', valor: '200.00' }])
      .mockResolvedValueOnce([]);

    const response = await GET(new Request('https://app.qoro.dev/api/cron/financial-reconcile'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      opened: 1,
      clinics: 1,
      paymentEconomicsReconciled: 0,
    });
    expect(withTenant).toHaveBeenCalledTimes(1);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(publishEvent).toHaveBeenCalledWith(
      tenantTx,
      expect.objectContaining({
        clinicId: 'clinic-a',
        eventType: 'financial.faturamento.pendente',
        idempotencyKey: expect.stringMatching(/^reconcile:appointment-a:\d{4}-\d{2}-\d{2}$/),
      }),
    );
    expect(publishEvent.mock.invocationCallOrder[0]).toBeLessThan(
      execute.mock.invocationCallOrder[3]!,
    );
    expect(emit).toHaveBeenCalledWith('financial.reconcile.pendencia_opened', {
      opened: 1,
      clinics: 1,
    });
    expect(emit).not.toHaveBeenCalledWith(
      'financial.reconcile.orphan_credit_detected',
      expect.anything(),
    );
  });

  it('preserva o trabalho primário quando o orçamento do backstop termina', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(30_001);
    try {
      const response = await GET(new Request('https://app.qoro.dev/api/cron/financial-reconcile'));
      expect(response.status).toBe(200);
      expect(transactionMock).toHaveBeenCalledTimes(1);
      expect(recordHeartbeat).toHaveBeenCalledWith(
        'financial-reconcile',
        'success',
        expect.objectContaining({
          paymentEconomicsCandidates: 0,
          paymentAnomalyCandidates: 0,
          paymentBackstopSkippedForBudget: true,
        }),
      );
      expect(emit).toHaveBeenCalledWith('financial.reconcile.payment_backstop_skipped_budget', {});
    } finally {
      clock.mockRestore();
    }
  });
});
