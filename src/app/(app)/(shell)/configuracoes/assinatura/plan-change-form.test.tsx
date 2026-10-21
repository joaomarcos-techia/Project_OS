// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestPlanChangeAction } from './actions';

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
      activeDoctors={0}
      activeStaff={0}
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

it('mostra imediatamente o link da cobrança proporcional devolvido pelo servidor', async () => {
  vi.mocked(requestPlanChangeAction).mockResolvedValueOnce({
    error: null,
    success: 'upgrade_pending_payment',
    message: 'Cobrança proporcional de R$ 73,50 criada.',
    paymentUrl: 'https://sandbox.asaas.com/test-checkout',
  });
  render(
    <PlanChangeForm
      current={{
        planId: 'plan_two',
        planName: 'Clínica · 2 médicos',
        planCode: 'clinica_2026_2',
        priceAmount: '397.00',
        billingCycle: 'monthly',
        billingStatus: 'active',
        periodEnd: '2026-11-01T00:00:00.000Z',
        trialEndsAt: null,
      }}
      plans={[
        {
          id: 'plan_three',
          name: 'Clínica · 3 médicos',
          code: 'clinica_2026_3',
          priceAmount: '544.00',
          limits: { users: 6, agendamentos: 0, ai_messages: 0 },
          seats: { doctors: 3, staff: 3 },
        },
      ]}
      activeUsers={2}
      activeDoctors={2}
      activeStaff={0}
      pending={null}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Contratar +1 médico' }));
  const link = await screen.findByRole('link', { name: 'Abrir cobrança proporcional no Asaas' });
  expect(link.getAttribute('href')).toBe('https://sandbox.asaas.com/test-checkout');
  expect(screen.getByText(/R\$ 73,50 criada/u)).toBeTruthy();
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
  const plans = [
    {
      id: 'plan_clinica',
      name: 'Clínica',
      code: 'clinica',
      priceAmount: '397.00',
      limits: { users: 5, agendamentos: 800, ai_messages: 800 },
      seats: null,
    },
  ];

  it('permite agendar Pro → Clínica com três usuários dentro da cota de cinco', () => {
    render(
      <PlanChangeForm
        current={current}
        plans={plans}
        activeUsers={3}
        activeDoctors={0}
        activeStaff={0}
        pending={null}
      />,
    );

    expect(screen.getByRole('button', { name: 'Agendar downgrade' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('informa o limite e bloqueia a troca com seis usuários', () => {
    render(
      <PlanChangeForm
        current={current}
        plans={plans}
        activeUsers={6}
        activeDoctors={0}
        activeStaff={0}
        pending={null}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Limite de 5 usuários' }).hasAttribute('disabled'),
    ).toBe(true);
  });
});

describe('contratação de médico na oferta 2026', () => {
  const current = {
    planId: 'plan_clinica_2',
    planName: 'Clínica · 2 médicos',
    planCode: 'clinica_2026_2',
    priceAmount: '397.00',
    billingCycle: 'monthly' as const,
    billingStatus: 'active' as const,
    periodEnd: '2026-11-01T00:00:00.000Z',
    trialEndsAt: null,
  };
  const plans = [
    {
      id: 'plan_solo',
      name: 'Solo',
      code: 'solo',
      priceAmount: '149.00',
      limits: { users: 1, agendamentos: 100, ai_messages: 100 },
      seats: null,
    },
    {
      id: 'plan_consultorio',
      name: 'Consultório',
      code: 'consultorio_2026',
      priceAmount: '197.00',
      limits: { users: 4, agendamentos: 800, ai_messages: 800 },
      seats: { doctors: 1, staff: 3 },
    },
    {
      id: 'plan_clinica_3',
      name: 'Clínica · 3 médicos',
      code: 'clinica_2026_3',
      priceAmount: '544.00',
      limits: { users: 6, agendamentos: 800, ai_messages: 800 },
      seats: { doctors: 3, staff: 3 },
    },
    {
      id: 'plan_clinica_2',
      name: 'Clínica · 2 médicos',
      code: 'clinica_2026_2',
      priceAmount: '397.00',
      limits: { users: 5, agendamentos: 800, ai_messages: 800 },
      seats: { doctors: 2, staff: 3 },
    },
  ];

  it('mostra apenas a tabela contratada e identifica upgrade e downgrade', () => {
    render(
      <PlanChangeForm
        current={current}
        plans={plans}
        activeUsers={4}
        activeDoctors={2}
        activeStaff={2}
        pending={null}
      />,
    );

    expect(screen.queryByText('Solo')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Contratar +1 médico' }).hasAttribute('disabled'),
    ).toBe(false);
    expect(
      screen
        .getByRole('button', { name: 'Cota de médicos ou equipe excedida' })
        .hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByText('2 médicos · 2 de equipe')).toBeTruthy();
    expect(screen.getByText(/vaga só é liberada após a confirmação do pagamento/u)).toBeTruthy();
    expect(screen.queryByText(/agendamentos\/mês monitorados/u)).toBeNull();
    expect(screen.queryByText(/mensagens IA\/mês monitoradas/u)).toBeNull();
  });

  it('permite downgrade quando médicos e equipe cabem no destino', () => {
    render(
      <PlanChangeForm
        current={{ ...current, planId: 'plan_clinica_3', planCode: 'clinica_2026_3' }}
        plans={plans}
        activeUsers={4}
        activeDoctors={1}
        activeStaff={3}
        pending={null}
      />,
    );

    const buttons = screen.getAllByRole('button', { name: 'Agendar downgrade' });
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => !button.hasAttribute('disabled'))).toBe(true);
  });
});
