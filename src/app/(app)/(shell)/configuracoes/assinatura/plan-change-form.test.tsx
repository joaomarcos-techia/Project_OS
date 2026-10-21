// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({
  requestPlanChangeAction: vi.fn(async () => ({ error: null })),
  requestSubscriptionCancellationAction: vi.fn(async () => ({
    error: null,
    success: 'cancellation_scheduled',
    message: 'Assinatura cancelada.',
  })),
  revokeSubscriptionCancellationAction: vi.fn(async () => ({ error: null })),
  reactivateSubscriptionAction: vi.fn(async () => ({ error: null })),
}));

import { PlanChangeForm } from './plan-change-form';

afterEach(cleanup);

type Status = 'trial' | 'active' | 'past_due' | 'cancelled';

function renderForm(
  billingStatus: Status,
  over: {
    periodEnd?: string | null;
    trialEndsAt?: string | null;
    pending?: {
      kind: string;
      status: string;
      effectiveAt: string;
      paymentUrl: string | null;
    } | null;
  } = {},
) {
  return render(
    <PlanChangeForm
      current={{
        planId: 'plan_solo',
        planName: 'Solo',
        planCode: 'solo',
        priceAmount: '149.00',
        billingCycle: 'monthly',
        billingStatus,
        periodEnd: over.periodEnd ?? null,
        trialEndsAt: over.trialEndsAt ?? null,
      }}
      plans={[]}
      activeUsers={1}
      pending={over.pending ?? null}
    />,
  );
}

