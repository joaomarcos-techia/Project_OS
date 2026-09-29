// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({
  requestPlanChangeAction: vi.fn(async () => ({ error: null })),
  requestSubscriptionCancellationAction: vi.fn(async () => ({ error: null })),
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
