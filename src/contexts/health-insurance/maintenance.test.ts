import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  withTenant: vi.fn(),
  emit: vi.fn(),
  expire: vi.fn(),
  execute: vi.fn(),
  sync: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ dbAdmin: { transaction: vi.fn() } }));
vi.mock('@/lib/db/tenant', () => ({ withTenant: m.withTenant }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: m.emit } }));
vi.mock('./internal/authorizations', () => ({ expireAuthorizationsTx: m.expire }));
vi.mock('./internal/authorization-alert-service', () => ({ AWAITING_OPERATOR_ALERT_DAYS: 3, syncAuthorizationAlertsTx: m.sync }));
vi.mock('@/lib/storage/tiss-files', () => ({ supabaseTissObjectStore: () => { throw new Error('sem armazenamento real no teste'); } }));

import { isAlertSyncWindow, isDailySummaryWindow, runInsuranceMaintenance } from './maintenance';

// O ponto de salvamento dos avisos roda a função com a própria transação.
const tx = { execute: m.execute, transaction: async (fn: (sp: unknown) => unknown) => fn(tx) };
/** Armazenamento em memória: uma parte abandonada há 3 h e outra recente, da clínica c1. */
const removed: string[] = [];
const store = {
  put: vi.fn(), get: vi.fn(),
  remove: async (ref: string) => { removed.push(ref); },
  list: async (clinicId: string) =>
    clinicId === 'c1'
      ? [
          { ref: 'c1/upload-velho-000', createdAt: new Date(Date.now() - 3 * 3_600_000) },
          { ref: 'c1/upload-novo-000', createdAt: new Date() },
          { ref: 'c1/arquivo-registrado', createdAt: new Date(Date.now() - 9 * 3_600_000) },
        ]
      : [],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.withTenant.mockImplementation(async (_clinic: string, fn: (t: typeof tx) => unknown) => fn(tx));
  m.expire.mockResolvedValue([]);
  m.sync.mockResolvedValue({ operable: true, created: 0, cancelled: 0, deliveryRequested: 0 });
  removed.length = 0;
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
    const r = await runInsuranceMaintenance({ deadlineAt: Date.now() + 10_000, now: new Date('2026-11-16T15:20:00Z'), clinics: ['c1', 'c2'] });
    expect(r).toEqual({ clinics: 2, processed: 2, expired: 1, failed: 0, deferred: 0, uploadsSwept: 0, alertsCreated: 0, alertsCancelled: 0, alertsQueued: 0, daily: null });
    // Fora da janela da hora, os avisos só rodam na clínica em que algo venceu (c1).
    expect(m.sync.mock.calls.map((c) => c[1])).toEqual(['c1']);
    expect(m.withTenant.mock.calls.map((c) => c[0])).toEqual(['c1', 'c2']);
    expect(m.execute).not.toHaveBeenCalled();
    expect(m.emit).toHaveBeenCalledWith('insurance.maintenance.run', { clinics: 2, processed: 2, expired: 1, failed: 0, deferred: 0, uploadsSwept: 0, alertsCreated: 0, alertsCancelled: 0, alertsQueued: 0, daily: false });
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
    const r = await runInsuranceMaintenance({ deadlineAt: Date.now() + 10_000, now: new Date('2026-11-16T09:05:00Z'), clinics: ['c1', 'c2'], store });
    // P6.3: só a parte de envio abandonada (> 2 h) sai; a recente e o arquivo registrado ficam.
    expect([r.uploadsSwept, removed]).toEqual([1, ['c1/upload-velho-000']]);
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

  it('avisos à clínica (P6.6): na janela da hora sincroniza todas; as contagens entram no resumo da execução', async () => {
    m.sync
      .mockResolvedValueOnce({ operable: true, created: 2, cancelled: 1, deliveryRequested: 2 })
      .mockResolvedValueOnce({ operable: false, created: 0, cancelled: 0, deliveryRequested: 0 });
    const r = await runInsuranceMaintenance({ deadlineAt: Date.now() + 10_000, now: new Date('2026-11-16T15:05:00Z'), clinics: ['c1', 'c2'] });
    expect(isAlertSyncWindow(new Date('2026-11-16T15:05:00Z'))).toBe(true);
    expect(isAlertSyncWindow(new Date('2026-11-16T15:15:00Z'))).toBe(false);
    expect(m.sync.mock.calls.map((c) => c[1])).toEqual(['c1', 'c2']);
    expect([r.alertsCreated, r.alertsCancelled, r.alertsQueued]).toEqual([2, 1, 2]);
    expect(JSON.stringify(m.emit.mock.calls)).not.toMatch(/c1|c2/u);
  });

  it('falha nos avisos NÃO desfaz o vencimento nem derruba a clínica: só a métrica com o tipo do erro', async () => {
    m.expire.mockResolvedValueOnce([{ id: 'a1' }]);
    m.sync.mockRejectedValueOnce(
      Object.assign(new Error('relation "hi_authorization_alerts" does not exist'), {
        name: 'DrizzleQueryError',
        cause: { code: '42P01', message: 'relation "hi_authorization_alerts" does not exist' },
      }),
    );
    const r = await runInsuranceMaintenance({ deadlineAt: Date.now() + 10_000, now: new Date('2026-11-16T15:05:00Z'), clinics: ['c1'] });
    expect([r.processed, r.failed, r.expired, r.alertsCreated]).toEqual([1, 0, 1, 0]);
    expect(m.emit).toHaveBeenCalledWith('insurance.alerts.sync_failed', { error: 'DrizzleQueryError', code: '42P01', constraint: null });
    expect(JSON.stringify(m.emit.mock.calls)).not.toContain('hi_authorization_alerts');
  });
});