describe('cancelar assinatura na tela', () => {
  it.each(['trial', 'active', 'past_due'] as const)(
    'o botão existe em %s — cancelar tem de ser sempre possível',
    (status) => {
      renderForm(status);
      expect(screen.getByRole('button', { name: 'Cancelar assinatura' })).toBeTruthy();
    },
  );

  it('em teste, a tela não afirma mais que "não há assinatura para cancelar"', () => {
    renderForm('trial', { trialEndsAt: '2026-10-02T00:00:00.000Z' });
    // Era falso: o Asaas já tinha a primeira cobrança marcada para o fim do teste.
    expect(screen.queryByText(/não há assinatura ativa para cancelar/u)).toBeNull();
  });

  it('a confirmação diz o que acontece com as cobranças e até quando vai o acesso', async () => {
    renderForm('trial', { trialEndsAt: '2026-10-02T00:00:00.000Z' });

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar assinatura' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('todas as cobranças em aberto no Asaas são apagadas');
    expect(dialog.textContent).toContain('O acesso continua até 02/10/2026');
  });

  it('fecha o diálogo e mostra a confirmação quando o cancelamento termina', async () => {
    renderForm('active', { periodEnd: '2026-10-02T00:00:00.000Z' });

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar assinatura' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar assinatura' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('alert').textContent).toContain('Assinatura cancelada');
  });

  it('inadimplente: a confirmação avisa que as vencidas também são apagadas', async () => {
    renderForm('past_due');

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar assinatura' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Isso inclui as cobranças vencidas');
  });

  it('cancelada: oferece reativar, não cancelar de novo', () => {
    renderForm('cancelled');
    expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reativar assinatura' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Assinatura cancelada');
    expect(screen.getByRole('alert').textContent).toContain('não gera novas cobranças');
  });

  it('cancelamento agendado: oferece manter, e diz que não haverá nova cobrança', () => {
    renderForm('active', {
      pending: {
        kind: 'cancellation',
        status: 'scheduled',
        effectiveAt: '2026-10-10T00:00:00.000Z',
        paymentUrl: null,
      },
    });
    expect(screen.getByRole('button', { name: 'Manter assinatura' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Assinatura cancelada');
    expect(
      screen.getByText(/nenhuma nova cobrança será feita. O acesso segue até 10\/10\/2026/u),
    ).toBeTruthy();
  });
});

describe('datas de ciclo', () => {
  it('mostram o dia do vencimento, não o dia anterior no fuso do Brasil', () => {
    // Meia-noite UTC de 10/10 é 21h de 09/10 em Brasília. Formatado no fuso
    // local, o ciclo "encerrava" um dia antes do vencimento real.
    renderForm('active', { periodEnd: '2026-10-10T00:00:00.000Z' });
    expect(screen.getByText(/ciclo encerra em 10\/10\/2026/u)).toBeTruthy();
  });
});

describe('capacidade mostrada na troca de plano', () => {
  const current = {
    planId: 'plan_pro',
    planName: 'Pro',
    planCode: 'pro',
    priceAmount: '699.00',
    billingCycle: 'monthly' as const,
    billingStatus: 'active' as const,
    periodEnd: '2026-11-01T00:00:00.000Z',
    trialEndsAt: null,
  };
  // Direção e encaixe chegam do servidor (getPlanChangeOverview), com a mesma
  // regra que a troca aplica; a tela só os mostra.
  const plansFor = (teamFits: boolean) => [
    {
      id: 'plan_clinica',
      name: 'Clínica',
      code: 'clinica',
      priceAmount: '397.00',
      limits: { users: 5, agendamentos: 800, ai_messages: 800 },
      seats: null,
      direction: -1 as const,
      teamFits,
    },
  ];

  it('permite agendar Pro → Clínica com três usuários dentro da cota de cinco', () => {
    render(
      <PlanChangeForm current={current} plans={plansFor(true)} activeUsers={3} pending={null} />,
    );

    expect(screen.getByRole('button', { name: 'Agendar downgrade' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('informa o limite e bloqueia a troca com seis usuários', () => {
    render(
      <PlanChangeForm current={current} plans={plansFor(false)} activeUsers={6} pending={null} />,
    );

    expect(
      screen.getByRole('button', { name: 'Limite de 5 usuários' }).hasAttribute('disabled'),
    ).toBe(true);
  });
});

describe('oferta por profissional (ADR-067)', () => {
  const offerPlan = (
    id: string,
    professionals: number,
    priceAmount: string,
    direction: -1 | 0 | 1,
    teamFits = true,
  ) => ({
    id,
    name: professionals === 1 ? 'Consultório' : `Clínica · ${professionals} profissionais`,
    code: professionals === 1 ? 'consultorio_2026' : `clinica_2026_${professionals}`,
    priceAmount,
    limits: { users: 0, agendamentos: 0, ai_messages: 0 },
    seats: { professionals, staff: professionals === 1 ? 3 : null },
    direction,
    teamFits,
  });
  const current = {
    planId: 'plan_c3',
    planName: 'Clínica · 3 profissionais',
    planCode: 'clinica_2026_3',
    priceAmount: '544.00',
    billingCycle: 'monthly' as const,
    billingStatus: 'active' as const,
    periodEnd: '2026-11-01T00:00:00.000Z',
    trialEndsAt: null,
  };
  const plans = [
    offerPlan('plan_cons', 1, '197.00', -1, false),
    offerPlan('plan_c2', 2, '397.00', -1, false),
    offerPlan('plan_c3', 3, '544.00', 0),
    offerPlan('plan_c4', 4, '691.00', 1),
  ];

  function renderOffer() {
    return render(
      <PlanChangeForm
        current={current}
        plans={plans}
        activeUsers={5}
        seatUsage={{ users: 5, professionals: 3, staff: 2 }}
        pending={null}
      />,
    );
  }

  it('mostra o uso por categoria em vez do total de usuários', () => {
    renderOffer();
    expect(screen.getByText('3 de 3 profissionais')).toBeTruthy();
    expect(screen.getByText('2 de equipe · sem limite')).toBeTruthy();
    expect(screen.queryByText(/usuários ativos/u)).toBeNull();
  });

  it('o seletor da Clínica começa no plano atual e lista o preço de cada quantidade', () => {
    renderOffer();
    const selector = screen.getByLabelText('Profissionais de saúde') as HTMLSelectElement;
    expect(selector.value).toBe('plan_c3');
    // `Intl` separa "R$" do valor com espaço inseparável.
    expect(
      Array.from(selector.options).map((option) => option.text.replace(/\u00a0/gu, ' ')),
    ).toEqual([
      '2 profissionais — R$ 397,00/mês',
      '3 profissionais — R$ 544,00/mês (atual)',
      '4 profissionais — R$ 691,00/mês',
    ]);
    expect(screen.getByRole('button', { name: 'Plano atual' }).hasAttribute('disabled')).toBe(true);
  });

  it('incluir profissional envia o plano da nova quantidade', () => {
    renderOffer();
    fireEvent.change(screen.getByLabelText('Profissionais de saúde'), {
      target: { value: 'plan_c4' },
    });
    const button = screen.getByRole('button', { name: 'Contratar agora' });
    expect(button.hasAttribute('disabled')).toBe(false);
    const form = button.closest('form');
    expect(form?.querySelector<HTMLInputElement>('input[name="targetPlanId"]')?.value).toBe(
      'plan_c4',
    );
  });

  it('reduzir abaixo da equipe ativa fica bloqueado, com o motivo no botão', () => {
    renderOffer();
    fireEvent.change(screen.getByLabelText('Profissionais de saúde'), {
      target: { value: 'plan_c2' },
    });
    expect(
      screen
        .getAllByRole('button', { name: 'A equipe ativa não cabe neste plano' })
        .every((button) => button.hasAttribute('disabled')),
    ).toBe(true);
  });
});
