// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as QueriesModule from '@/contexts/health-insurance/queries';

import type * as AccessModule from './_lib/access';

const m = vi.hoisted(() => ({
  conveniosAccess: vi.fn(),
  getInsuranceOverview: vi.fn(),
  getGuideDetail: vi.fn(),
  listConsultaFieldOptions: vi.fn(),
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/convenios', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), notFound: () => { throw new Error('404'); } }));
vi.mock('@/contexts/health-insurance/actions', () => {
  const a = () => Object.assign(vi.fn(), { bind: () => vi.fn() });
  return {
    answerAppealAction: a(), approveGuideAction: a(), cancelGuideAction: a(), createAppealAction: a(), decideGlossAction: a(),
    fileAppealAction: a(), exportAppealXmlAction: a(), reconcileGuideAction: a(), returnGuideAction: a(), reverseAllocationAction: a(), reviewGuideAction: a(),
    allocatePaymentAction: a(), createBatchAction: a(), recordBatchProtocolAction: a(), recordGlossAction: a(), recordPaymentAction: a(), importStatementAction: a(),
    updateConsultaFieldsAction: a(),
  };
});
vi.mock('./_lib/access', async (orig) => {
  const real = await orig<typeof AccessModule>();
  return { ...real, conveniosAccess: m.conveniosAccess };
});
vi.mock('@/contexts/health-insurance/queries', async (orig) => {
  const real = await orig<typeof QueriesModule>();
  return { ...real, getInsuranceOverview: m.getInsuranceOverview, getGuideDetail: m.getGuideDetail, listConsultaFieldOptions: m.listConsultaFieldOptions };
});
vi.mock('@/lib/db/tenant', () => ({ withTenant: vi.fn() }));

import GuiaPage from './guias/[guideId]/page';
import ConveniosPage from './page';

const GUIDE = '22222222-2222-4222-8222-222222222222';

const overview = {
  enabled: true,
  insurers: [{ insurerId: 'i1', name: 'Operadora Um', guides: 3, billedCents: 45000, paidCents: 15000, glossOpenCents: 15000, glossDefinitiveCents: 5000, pendingCents: 25000, unreconciledCents: 7000 }],
  totals: { guides: 3, billedCents: 45000, paidCents: 15000, glossOpenCents: 15000, glossDefinitiveCents: 5000, pendingCents: 25000, unreconciledCents: 7000 },
  guidesByStatus: { ready_for_review: 2, approved: 1 },
  openGapsByOwner: { recepcao: 1 },
  guideIssuesByOwner: { recepcao: 2, medico: 1 },
  ledgerDrift: 0,
};

const guide = {
  id: GUIDE, number: '123', guideType: 'consulta', status: 'reviewed', version: 4, revision: 1, insurerId: 'i1', insurerName: 'Operadora Um',
  patientName: 'Paciente Sintético 1', totalValueCents: 15000, issues: [], batchNumber: null, updatedAt: null, cancelReason: null,
  approvedAt: null, reviewedAt: null, items: [{ id: 'it1', sequence: 1, executedOn: '2026-11-10', tableCode: '22', procedureCode: '10101012', description: 'Consulta', quantity: 1, totalValueCents: 15000 }],
  events: [], batchId: null, batchStatus: null, account: null, glosses: [], allocations: [], appeals: [], receivable: null,
};

describe('interface de Convênios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.getInsuranceOverview.mockResolvedValue(overview);
    m.getGuideDetail.mockResolvedValue(guide);
  });
  afterEach(cleanup);

  it('painel: valores por operadora e o que falta para faturar por responsável', async () => {
    m.conveniosAccess.mockResolvedValue({ ok: true, clinicId: 'c1', canManage: true });
    render(await ConveniosPage());
    expect(screen.getAllByText('R$ 450,00').length).toBeGreaterThan(0);
    expect(screen.getByText('Operadora Um')).toBeTruthy();
    expect(screen.getByText('Guias para conferir')).toBeTruthy();
    // Recepção: 2 pendências de guia + 1 de faturamento.
    const recepcao = screen.getByText('Recepção').closest('li')!;
    expect(recepcao.textContent).toContain('3');
  });

  it('D24: no trial o recurso aparece como contratável; suspensa = consulta; liberada = sem aviso', async () => {
    m.conveniosAccess.mockResolvedValue({ ok: true, clinicId: 'c1', canManage: true, commercial: 'trial' });
    render(await ConveniosPage());
    const trial = screen.getByTestId('convenios-commercial-notice');
    expect(trial.dataset.denial).toBe('trial');
    expect(screen.getByText('Convênios faz parte das assinaturas ativas')).toBeTruthy();
    expect(trial.textContent).toContain('assinatura ativa');
    cleanup();
    m.conveniosAccess.mockResolvedValue({ ok: true, clinicId: 'c1', canManage: true, commercial: 'period_expired' });
    render(await ConveniosPage());
    expect(screen.getByText('Convênios em modo de consulta')).toBeTruthy();
    expect(screen.getByTestId('convenios-commercial-notice').textContent).toContain('continuam disponíveis');
    cleanup();
    m.conveniosAccess.mockResolvedValue({ ok: true, clinicId: 'c1', canManage: true, commercial: null });
    render(await ConveniosPage());
    expect(screen.queryByTestId('convenios-commercial-notice')).toBeNull();
  });

  it('sem acesso: a página da regra de acesso substitui o conteúdo', async () => {
    m.conveniosAccess.mockResolvedValue({ ok: false, view: <p>Sem acesso ao convênio</p> });
    render(await ConveniosPage());
    expect(screen.getByText('Sem acesso ao convênio')).toBeTruthy();
    expect(m.getInsuranceOverview).not.toHaveBeenCalledWith('c1');
  });

  it('guia conferida: quem gerencia vê aprovar/devolver/cancelar; quem só vê, nenhuma ação', async () => {
    m.conveniosAccess.mockResolvedValue({ ok: true, clinicId: 'c1', canManage: true });
    render(await GuiaPage({ params: Promise.resolve({ guideId: GUIDE }) }));
    expect(screen.getByRole('button', { name: 'Aprovar e emitir' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Devolver para correção' })).toBeTruthy();
    cleanup();
    m.conveniosAccess.mockResolvedValue({ ok: true, clinicId: 'c1', canManage: false });
    render(await GuiaPage({ params: Promise.resolve({ guideId: GUIDE }) }));
    expect(screen.queryByRole('button', { name: 'Aprovar e emitir' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar guia' })).toBeNull();
  });

  it('D11: dados da consulta com padrão e ajuste; só quem gerencia ajusta, e só com a guia em edição', async () => {
    m.listConsultaFieldOptions.mockResolvedValue({
      regimeAtendimento: [{ code: '01', term: 'Ambulatorial' }, { code: '02', term: 'Emergência' }],
      indicacaoAcidente: [{ code: '9', term: 'Não acidente' }],
      tipoConsulta: [{ code: '1', term: 'Primeira consulta' }, { code: '4', term: 'Por encaminhamento' }],
      coberturaEspecial: [],
      saudeOcupacional: [],
    });
    const adjusted = {
      fromStatus: 'ready_for_review',
      toStatus: 'ready_for_review',
      changedFields: ['consulta_overrides'],
      actorName: 'Gestora',
      actorKind: 'user',
      note: null,
      createdAt: '2026-11-15T10:00:00Z',
    };
    const editing = { ...guide, status: 'ready_for_review', terminologyVersion: '202609', consultaOverrides: { tipoConsulta: '4' }, events: [adjusted] };
    m.getGuideDetail.mockResolvedValue(editing);
    m.conveniosAccess.mockResolvedValue({ ok: true, clinicId: 'c1', canManage: true });
    render(await GuiaPage({ params: Promise.resolve({ guideId: GUIDE }) }));
    expect(m.listConsultaFieldOptions).toHaveBeenCalledWith('c1', '202609', '2026-11-10');
    const panel = screen.getByTestId('consulta-fields');
    expect(panel.textContent).toContain('Padrão: 01 · Ambulatorial');
    expect(panel.textContent).toContain('4 · Por encaminhamento (ajustado)');
    expect(panel.textContent).toContain('Não informada');
    expect(screen.getByRole('button', { name: 'Ajustar dados da consulta' })).toBeTruthy();
    // Histórico: o ajuste diz o que mudou, não "Para conferir → Para conferir".
    const history = screen.getByRole('region', { name: 'Histórico da guia' });
    expect(history.textContent).toContain('Dados da consulta ajustados (etapa: Para conferir)');
    expect(history.textContent).not.toContain('Para conferir → Para conferir');
    cleanup();
    // Conferida: o ajuste continua visível, mas não se edita (devolver para correção primeiro).
    m.getGuideDetail.mockResolvedValue({ ...editing, status: 'reviewed' });
    render(await GuiaPage({ params: Promise.resolve({ guideId: GUIDE }) }));
    expect(screen.getByTestId('consulta-fields').textContent).toContain('(ajustado)');
    expect(screen.queryByRole('button', { name: 'Ajustar dados da consulta' })).toBeNull();
    cleanup();
    // Quem só vê: nunca ajusta.
    m.getGuideDetail.mockResolvedValue(editing);
    m.conveniosAccess.mockResolvedValue({ ok: true, clinicId: 'c1', canManage: false });
    render(await GuiaPage({ params: Promise.resolve({ guideId: GUIDE }) }));
    expect(screen.queryByRole('button', { name: 'Ajustar dados da consulta' })).toBeNull();
    cleanup();
    // SP/SADT não tem estes dados.
    m.getGuideDetail.mockResolvedValue({ ...editing, guideType: 'sp_sadt', consultaOverrides: null });
    m.conveniosAccess.mockResolvedValue({ ok: true, clinicId: 'c1', canManage: true });
    render(await GuiaPage({ params: Promise.resolve({ guideId: GUIDE }) }));
    expect(screen.queryByTestId('consulta-fields')).toBeNull();
  });
});
