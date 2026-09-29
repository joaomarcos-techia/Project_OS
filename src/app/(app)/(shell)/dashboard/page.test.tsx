// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getActivationChecklist,
  getCashFlowToday,
  getClinicTimezone,
  getCurrentUser,
  getDashboard,
  getProfileNames,
  getRecentActivity,
  listCashFlowDaily,
  redirect,
  countOpenHandoffs,
  currentOnboardingProgress,
} = vi.hoisted(() => ({
  getActivationChecklist: vi.fn(),
  getCashFlowToday: vi.fn(),
  getClinicTimezone: vi.fn(),
  getCurrentUser: vi.fn(),
  getDashboard: vi.fn(),
  getProfileNames: vi.fn(),
  getRecentActivity: vi.fn(),
  listCashFlowDaily: vi.fn(),
  redirect: vi.fn(),
  countOpenHandoffs: vi.fn(),
  currentOnboardingProgress: vi.fn(),
}));

// `useRouter` entra no mock por causa do botao "Atualizar", que e client e
// chama router.refresh(). Sem ele o modulo mockado nao exporta o hook e o
// render inteiro quebra.
vi.mock('next/navigation', () => ({ redirect, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/contexts/ai-agent/queries', () => ({ countOpenHandoffs }));
vi.mock('@/lib/auth/tenant-context', () => ({ getCurrentUser }));
vi.mock('@/contexts/tenancy/queries', () => ({ getClinicTimezone }));
vi.mock('@/contexts/identity/queries', () => ({ getProfileNames }));
vi.mock('@/contexts/financial/queries', () => ({ getCashFlowToday, listCashFlowDaily }));
vi.mock('@/lib/audit/recent', () => ({ getRecentActivity }));
vi.mock('./data', () => ({ getActivationChecklist, getDashboard }));
// O-7 — a leitura de `onboarding_progress` abre `withTenant`, que quer banco de
// verdade. Aqui interessa a COMPOSIÇÃO da tela, e o comportamento do progresso
// tem prova própria em operational-onboarding.test.ts (unidade) e no harness de
// banco. Sem este mock o teste tentaria conectar e falharia por rede, não por
// regressão de dashboard.
vi.mock('../_painel/onboarding-progress', () => ({ currentOnboardingProgress }));

import DashboardPage from './page';

const clinicId = '11111111-1111-1111-1111-111111111111';

const dashboard = {
  consultasHoje: 4,
  aguardando: 1,
  emAtendimento: 1,
  finalizadas: 1,
  faltas: 1,
  cancelados: 0,
  faltaNome: 'Rita Bueno',
  maiorEsperaMin: 24,
  maiorEsperaNome: 'Marina Rezende',
  naoFaturados: 2,
  proximos: [
    {
      appointmentId: 'appointment-1',
      horario: '2026-08-20T13:30:00.000Z',
      nome: 'Maria Silva',
      procedimento: 'Consulta cardiologia',
      status: 'confirmado',
    },
  ],
};

const checklist = {
  done: 1,
  total: 2,
  complete: false,
  items: [
    {
      key: 'patient',
      label: 'Cadastre o primeiro paciente',
      desc: 'Comece sua base de pacientes.',
      href: '/pacientes/novo',
      done: false,
    },
  ],
};

function currentUser(permissions: string[]) {
  return {
    userId: 'user-1',
    clinicId,
    role: 'owner',
    permissions,
    granularPermissionsEnabled: true,
    claimsVersion: 1,
    isSuperAdmin: false,
    aal: 'aal2',
    validatedAt: '2026-08-20T12:00:00.000Z',
  };
}

describe('DashboardPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue(currentUser(['view:financial', 'view:audit']));
    getClinicTimezone.mockResolvedValue('America/Sao_Paulo');
    getDashboard.mockResolvedValue(dashboard);
    getActivationChecklist.mockResolvedValue(checklist);
    // Onboarding intocado: tour não começado e checklist NÃO dispensado — o
    // estado em que os asserts sobre a ativação abaixo fazem sentido.
    currentOnboardingProgress.mockResolvedValue({
      tourState: 'not_started',
      tourStep: 0,
      tourFinishedAt: null,
      docsVisitedAt: null,
      checklistDismissedAt: null,
      rowVersion: 0,
      shouldAutoOpenTour: false,
    });
    getCashFlowToday.mockResolvedValue({
      receber: 42_000,
      pagar: 0,
      recebidoHoje: 18_000,
      pagoHoje: 0,
      saldoHoje: 18_000,
    });
    listCashFlowDaily.mockResolvedValue([{ date: '2026-08-19', totalRecebido: 12_000 }]);
    getRecentActivity.mockResolvedValue([
      {
        id: 'audit-1',
        action: 'patient.updated',
        resourceType: 'patient',
        resourceId: 'patient-1',
        userId: 'user-1',
        createdAt: '2026-08-20T11:50:00.000Z',
      },
    ]);
    getProfileNames.mockResolvedValue(new Map([['user-1', 'Ana Costa']]));
    countOpenHandoffs.mockResolvedValue({ abertos: 0, vencidos: 0 });
  });

  it('prioriza ativação e operação, com agenda antes do gráfico', async () => {
    const { container } = render(await DashboardPage());
    const content = container.textContent ?? '';

    expect(screen.getByText('Consultas hoje')).toBeTruthy();
    expect(screen.getByText('Faturamento recebido')).toBeTruthy();
    expect(screen.getByText('Próximos na agenda')).toBeTruthy();
    expect(screen.getByText('Atividade recente')).toBeTruthy();
    expect(screen.queryByText(/em breve/iu)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Atualizar' })).toBeNull();
    expect(content.indexOf('Consultas hoje')).toBeLessThan(content.indexOf('Faturamento'));
    expect(content.indexOf('Próximos na agenda')).toBeLessThan(content.indexOf('Faturamento'));
    // A ordem virou: enquanto a ativação não fecha, ela vem primeiro. No
    // rodapé o operador não a encontrava — e o bloco some sozinho quando os
    // passos terminam, então não custa nada ao dashboard maduro.
    expect(content.indexOf('Ativação da clínica')).toBeLessThan(content.indexOf('Consultas hoje'));
    expect(screen.getByRole('region', { name: 'Sala de espera e atendimento' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Operação do turno' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Resumo financeiro' })).toBeTruthy();
  });

  it('formata Hoje no fuso da clínica durante a virada do dia em UTC', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T01:00:00.000Z'));

    try {
      render(await DashboardPage());
      expect(screen.getByText('Hoje · quinta-feira, 03 de set. de 2026')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('usa o EmptyState compacto canônico nos três vazios reais', async () => {
    getDashboard.mockResolvedValue({ ...dashboard, proximos: [] });
    getCashFlowToday.mockResolvedValue({
      receber: 0,
      pagar: 0,
      recebidoHoje: 0,
      pagoHoje: 0,
      saldoHoje: 0,
    });
    listCashFlowDaily.mockResolvedValue([]);
    getRecentActivity.mockResolvedValue([]);

    render(await DashboardPage());

    for (const title of [
      'Sem recebimentos no período',
      'Agenda livre hoje',
      'Sem atividade recente',
    ]) {
      expect(screen.getByText(title).parentElement?.className).toContain('py-(--sp-5)');
    }
    expect(screen.queryByText('Nada para hoje.')).toBeNull();
    expect(screen.queryByText('Nenhuma atividade registrada ainda.')).toBeNull();
  });

  it('não consulta nem serializa conteúdo financeiro ou de auditoria sem permissão', async () => {
    getCurrentUser.mockResolvedValue(currentUser([]));

    const { container } = render(await DashboardPage());
    const html = container.innerHTML;

    expect(getCashFlowToday).not.toHaveBeenCalled();
    expect(listCashFlowDaily).not.toHaveBeenCalled();
    expect(getRecentActivity).not.toHaveBeenCalled();
    expect(getProfileNames).not.toHaveBeenCalled();
    expect(html).not.toContain('A receber');
    expect(html).not.toContain('Recebido hoje');
    expect(html).not.toContain('Saldo do dia');
    expect(html).not.toContain('Faturamento');
    expect(html).not.toContain('Financeiro');
    expect(html).not.toContain('Atividade recente');
    expect(html).not.toContain('Ana Costa');
    expect(screen.getByText('Próximos na agenda')).toBeTruthy();
  });
});
