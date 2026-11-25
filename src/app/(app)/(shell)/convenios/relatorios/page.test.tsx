// @vitest-environment happy-dom
/**
 * P9.10 — tela do relatório: pede o relatório com o filtro da URL (datas e operadora válidas), mostra
 * o resumo e o link do CSV com o mesmo filtro; sem guias, estado vazio; período grande, aviso.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AccessModule from '../_lib/access';

const m = vi.hoisted(() => ({ conveniosAccess: vi.fn(), getInsurerReport: vi.fn(), listInsurers: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/convenios/relatorios',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('../_lib/access', async (orig) => {
  const real = await orig<typeof AccessModule>();
  return { ...real, conveniosAccess: m.conveniosAccess };
});
vi.mock('@/contexts/health-insurance/queries', () => ({ listInsurers: m.listInsurers }));
vi.mock('@/contexts/health-insurance/reports', () => {
  class InsurerReportError extends Error {
    constructor(message: string, readonly code: string) {
      super(message);
    }
  }
  return { getInsurerReport: m.getInsurerReport, InsurerReportError, OVERDUE_AFTER_DAYS: 30, REPORT_MAX_DAYS: 366 };
});

import { InsurerReportError } from '@/contexts/health-insurance/reports';

import { accessFor, PROFILES } from '../_lib/access-fixture';
import RelatoriosPage from './page';

const INS = '44444444-4444-4444-8444-444444444444';
const totals = {
  guides: 2, billedCents: 30_000, paidCents: 10_000, glossOpenCents: 0, glossDefinitiveCents: 2_000, pendingCents: 18_000,
  glossRateBps: 667, averageDaysToPay: 12.5, overdueCents: 18_000, aging: { upTo30: 0, d31to60: 18_000, d61to90: 0, over90: 0 },
};
const page = (sp: Record<string, string>) => RelatoriosPage({ searchParams: Promise.resolve(sp) });

describe('relatório por operadora (P9.10)', () => {
  beforeEach(() => {
    m.conveniosAccess.mockResolvedValue(accessFor(PROFILES.financeiro, { commercial: null }));
    m.listInsurers.mockResolvedValue([{ id: INS, name: 'Operadora Sintética' }]);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('exige ver valores do faturamento e repassa o filtro válido; resumo e CSV com o mesmo filtro', async () => {
    m.getInsurerReport.mockResolvedValue({
      filter: { from: '2026-10-01', to: '2026-11-18', insurerId: INS }, today: '2026-11-18',
      lines: [{}, {}], insurers: [{ insurerId: INS, insurerName: 'Operadora Sintética', ...totals }], total: totals,
    });
    render(await page({ from: '2026-10-01', to: '2026-11-18', insurerId: INS }));
    expect(m.conveniosAccess).toHaveBeenCalledWith('Relatórios', 'seeValues');
    expect(m.getInsurerReport).toHaveBeenCalledWith('c1', 'u1', { from: '2026-10-01', to: '2026-11-18', insurerId: INS });
    const region = screen.getByRole('region', { name: 'Resumo por operadora' });
    expect(region.textContent).toContain('Operadora Sintética');
    expect(region.textContent).toContain('6,7%');
    expect(region.textContent).toContain('12,5');
    expect(screen.getByRole('link', { name: 'Exportar CSV' }).getAttribute('href')).toBe(
      `/financeiro/convenios/relatorios/csv?from=2026-10-01&to=2026-11-18&insurerId=${INS}`,
    );
  });

  it('filtro malformado na URL é ignorado (período padrão, todas as operadoras)', async () => {
    m.getInsurerReport.mockResolvedValue({ filter: { from: '2026-08-21', to: '2026-11-18', insurerId: null }, today: '2026-11-18', lines: [], insurers: [], total: totals });
    render(await page({ from: "2026-01-01' OR 1=1", insurerId: 'x' }));
    const arg = m.getInsurerReport.mock.calls[0]![2] as { from: string; insurerId: string | null };
    expect(arg.insurerId).toBeNull();
    expect(arg.from).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(screen.getByText('Nenhuma guia enviada no período')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Exportar CSV' })).toBeNull();
  });

  it('período grande demais: aviso com a mensagem do servidor, sem tabela', async () => {
    m.getInsurerReport.mockRejectedValue(new InsurerReportError('Escolha um período de até 366 dias.', 'invalid'));
    render(await page({ from: '2024-01-01', to: '2026-11-18' }));
    expect(screen.getByText('Escolha um período de até 366 dias.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Resumo por operadora' })).toBeNull();
  });

  it('sem a permissão (recepção, médica): a tela de acesso negado, sem consultar', async () => {
    m.conveniosAccess.mockResolvedValue({ ok: false, view: 'Sem acesso' });
    render(await page({}));
    expect(screen.getByText('Sem acesso')).toBeTruthy();
    expect(m.getInsurerReport).not.toHaveBeenCalled();
  });
});
