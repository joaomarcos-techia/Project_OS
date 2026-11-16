import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  withTenant: vi.fn(),
  emit: vi.fn(),
  expire: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ dbAdmin: { transaction: vi.fn() } }));
vi.mock('@/lib/db/tenant', () => ({ withTenant: m.withTenant }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: m.emit } }));
vi.mock('./internal/authorizations', () => ({ expireAuthorizationsTx: m.expire }));

import { isDailySummaryWindow, runInsuranceMaintenance } from './maintenance';

const tx = { execute: m.execute };

beforeEach(() => {
  vi.clearAllMocks();
  m.withTenant.mockImplementation(async (_clinic: string, fn: (t: typeof tx) => unknown) => fn(tx));
  m.expire.mockResolvedValue([]);
});

/** Respostas do resumo diário de uma clínica: data, autorizações concedidas, contagens. */
function dailyRows(opts: { auths?: unknown[]; awaiting?: number; reviews?: number; cancellations?: number } = {}) {
  m.execute
    .mockResolvedValueOnce([{ d: '2026-11-16' }])
    .mockResolvedValueOnce(opts.auths ?? [])
    .mockResolvedValueOnce([{ awaiting: opts.awaiting ?? 0, reviews: opts.reviews ?? 0, cancellations: opts.cancellations ?? 0 }]);
}

describe('manutenção de Convênios (P6.6/P12.6)', () => {
  it('janela do resumo diário: só a execução das 09:00–09:14 UTC (06:00 de Brasília)', () => {
    expect(isDailySummaryWindow(new Date('2026-11-16T09:00:00Z'))).toBe(true);
    expect(isDailySummaryWindow(new Date('2026-11-16T09:14:59Z'))).toBe(true);
    expect(isDailySummaryWindow(new Date('2026-11-16T09:15:00Z'))).toBe(false);
    expect(isDailySummaryWindow(new Date('2026-11-16T21:00:00Z'))).toBe(false);
  });

  it('fora da janela: só vence autorizações (sem resumo), clínica por clínica', async () => {
    m.expire.mockResolvedValueOnce([{ id: 'a1' }]).mockResolvedValueOnce([]);
    const r = await runInsuranceMaintenance({ deadlineAt: Date.now() + 10_000, now: new Date('2026-11-16T15:00:00Z'), clinics: ['c1', 'c2'] });
    expect(r).toEqual({ clinics: 2, processed: 2, expired: 1, failed: 0, deferred: 0, daily: null });
    expect(m.withTenant.mock.calls.map((c) => c[0])).toEqual(['c1', 'c2']);
    expect(m.execute).not.toHaveBeenCalled();
    expect(m.emit).toHaveBeenCalledWith('insurance.maintenance.run', { clinics: 2, processed: 2, expired: 1, failed: 0, deferred: 0, daily: false });
    expect(m.emit).not.toHaveBeenCalledWith('insurance.maintenance.daily_summary', expect.anything());
  });

  it('na janela: resumo só com contagens agregadas (senha vencendo, sessões acabando, pedidos parados, revisões, cancelamentos)', async () => {
    dailyRows({
      auths: [
        { id: 'x1', status: 'authorized', valid_until: '2026-11-17', items: JSON.stringify([{ quantityAuthorized: 1, quantityConsumed: 0 }]) },
        { id: 'x2', status: 'authorized', valid_until: null, items: [{ quantityAuthorized: 4, quantityConsumed: 3 }] },
      ],
      awaiting: 2,
      reviews: 1,
      cancellations: 1,
    });
    dailyRows();
    const r = await runInsuranceMaintenance({ deadlineAt: Date.now() + 10_000, now: new Date('2026-11-16T09:05:00Z'), clinics: ['c1', 'c2'] });
    expect(r.daily).toEqual({ passwordExpiring: 1, sessionsEnding: 1, awaitingOperatorOverdue: 2, openPayoutReviews: 1, awaitingCancellationReceipts: 1, clinicsWithAlerts: 1 });
    const summary = m.emit.mock.calls.find((c) => c[0] === 'insurance.maintenance.daily_summary')!;
    expect(summary[1]).toEqual({ passwordExpiring: 1, sessionsEnding: 1, awaitingOperatorOverdue: 2, openPayoutReviews: 1, awaitingCancellationReceipts: 1, clinicsWithAlerts: 1, clinics: 2 });
    // Nenhum identificador nas métricas (clínica, autorização).
    expect(JSON.stringify(m.emit.mock.calls)).not.toMatch(/c1|c2|x1|x2/u);
  });

  it('a falha de uma clínica não para as outras nem lança; a métrica leva só o tipo do erro', async () => {
    m.withTenant
      .mockImplementationOnce(async () => {
        throw Object.assign(new Error('violação na clínica c1'), { name: 'DrizzleQueryError' });
      })
      .mockImplementationOnce(async (_c: string, fn: (t: typeof tx) => unknown) => fn(tx));
    m.expire.mockResolvedValueOnce([{ id: 'a9' }]);
    const r = await runInsuranceMaintenance({ deadlineAt: Date.now() + 10_000, now: new Date('2026-11-16T15:00:00Z'), clinics: ['c1', 'c2'] });
    expect([r.processed, r.failed, r.expired]).toEqual([1, 1, 1]);
    expect(m.emit).toHaveBeenCalledWith('insurance.maintenance.clinic_failed', { error: 'DrizzleQueryError' });
    expect(JSON.stringify(m.emit.mock.calls)).not.toMatch(/violação|c1/u);
  });

  it('sem tempo: as clínicas restantes ficam para a próxima execução (adiadas, não perdidas)', async () => {
    const r = await runInsuranceMaintenance({ deadlineAt: Date.now() - 1, now: new Date('2026-11-16T15:00:00Z'), clinics: ['c1', 'c2', 'c3'] });
    expect([r.processed, r.deferred]).toEqual([0, 3]);
    expect(m.withTenant).not.toHaveBeenCalled();
  });
});
