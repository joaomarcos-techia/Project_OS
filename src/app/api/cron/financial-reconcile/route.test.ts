import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transactionMock,
  execute,
  emit,
  recordHeartbeat,
  publishEvent,
  withTenant,
  listBillingGapCandidates,
  reconcileInsuranceBilling,
  listCopaySyncCandidates,
  reconcileCopayCharges,
  runInsuranceMaintenance,
  captureBackgroundError,
} = vi.hoisted(() => ({
  runInsuranceMaintenance: vi.fn(),
  captureBackgroundError: vi.fn(),
  listBillingGapCandidates: vi.fn(),
  reconcileInsuranceBilling: vi.fn(),
  listCopaySyncCandidates: vi.fn(),
  reconcileCopayCharges: vi.fn(),
  transactionMock: vi.fn(),
  execute: vi.fn(),
  emit: vi.fn(),
  recordHeartbeat: vi.fn(),
  publishEvent: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock('@/lib/http/cron', () => ({ withCron: (_options: unknown, handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({ dbAdmin: { transaction: transactionMock } }));
vi.mock('@/lib/db/tenant', () => ({ withTenant }));
vi.mock('@/lib/cron-heartbeat', () => ({ recordHeartbeat }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));
vi.mock('@/lib/observability/capture', () => ({ captureBackgroundError }));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent }));
// O passo de convênio (P7.4) tem a própria prova em banco descartável; aqui só a costura com o cron.
vi.mock('@/contexts/health-insurance', () => ({
  listBillingGapCandidates,
  reconcileInsuranceBilling,
  listCopaySyncCandidates,
  reconcileCopayCharges,
  runInsuranceMaintenance,
}));
vi.mock('@/contexts/financial', () => ({
  FINANCIAL_EVENTS: { FATURAMENTO_PENDENTE: 'financial.faturamento.pendente' },
  faturamentoPendencias: {},
}));

import { GET } from './route';

const dialect = new PgDialect();

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue([]);
  listBillingGapCandidates.mockResolvedValue([]);
  listCopaySyncCandidates.mockResolvedValue([]);
  runInsuranceMaintenance.mockResolvedValue({ clinics: 0, processed: 0, expired: 0, failed: 0, deferred: 0, uploadsSwept: 0, alertsCreated: 0, alertsCancelled: 0, alertsQueued: 0, daily: null });
  reconcileCopayCharges.mockResolvedValue({
    candidates: 0,
    changed: 0,
    unchanged: 0,
    failed: 0,
    skippedForBudget: 0,
  });
  reconcileInsuranceBilling.mockResolvedValue({
    candidates: 0,
    processed: 0,
    guideReady: 0,
    gapOpen: 0,
    closed: 0,
    busy: 0,
    failed: 0,
    skippedForBudget: 0,
  });
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
    expect(transactionMock).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledTimes(9);

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
    expect(statements[5]).toMatch(/economics_reconciled_at IS NOT NULL/i);
    expect(statements[6]).toMatch(/payment_method_mismatch/i);
    // R54: varredura do estorno externo, também com o papel restaurado e só identificadores.
    expect(statements[7]).toMatch(/^RESET ROLE$/i);
    expect(statements[8]).toMatch(/from patient_charges/i);
    expect(statements[8]).toMatch(/status = 'paid'/i);
    expect(statements[8]).toMatch(/refund_checked_at/i);
    expect(statements[8]).not.toMatch(/amount|patient_id/i);
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
      paymentCorrectionCandidates: 0,
      paymentCorrectionsApplied: 0,
      paymentCorrectionsFailed: 0,
      paymentAnomalyCandidates: 0,
      paymentAnomalyRecovered: 0,
      paymentAnomalyMismatched: 0,
      paymentAnomalySkipped: 0,
      paymentAnomalyFailed: 0,
      paymentBackstopSkippedForBudget: false,
      externalRefundCandidates: 0,
      externalRefundChecked: 0,
      externalRefundRecorded: 0,
      externalRefundReview: 0,
      externalRefundDeferred: 0,
      externalRefundFailed: false,
      insuranceCandidates: 0,
      insuranceGuideReady: 0,
      insuranceGapOpen: 0,
      insuranceFailed: false,
      copaySyncCandidates: 0,
      copaySyncChanged: 0,
      copaySyncFailed: false,
      insuranceMaintenanceExpired: 0,
      insuranceMaintenanceDeferred: 0,
      insuranceMaintenanceFailed: false,
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
      paymentCorrectionCandidates: 0,
      paymentCorrectionsApplied: 0,
      paymentCorrectionsFailed: 0,
      paymentAnomalyCandidates: 0,
      paymentAnomalyRecovered: 0,
      paymentAnomalyMismatched: 0,
      paymentAnomalySkipped: 0,
      paymentAnomalyFailed: 0,
      paymentBackstopSkippedForBudget: false,
      externalRefundCandidates: 0,
      externalRefundChecked: 0,
      externalRefundRecorded: 0,
      externalRefundReview: 0,
      externalRefundDeferred: 0,
      externalRefundFailed: false,
      insuranceCandidates: 0,
      insuranceGuideReady: 0,
      insuranceGapOpen: 0,
      insuranceFailed: false,
      copaySyncCandidates: 0,
      copaySyncChanged: 0,
      copaySyncFailed: false,
      insuranceMaintenanceExpired: 0,
      insuranceMaintenanceDeferred: 0,
      insuranceMaintenanceFailed: false,
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

  it('convênio sem guia (P7.4): roda depois do trabalho financeiro e uma falha dele não derruba o cron', async () => {
    const response = await GET(new Request('https://app.qoro.dev/api/cron/financial-reconcile'));
    expect(response.status).toBe(200);
    expect(listBillingGapCandidates).toHaveBeenCalledWith(25);
    expect(reconcileInsuranceBilling).toHaveBeenCalledWith([], { deadlineAt: expect.any(Number) });

    vi.clearAllMocks();
    execute.mockResolvedValue([]);
    listBillingGapCandidates.mockRejectedValue(new TypeError('banco fora'));
    const failed = await GET(new Request('https://app.qoro.dev/api/cron/financial-reconcile'));
    expect(failed.status).toBe(200);
    expect(emit).toHaveBeenCalledWith('insurance.reconcile.error', { error: 'TypeError' });
    expect(recordHeartbeat).toHaveBeenCalledWith(
      'financial-reconcile',
      'success',
      expect.objectContaining({ insuranceFailed: true, insuranceCandidates: 0 }),
    );
  });

  it('coparticipação atrás do dinheiro (P10.5): sincroniza os candidatos e uma falha dela não derruba o cron', async () => {
    const candidates = [{ clinicId: 'clinic-a', copaymentId: 'copay-1' }];
    listCopaySyncCandidates.mockResolvedValue(candidates);
    reconcileCopayCharges.mockResolvedValue({
      candidates: 1,
      changed: 1,
      unchanged: 0,
      failed: 0,
      skippedForBudget: 0,
    });
    const response = await GET(new Request('https://app.qoro.dev/api/cron/financial-reconcile'));
    expect(response.status).toBe(200);
    expect(listCopaySyncCandidates).toHaveBeenCalledWith(50);
    expect(reconcileCopayCharges).toHaveBeenCalledWith(candidates, {
      deadlineAt: expect.any(Number),
    });
    expect(recordHeartbeat).toHaveBeenCalledWith(
      'financial-reconcile',
      'success',
      expect.objectContaining({
        copaySyncCandidates: 1,
        copaySyncChanged: 1,
        copaySyncFailed: false,
      }),
    );

    vi.clearAllMocks();
    execute.mockResolvedValue([]);
    listCopaySyncCandidates.mockRejectedValue(new TypeError('banco fora'));
    const failed = await GET(new Request('https://app.qoro.dev/api/cron/financial-reconcile'));
    expect(failed.status).toBe(200);
    expect(emit).toHaveBeenCalledWith('insurance.copay_sync.error', { error: 'TypeError' });
    expect(recordHeartbeat).toHaveBeenCalledWith(
      'financial-reconcile',
      'success',
      expect.objectContaining({ copaySyncFailed: true, copaySyncCandidates: 0 }),
    );
  });

  it('P6.6/P12.6: a manutenção de Convênios roda por último; se falhar, o cron responde 200 e as obrigações financeiras já foram cumpridas', async () => {
    runInsuranceMaintenance.mockRejectedValueOnce(Object.assign(new Error('banco indisponível'), { name: 'DrizzleQueryError' }));
    const response = await GET(new Request('https://app.qoro.dev/api/cron/financial-reconcile'));
    expect(response.status).toBe(200);
    // Depois da coparticipação (a última obrigação de antes).
    expect(runInsuranceMaintenance.mock.invocationCallOrder[0]).toBeGreaterThan(reconcileCopayCharges.mock.invocationCallOrder[0]!);
    expect(runInsuranceMaintenance).toHaveBeenCalledWith({ deadlineAt: expect.any(Number) });
    // Só o tipo do erro, sem mensagem do banco nem clínica.
    expect(emit).toHaveBeenCalledWith('insurance.maintenance.error', { error: 'DrizzleQueryError' });
    // P12.6: a falha também vai ao Sentry (fluxo próprio), onde a regra de alerta a vê.
    expect(captureBackgroundError).toHaveBeenCalledWith(expect.objectContaining({ name: 'DrizzleQueryError' }), { flow: 'cron.insurance-maintenance' });
    expect(recordHeartbeat).toHaveBeenCalledWith(
      'financial-reconcile',
      'success',
      expect.objectContaining({ insuranceMaintenanceFailed: true, opened: 0 }),
    );
  });

  it('P6.6/P12.6: o resultado da manutenção entra no registro da execução (vencidas, adiadas, falhas por clínica)', async () => {
    runInsuranceMaintenance.mockResolvedValueOnce({ clinics: 3, processed: 2, expired: 4, failed: 1, deferred: 0, daily: null });
    await GET(new Request('https://app.qoro.dev/api/cron/financial-reconcile'));
    expect(recordHeartbeat).toHaveBeenCalledWith(
      'financial-reconcile',
      'success',
      expect.objectContaining({ insuranceMaintenanceExpired: 4, insuranceMaintenanceDeferred: 0, insuranceMaintenanceFailed: true }),
    );
  });
});
