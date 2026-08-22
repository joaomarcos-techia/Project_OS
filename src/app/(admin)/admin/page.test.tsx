// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  captureException,
  guardAdminAccess,
  getDashboard,
  getMrrTrend,
  getStatusBreakdown,
  list,
  listAtRisk,
  emitMetric,
} = vi.hoisted(() => ({
  captureException: vi.fn(),
  guardAdminAccess: vi.fn(),
  getDashboard: vi.fn(),
  getMrrTrend: vi.fn(),
  getStatusBreakdown: vi.fn(),
  list: vi.fn(),
  listAtRisk: vi.fn(),
  emitMetric: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({ captureException }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: emitMetric } }));
vi.mock('./_lib/guard', () => ({ guardAdminAccess }));
vi.mock('./_lib/repositories/metrics.repo', () => ({
  adminMetricsRepository: { getDashboard, getMrrTrend, getStatusBreakdown },
}));
vi.mock('./_lib/repositories/clinics.repo', () => ({
  clinicRepository: { list, listAtRisk },
}));

import AdminError from './error';
import AdminDashboardPage from './page';

const dashboard = {
  mrrCents: 1_234_500,
  arrCents: 14_814_000,
  churnRatePct: 2.5,
  monthlyGrowthPct: 8,
  clinics: { active: 12, atRisk: 1, new: 3, cancelled: 2 },
  generatedAt: '2026-08-20T12:00:00.000Z',
};

const recentClinic = {
  id: '11111111-1111-1111-1111-111111111111',
  nome: 'Clínica Aurora',
  slug: 'clinica-aurora',
  status: 'active',
  planCode: 'pro',
  billingStatus: 'active',
  lastActivityAt: '2026-08-20T11:00:00.000Z',
};

const riskClinic = {
  id: '22222222-2222-2222-2222-222222222222',
  nome: 'Clínica Horizonte',
  slug: 'clinica-horizonte',
  status: 'pending_payment',
};

