// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '@/lib/env';

const {
  AuthError,
  captureBackgroundError,
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
  unstableRethrow,
} = vi.hoisted(() => ({
  AuthError: class AuthError extends Error {},
  captureBackgroundError: vi.fn(),
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
  unstableRethrow: vi.fn(),
}));

// `useRouter` entra no mock por causa do botao "Atualizar", que e client e
// chama router.refresh(). Sem ele o modulo mockado nao exporta o hook e o
// render inteiro quebra.
vi.mock('next/navigation', () => ({
  redirect,
  unstable_rethrow: unstableRethrow,
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/contexts/ai-agent/queries', () => ({ countOpenHandoffs }));
vi.mock('@/lib/auth/tenant-context', () => ({ AuthError, getCurrentUser }));
vi.mock('@/lib/observability/capture', () => ({ captureBackgroundError }));
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
      contagens: { receber: 0, receberVencidos: 0, pagar: 0, recebimentos: 0, pagamentos: 0 },
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
    expect(content.indexOf('Primeiros passos')).toBeLessThan(content.indexOf('Consultas hoje'));
    expect(screen.getByRole('region', { name: 'Sala de espera e atendimento' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Operação do turno' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Resumo financeiro' })).toBeTruthy();
  });

  // UX-011 — o leitor de tela precisa ouvir onde está; a saudação é complemento.
  it('o h1 é o nome da tela e a saudação segue visível com o nome completo', async () => {
    render(await DashboardPage());

    const titulos = screen.getAllByRole('heading', { level: 1 });
    expect(titulos).toHaveLength(1);
    expect(titulos[0]!.textContent).toBe('Dashboard');
    const saudacao = screen.getByText(/^(?:Bom dia|Boa tarde|Boa noite), Dr\. Matheus Silva$/u);
    expect(saudacao.tagName).toBe('P');
  });

  it('sem clínica, o h1 continua sendo o nome da tela', async () => {
    getCurrentUser.mockResolvedValue({ ...currentUser([]), clinicId: null });

    render(await DashboardPage());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Dashboard');
    expect(screen.getByText('Selecione uma clínica para ver o painel operacional.')).toBeTruthy();
  });

  // UX-011 — a ordem do DOM é a ordem de leitura em qualquer largura: o CSS não
  // reordena mais os blocos no celular.
  it('pendências vêm antes da ativação, dos indicadores, da agenda e do financeiro', async () => {
    getCurrentUser.mockResolvedValue(
      currentUser(['view:financial', 'view:audit', 'view:conversations']),
    );
    countOpenHandoffs.mockResolvedValue({ abertos: 2, vencidos: 1 });

    const { container } = render(await DashboardPage());

    const ordem = [
      screen.getByRole('region', { name: 'Precisa de você' }),
      screen.getByRole('region', { name: 'Sala de espera e atendimento' }),
      screen.getByRole('region', { name: 'Próximos na agenda' }),
      screen.getByRole('region', { name: 'Operação do turno' }),
      screen.getByRole('region', { name: 'Resumo financeiro' }),
      screen.getByRole('region', { name: 'Faturamento recebido' }),
      screen.getByRole('region', { name: 'Atividade recente' }),
    ];
    for (let i = 1; i < ordem.length; i++) {
      expect(
        ordem[i - 1]!.compareDocumentPosition(ordem[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    const texto = container.textContent ?? '';
    expect(texto.indexOf('Precisa de você')).toBeLessThan(texto.indexOf('Primeiros passos'));
    expect(texto.indexOf('Primeiros passos')).toBeLessThan(texto.indexOf('Aguardando'));
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
    // No cartão do dia: o mesmo valor também está na lista "Ver valores por dia".
    expect(
      within(screen.getByRole('region', { name: 'Resumo financeiro' })).getByText('R$ 1.820,00'),
    ).toBeTruthy();
    expect(screen.queryByText('Primeiros passos')).toBeNull();
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
      // 01:00 UTC de sexta ainda é 22:00 de quinta em São Paulo: a data e a hora
      // do subtítulo saem do fuso da clínica, não do servidor.
      expect(screen.getByText('Quinta-feira, 3 de setembro · atualizado às 22:00')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('mostra os horários no fuso da clínica', async () => {
    render(await DashboardPage());

    // 13:30 UTC é 10:30 em São Paulo, no indicador e na lista.
    expect(screen.getAllByText('10:30')).toHaveLength(2);
    expect(screen.queryByText('13:30')).toBeNull();
  });

  it('a próxima consulta pula quem já está na sala de espera', async () => {
    getDashboard.mockResolvedValue({
      ...dashboard,
      proximos: [
        { ...dashboard.proximos[0], appointmentId: 'a', nome: 'Ana Lima', status: 'chegou' },
        { ...dashboard.proximos[0], appointmentId: 'b', nome: 'Bia Reis', status: 'agendado' },
      ],
    });

    render(await DashboardPage());

    expect(screen.getByText('A seguir: Ana Lima')).toBeTruthy();
    expect(screen.getByText('Bia Reis · Consulta cardiologia')).toBeTruthy();
  });

  it('o selo mostra o tempo de espera sem comparar com um limite', async () => {
    render(await DashboardPage());

    expect(screen.getByText('24 min de espera')).toBeTruthy();
    expect(screen.queryByText('Acima do previsto')).toBeNull();
  });

  it.each([
    [1, 'Menos de 1 min'],
    [0, 'Sem espera'],
  ])('sem minutos completos e %s na fila, o selo não some', async (aguardando, selo) => {
    getDashboard.mockResolvedValue({
      ...dashboard,
      aguardando,
      maiorEsperaMin: null,
      maiorEsperaNome: null,
    });

    render(await DashboardPage());

    expect(screen.getByText(selo)).toBeTruthy();
  });

  it('traduz o evento do audit e guarda o token só no title', async () => {
    getRecentActivity.mockResolvedValue([
      {
        id: 'audit-1',
        action: 'scheduling.appointment.checked_in',
        resourceType: 'appointment',
        resourceId: 'appointment-1',
        userId: 'user-1',
        createdAt: '2026-08-20T11:50:00.000Z',
      },
      {
        id: 'audit-2',
        action: 'messaging.whatsapp.partner_removed',
        resourceType: 'whatsapp',
        resourceId: null,
        userId: 'user-1',
        createdAt: '2026-08-20T11:40:00.000Z',
      },
    ]);

    const { container } = render(await DashboardPage());

    const chegada = screen.getByText(/registrou a chegada do paciente/u);
    expect(chegada.getAttribute('title')).toBe('scheduling.appointment.checked_in');
    expect(screen.getByText(/registrou uma ação no sistema/u)).toBeTruthy();
    expect(container.textContent).not.toContain('checked_in');
    expect(container.textContent).not.toContain('partner_removed');
  });

  it('com consultas no dia e nenhuma pela frente, não diz que a agenda está livre', async () => {
    getDashboard.mockResolvedValue({ ...dashboard, proximos: [] });

    render(await DashboardPage());

    expect(screen.getByText('Sem próximas consultas hoje')).toBeTruthy();
    expect(screen.getByText('Nenhum paciente a chegar ou aguardando.')).toBeTruthy();
    expect(screen.getByText('Nenhuma consulta pela frente hoje')).toBeTruthy();
    expect(screen.queryByText('Agenda livre hoje')).toBeNull();
  });

  it('usa o EmptyState compacto canônico nos três vazios reais', async () => {
    getDashboard.mockResolvedValue({
      ...dashboard,
      consultasHoje: 0,
      aguardando: 0,
      emAtendimento: 0,
      finalizadas: 0,
      faltas: 0,
      proximos: [],
    });
    getCashFlowToday.mockResolvedValue({
      receber: 0,
      pagar: 0,
      recebidoHoje: 0,
      pagoHoje: 0,
      saldoHoje: 0,
      contagens: { receber: 0, receberVencidos: 0, pagar: 0, recebimentos: 0, pagamentos: 0 },
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

  describe('leitura secundária que falha', () => {
    const FAILED = 'Não foi possível carregar este bloco.';
    const regionOf = (name: string) => within(screen.getByRole('region', { name }));

    it('caixa fora do ar avisa no bloco, sem virar R$ 0,00 nem derrubar a página', async () => {
      getCashFlowToday.mockRejectedValue(new Error('db fora do ar'));

      render(await DashboardPage());

      expect(regionOf('Resumo financeiro').getByText(FAILED)).toBeTruthy();
      expect(regionOf('Resumo financeiro').queryByText('R$ 0,00')).toBeNull();
      // O valor de hoje do gráfico vem do caixa: sem ele, nada de barra zerada.
      expect(regionOf('Faturamento recebido').getByText(FAILED)).toBeTruthy();
      expect(screen.queryByText('Sem recebimentos no período')).toBeNull();
      expect(screen.getByText('Maria Silva')).toBeTruthy();
      expect(captureBackgroundError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ flow: 'dashboard.cash_flow', clinicId }),
      );
    });

    it('série fora do ar afeta só o gráfico', async () => {
      listCashFlowDaily.mockRejectedValue(new Error('db fora do ar'));

      render(await DashboardPage());

      expect(regionOf('Faturamento recebido').getByText(FAILED)).toBeTruthy();
      expect(regionOf('Resumo financeiro').queryByText(FAILED)).toBeNull();
    });

    it('fila de handoff fora do ar não some com "Precisa de você"', async () => {
      getCurrentUser.mockResolvedValue(currentUser(['view:conversations']));
      countOpenHandoffs.mockRejectedValue(new Error('db fora do ar'));

      render(await DashboardPage());

      expect(regionOf('Precisa de você').getByText(FAILED)).toBeTruthy();
      // Sem contagem: "0" afirmaria que não há pendência.
      const region = screen.getByRole('region', { name: 'Precisa de você' });
      expect(region.textContent).not.toMatch(/\d/u);
    });

    it('alerta do WhatsApp fora do ar convive com a pendência que carregou', async () => {
      getCurrentUser.mockResolvedValue(currentUser(['manage:settings', 'view:conversations']));
      getWhatsappSendAlert.mockRejectedValue(new Error('db fora do ar'));
      countOpenHandoffs.mockResolvedValue({ abertos: 2, vencidos: 1 });

      render(await DashboardPage());

      const pendencias = regionOf('Precisa de você');
      expect(pendencias.getByText(FAILED)).toBeTruthy();
      expect(pendencias.getByText('2 conversas da IA precisam de alguém da equipe')).toBeTruthy();
      expect(pendencias.getByText('1 com prazo de atendimento vencido')).toBeTruthy();
    });

    it('sem a permissão, a leitura nem acontece e não há bloco de falha', async () => {
      getCurrentUser.mockResolvedValue(currentUser([]));
      countOpenHandoffs.mockRejectedValue(new Error('não deveria ser chamado'));

      render(await DashboardPage());

      expect(countOpenHandoffs).not.toHaveBeenCalled();
      expect(screen.queryByText(FAILED)).toBeNull();
    });

    it('sem os nomes, o feed avisa em vez de atribuir tudo ao "Sistema"', async () => {
      getProfileNames.mockRejectedValue(new Error('db fora do ar'));

      render(await DashboardPage());

      expect(regionOf('Atividade recente').getByText(FAILED)).toBeTruthy();
      expect(screen.queryByText('Sistema')).toBeNull();
    });

    it('checklist fora do ar avisa, mas respeita quem já dispensou', async () => {
      getActivationChecklist.mockRejectedValue(new Error('db fora do ar'));

      const { unmount } = render(await DashboardPage());
      expect(regionOf('Primeiros passos').getByText(FAILED)).toBeTruthy();
      unmount();

      currentOnboardingProgress.mockResolvedValue({
        checklistDismissedAt: '2026-08-20T12:00:00.000Z',
      });
      render(await DashboardPage());
      expect(screen.queryByText('Primeiros passos')).toBeNull();
    });

    it('autenticação e autorização sobem, sem virar falha de bloco', async () => {
      const denied = new AuthError('sessão revogada');
      getCashFlowToday.mockRejectedValue(denied);

      await expect(DashboardPage()).rejects.toBe(denied);
      expect(captureBackgroundError).not.toHaveBeenCalled();
    });

    it('sinal interno do Next passa por unstable_rethrow antes de qualquer registro', async () => {
      const signal = new Error('NEXT_REDIRECT');
      getRecentActivity.mockRejectedValue(signal);
      unstableRethrow.mockImplementationOnce((error: unknown) => {
        throw error;
      });

      await expect(DashboardPage()).rejects.toBe(signal);
      expect(captureBackgroundError).not.toHaveBeenCalled();
    });

    it('a leitura principal continua fatal', async () => {
      const failure = new Error('db fora do ar');
      getDashboard.mockRejectedValue(failure);

      await expect(DashboardPage()).rejects.toBe(failure);
    });
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
      contagens: { receber: 0, receberVencidos: 0, pagar: 0, recebimentos: 0, pagamentos: 0 },
    });
    listCashFlowDaily.mockResolvedValue([]);

    const { container } = render(await DashboardPage());
    const content = container.textContent ?? '';
    expect(content.indexOf('A Meta bloqueou')).toBeLessThan(
      content.indexOf('ainda não foram faturados'),
    );
    expect(content.indexOf('A Meta bloqueou')).toBeLessThan(
      content.indexOf('precisa de alguém da equipe'),
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

  it('só mensagens que não chegaram: a faixa leva à Agenda, onde estão os pacientes', async () => {
    getWhatsappSendAlert.mockResolvedValue({
      account: null,
      refusals: { count: 2, since: 'nas últimas 24 h' },
    });

    render(await DashboardPage());

    const link = screen.getByRole('link', {
      name: /2 mensagens automáticas não chegaram aos pacientes nas últimas 24 h/u,
    });
    expect(link.getAttribute('href')).toBe('/agenda');
    expect(link.getAttribute('data-whatsapp-send-alert')).toBe('refusals');
    expect(link.textContent).toContain('Ver na Agenda');
    // A contagem inclui falhas que não são recusa da Meta.
    expect(link.textContent).not.toMatch(/recusad/u);
  });

  it('pendência da conta e mensagens perdidas: uma faixa só, para a tela de WhatsApp', async () => {
    getWhatsappSendAlert.mockResolvedValue({ ...blocked, refusals: { count: 1, since: '' } });

    const { container } = render(await DashboardPage());

    const strips = container.querySelectorAll('[data-whatsapp-send-alert]');
    expect(strips).toHaveLength(1);
    expect(strips[0]!.getAttribute('href')).toBe('/configuracoes/whatsapp');
    expect(strips[0]!.textContent).toContain('A Meta bloqueou');
    // O aviso da conta já diz que não chegam; a contagem só se soma a ele.
    expect(strips[0]!.textContent).toContain('· 1 não chegou');
    expect(strips[0]!.textContent).toContain('Ver o que fazer');
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
