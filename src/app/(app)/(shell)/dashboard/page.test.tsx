// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '@/lib/env';

const {
  demoEnv,
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
  getWhatsappSendAlert,
} = vi.hoisted(() => ({
  demoEnv: {
    DASHBOARD_DEMO_USER_ID: undefined as string | undefined,
    DASHBOARD_DEMO_CLINIC_ID: undefined as string | undefined,
  },
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
  getWhatsappSendAlert: vi.fn(),
}));

// `useRouter` entra no mock por causa do botao "Atualizar", que e client e
// chama router.refresh(). Sem ele o modulo mockado nao exporta o hook e o
// render inteiro quebra.
vi.mock('next/navigation', () => ({ redirect, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/contexts/ai-agent/queries', () => ({ countOpenHandoffs }));
vi.mock('@/lib/auth/tenant-context', () => ({ getCurrentUser }));
vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<{ env: Env }>();
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get(target, property, receiver) {
        if (property === 'DASHBOARD_DEMO_USER_ID') return demoEnv.DASHBOARD_DEMO_USER_ID;
        if (property === 'DASHBOARD_DEMO_CLINIC_ID') return demoEnv.DASHBOARD_DEMO_CLINIC_ID;
        return Reflect.get(target, property, receiver);
      },
    }),
  };
});
vi.mock('@/contexts/tenancy/queries', () => ({ getClinicTimezone }));
vi.mock('@/contexts/identity/queries', () => ({ getProfileNames }));
vi.mock('@/contexts/financial/queries', () => ({ getCashFlowToday, listCashFlowDaily }));
vi.mock('@/lib/audit/recent', () => ({ getRecentActivity }));
vi.mock('./data', () => ({ getActivationChecklist, getDashboard, getWhatsappSendAlert }));
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
    name: 'Dr. Matheus Silva',
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
    demoEnv.DASHBOARD_DEMO_USER_ID = undefined;
    demoEnv.DASHBOARD_DEMO_CLINIC_ID = undefined;
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
    getWhatsappSendAlert.mockResolvedValue({ account: null, refusals: null });
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

  it('mantém o nome completo do usuário na saudação do cabeçalho', async () => {
    render(await DashboardPage());

    expect(
      screen.getByRole('heading', {
        name: /^(?:Bom dia|Boa tarde|Boa noite), Dr\. Matheus Silva$/u,
      }),
    ).toBeTruthy();
  });

  it('mostra a prévia apenas ao usuário configurado, sem escrever ou ler métricas reais', async () => {
    demoEnv.DASHBOARD_DEMO_USER_ID = 'demo-user';
    demoEnv.DASHBOARD_DEMO_CLINIC_ID = clinicId;
    getCurrentUser.mockResolvedValue({
      ...currentUser(['view:financial', 'view:audit', 'view:conversations']),
      userId: 'demo-user',
      name: 'Dr. Matheus Pereira',
    });

    render(await DashboardPage());

    expect(screen.getByText(/Dados ilustrativos somente nesta página/u)).toBeTruthy();
    expect(screen.getAllByText('Paciente ilustrativo A').length).toBeGreaterThan(0);
    expect(screen.getByText('R$ 1.820,00')).toBeTruthy();
    expect(screen.queryByText('Ativação da clínica')).toBeNull();
    expect(getDashboard).not.toHaveBeenCalled();
    expect(getCashFlowToday).not.toHaveBeenCalled();
    expect(listCashFlowDaily).not.toHaveBeenCalled();
    expect(getRecentActivity).not.toHaveBeenCalled();
    expect(getProfileNames).not.toHaveBeenCalled();
    expect(countOpenHandoffs).not.toHaveBeenCalled();
  });

  it('mantém os dados reais para qualquer outro usuário', async () => {
    demoEnv.DASHBOARD_DEMO_USER_ID = 'demo-user';
    demoEnv.DASHBOARD_DEMO_CLINIC_ID = clinicId;

    render(await DashboardPage());

    expect(screen.queryByText(/Dados ilustrativos somente nesta página/u)).toBeNull();
    expect(getDashboard).toHaveBeenCalledWith(clinicId, 'America/Sao_Paulo');
    expect(getCashFlowToday).toHaveBeenCalled();
    expect(getRecentActivity).toHaveBeenCalled();
  });

  it('não aplica a prévia quando a conta de teste está em outra clínica', async () => {
    demoEnv.DASHBOARD_DEMO_USER_ID = 'user-1';
    demoEnv.DASHBOARD_DEMO_CLINIC_ID = '22222222-2222-2222-2222-222222222222';

    render(await DashboardPage());

    expect(screen.queryByText(/Dados ilustrativos somente nesta página/u)).toBeNull();
    expect(getDashboard).toHaveBeenCalledWith(clinicId, 'America/Sao_Paulo');
  });

  it('mantém os gates financeiros e de auditoria também na prévia', async () => {
    demoEnv.DASHBOARD_DEMO_USER_ID = 'demo-user';
    demoEnv.DASHBOARD_DEMO_CLINIC_ID = clinicId;
    getCurrentUser.mockResolvedValue({ ...currentUser([]), userId: 'demo-user' });

    const { container } = render(await DashboardPage());

    expect(container.innerHTML).not.toContain('R$ 1.820,00');
    expect(screen.queryByText('Atividade recente')).toBeNull();
    expect(screen.queryByText('Faturamento recebido')).toBeNull();
    expect(getCashFlowToday).not.toHaveBeenCalled();
    expect(getRecentActivity).not.toHaveBeenCalled();
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

describe('DashboardPage — mensagens automáticas do WhatsApp', () => {
  afterEach(cleanup);

  const blocked = {
    account: {
      state: 'blocked',
      headline:
        'A Meta bloqueou as mensagens automáticas do WhatsApp: lembretes e links de sinal não chegam aos pacientes',
    },
    refusals: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    demoEnv.DASHBOARD_DEMO_USER_ID = undefined;
    demoEnv.DASHBOARD_DEMO_CLINIC_ID = undefined;
    getCurrentUser.mockResolvedValue(currentUser(['manage:settings']));
    getClinicTimezone.mockResolvedValue('America/Sao_Paulo');
    getDashboard.mockResolvedValue({ ...dashboard, naoFaturados: 0 });
    getActivationChecklist.mockResolvedValue({ ...checklist, complete: true });
    currentOnboardingProgress.mockResolvedValue(null);
    countOpenHandoffs.mockResolvedValue({ abertos: 0, vencidos: 0 });
    getWhatsappSendAlert.mockResolvedValue(blocked);
  });

  it('conta bloqueada: uma faixa que leva à tela de WhatsApp', async () => {
    render(await DashboardPage());

    expect(getWhatsappSendAlert).toHaveBeenCalledWith(clinicId);
    const link = screen.getByRole('link', { name: /A Meta bloqueou as mensagens automáticas/u });
    expect(link.getAttribute('href')).toBe('/configuracoes/whatsapp');
    expect(link.getAttribute('data-whatsapp-send-alert')).toBe('blocked');
    expect(link.textContent).toContain('Ver o que fazer');
    expect(link.textContent?.toLowerCase()).not.toContain('multa');
  });

  it('vem antes das outras pendências', async () => {
    getCurrentUser.mockResolvedValue(
      currentUser(['manage:settings', 'view:financial', 'view:conversations']),
    );
    getDashboard.mockResolvedValue(dashboard);
    countOpenHandoffs.mockResolvedValue({ abertos: 1, vencidos: 0 });
    getCashFlowToday.mockResolvedValue({
      receber: 0,
      pagar: 0,
      recebidoHoje: 0,
      pagoHoje: 0,
      saldoHoje: 0,
    });
    listCashFlowDaily.mockResolvedValue([]);

    const { container } = render(await DashboardPage());
    const content = container.textContent ?? '';
    expect(content.indexOf('A Meta bloqueou')).toBeLessThan(
      content.indexOf('ainda não foram faturados'),
    );
    expect(content.indexOf('A Meta bloqueou')).toBeLessThan(
      content.indexOf('aguardando atendimento humano'),
    );
  });

  it('conta limitada: faixa âmbar', async () => {
    getWhatsappSendAlert.mockResolvedValue({
      account: {
        state: 'limited',
        headline: 'A Meta está limitando as mensagens automáticas do WhatsApp',
      },
      refusals: null,
    });

    render(await DashboardPage());

    const link = screen.getByRole('link', { name: /A Meta está limitando/u });
    expect(link.getAttribute('data-whatsapp-send-alert')).toBe('limited');
  });

  it('a mesma faixa leva as recusas por mensagem, com ou sem pendência da conta', async () => {
    getWhatsappSendAlert.mockResolvedValue({
      account: null,
      refusals: { count: 2, since: 'nas últimas 24 h' },
    });
    const { unmount } = render(await DashboardPage());
    expect(
      screen.getByRole('link', {
        name: /2 mensagens automáticas recusadas pela Meta nas últimas 24 h/u,
      }),
    ).toBeTruthy();
    unmount();

    getWhatsappSendAlert.mockResolvedValue({ ...blocked, refusals: { count: 1, since: '' } });
    render(await DashboardPage());
    const links = screen.getAllByRole('link', { name: /recusada pela Meta/u });
    expect(links).toHaveLength(1);
    expect(links[0]!.textContent).toContain('A Meta bloqueou');
  });

  it('nada pendente: nenhuma faixa', async () => {
    getWhatsappSendAlert.mockResolvedValue({ account: null, refusals: { count: 0, since: '' } });

    const { container } = render(await DashboardPage());
    expect(container.querySelector('[data-whatsapp-send-alert]')).toBeNull();
  });

  it('sem manage:settings o estado da conta nem é lido', async () => {
    getCurrentUser.mockResolvedValue(currentUser(['view:conversations']));

    const { container } = render(await DashboardPage());
    expect(getWhatsappSendAlert).not.toHaveBeenCalled();
    expect(container.querySelector('[data-whatsapp-send-alert]')).toBeNull();
  });

  it('a prévia ilustrativa não lê o estado real da integração', async () => {
    demoEnv.DASHBOARD_DEMO_USER_ID = 'demo-user';
    demoEnv.DASHBOARD_DEMO_CLINIC_ID = clinicId;
    getCurrentUser.mockResolvedValue({ ...currentUser(['manage:settings']), userId: 'demo-user' });

    render(await DashboardPage());
    expect(getWhatsappSendAlert).not.toHaveBeenCalled();
  });
});