describe('AdminDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guardAdminAccess.mockResolvedValue(undefined);
    getDashboard.mockResolvedValue(dashboard);
    getMrrTrend.mockResolvedValue([
      { label: 'mar', cents: 900_000 },
      { label: 'abr', cents: 1_000_000 },
      { label: 'mai', cents: 1_050_000 },
      { label: 'jun', cents: 1_100_000 },
      { label: 'jul', cents: 1_150_000 },
      { label: 'ago', cents: 1_234_500 },
    ]);
    getStatusBreakdown.mockResolvedValue({ active: 12, trial: 4, atRisk: 1, cancelled: 2 });
    list.mockResolvedValue({ items: [recentClinic], total: 1, page: 1, pageSize: 4 });
    listAtRisk.mockResolvedValue([riskClinic]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renderiza KPIs e listas quando todas as leituras respondem', async () => {
    render(await AdminDashboardPage());

    const metrics = screen.getByRole('region', { name: 'Métricas principais' });

    expect(within(metrics).getByText('MRR')).toBeTruthy();
    expect(within(metrics).getByText(/12\.345,00/u)).toBeTruthy();
    expect(within(metrics).getByText(/ARR.+148\.140,00/u)).toBeTruthy();
    expect(within(metrics).getByText('Clínicas ativas')).toBeTruthy();
    expect(within(metrics).getByText('12')).toBeTruthy();
    expect(within(metrics).getByText('3 novas no mês')).toBeTruthy();
    expect(within(metrics).getByText('Em risco')).toBeTruthy();
    expect(within(metrics).getByText('1')).toBeTruthy();
    expect(within(metrics).getByText('Churn mensal')).toBeTruthy();
    expect(within(metrics).getByText('2.5%')).toBeTruthy();
    expect(within(metrics).getByText('Crescimento MoM')).toBeTruthy();
    expect(within(metrics).getByText('8.0%')).toBeTruthy();
    expect(within(metrics).getByText('líquido positivo')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Receita paga' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Distribuição de clínicas' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Novas clínicas' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Clínicas em risco' })).toBeTruthy();
    expect(screen.getByText('ago')).toBeTruthy();
    expect(screen.getByText('Ativas')).toBeTruthy();
    expect(screen.getByText('Clínica Aurora')).toBeTruthy();
    expect(screen.getByText('/clinica-aurora')).toBeTruthy();
    expect(screen.getByText('pro')).toBeTruthy();
    expect(screen.getByText('Clínica Horizonte')).toBeTruthy();
    expect(screen.getByText('Aguardando pagamento')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Pagamentos' }).getAttribute('href')).toBe(
      '/admin/billing',
    );
    expect(screen.getByRole('link', { name: /Clínica Aurora/u }).getAttribute('href')).toBe(
      `/admin/clinicas/${recentClinic.id}`,
    );
    expect(screen.queryByRole('link', { name: 'Atualizar' })).toBeNull();
    expect(guardAdminAccess).toHaveBeenCalledOnce();
    expect(getDashboard).toHaveBeenCalledOnce();
    expect(getMrrTrend).toHaveBeenCalledWith(6);
    expect(getStatusBreakdown).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledWith({ pageSize: 4 });
    expect(listAtRisk).toHaveBeenCalledWith(4);
  });

  it('não inicia nenhuma leitura quando o guard admin bloqueia a rota', async () => {
    guardAdminAccess.mockRejectedValue(new Error('forbidden'));

    await expect(AdminDashboardPage()).rejects.toThrow('forbidden');

    expect(getDashboard).not.toHaveBeenCalled();
    expect(getMrrTrend).not.toHaveBeenCalled();
    expect(getStatusBreakdown).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(listAtRisk).not.toHaveBeenCalled();
  });

  it('mantém zeros e estados vazios quando eles são respostas reais', async () => {
    getDashboard.mockResolvedValue({
      ...dashboard,
      mrrCents: 0,
      arrCents: 0,
      churnRatePct: 0,
      monthlyGrowthPct: 0,
      clinics: { active: 0, atRisk: 0, new: 0, cancelled: 0 },
    });
    getMrrTrend.mockResolvedValue([{ label: 'ago', cents: 0 }]);
    getStatusBreakdown.mockResolvedValue({ active: 0, trial: 0, atRisk: 0, cancelled: 0 });
    list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 4 });
    listAtRisk.mockResolvedValue([]);

    render(await AdminDashboardPage());

    expect(screen.getAllByText(/R\$\s*0,00/u)).toHaveLength(2);
    expect(screen.getByText('Sem faturas pagas no período.')).toBeTruthy();
    expect(screen.getByText('Nenhuma clínica cadastrada.')).toBeTruthy();
    expect(screen.getByText('Nenhuma clínica ainda.')).toBeTruthy();
    expect(screen.getByText(/Nenhuma clínica em risco/u)).toBeTruthy();
  });

  it('propaga erro de leitura em vez de renderizar zero ou lista vazia', async () => {
    getDashboard.mockRejectedValue(new Error('database unavailable'));

    await expect(AdminDashboardPage()).rejects.toThrow('database unavailable');
  });

  it('propaga timeout em vez de renderizar a série como vazia', async () => {
    vi.useFakeTimers();
    getMrrTrend.mockReturnValue(new Promise(() => {}));

    const result = expect(AdminDashboardPage()).rejects.toThrow(/admin\.getMrrTrend.+8000ms/u);
    await vi.advanceTimersByTimeAsync(8_000);

    await result;
    expect(emitMetric).toHaveBeenCalledWith('query.timeout', {
      name: 'admin.getMrrTrend',
      ms: 8_000,
      mode: 'deadline',
    });
  });
});

describe('AdminError', () => {
  it('oferece retry pelo reset do error boundary', () => {
    const reset = vi.fn();
    const error = new Error('database unavailable');

    render(<AdminError error={error} reset={reset} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(reset).toHaveBeenCalledOnce();
    expect(captureException).toHaveBeenCalledWith(error);
  });
});
