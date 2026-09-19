// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SignupPlanState } from '@/contexts/onboarding';

import { PlanSelectionForm } from './plan-selection-form';

const fetchMock = vi.fn<typeof fetch>();
const ESSENTIAL_ID = '22222222-2222-4222-8222-222222222222';
const COMPLETE_ID = '33333333-3333-4333-8333-333333333333';
const STATE: SignupPlanState = {
  status: 'email_verified',
  rowVersion: 7,
  clinicName: 'Clínica Sintética',
  selectedPlanId: null,
  plans: [
    {
      id: ESSENTIAL_ID,
      code: 'essencial',
      name: 'Essencial',
      priceCents: 14900,
      cycle: 'monthly',
    },
    {
      id: COMPLETE_ID,
      code: 'completo',
      name: 'Completo',
      priceCents: 24990,
      cycle: 'monthly',
    },
  ],
  trialDays: 7,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('seleção de plano O-4', () => {
  it('mostra clínica, preço mensal de tabela e trial resolvidos pelo servidor', async () => {
    fetchMock.mockResolvedValueOnce(json(200, STATE));
    render(<PlanSelectionForm />);

    expect(await screen.findByText('Clínica Sintética')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Essencial/u })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Completo/u })).toBeTruthy();
    expect(screen.getByText(/R\$.*149,00 por mês · 7 dias grátis/u)).toBeTruthy();
    expect(screen.getByText(/R\$.*249,90 por mês · 7 dias grátis/u)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/signup/plan', { cache: 'no-store' });
  });

  it('salva somente planId e rowVersion, e só então oferece a ativação', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, STATE))
      .mockResolvedValueOnce(json(200, { rowVersion: 8, selectedPlanId: COMPLETE_ID }));
    render(<PlanSelectionForm />);

    fireEvent.click(await screen.findByRole('radio', { name: /Completo/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar plano' }));

    await screen.findByText('Plano salvo');
    // O texto mudou quando O-5 passou a existir: salvar o plano deixou de ser o
    // fim do funil e virou o passo anterior à ativação. O que segue valendo, e
    // é o ponto do caso, é que salvar NÃO cobra nada.
    expect(screen.getByText(/dias grátis começam quando a clínica for ativada/u)).toBeTruthy();
    expect(screen.getByText(/nós não pedimos cartão aqui/u)).toBeTruthy();
    // A ativação é um segundo ato explícito, nunca efeito colateral do salvar.
    expect(screen.getByRole('button', { name: 'Ativar clínica e entrar' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some((call) => call[0] === '/api/signup/checkout')).toBe(false);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/signup/plan');
    expect(fetchMock.mock.calls[1]?.[1]).toEqual({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rowVersion: 7, planId: COMPLETE_ID }),
    });
  });

  it('restaura escolha salva e usa a nova versão em alterações posteriores', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { ...STATE, rowVersion: 8, selectedPlanId: ESSENTIAL_ID }))
      .mockResolvedValueOnce(json(200, { rowVersion: 9, selectedPlanId: COMPLETE_ID }));
    render(<PlanSelectionForm />);

    const essential = await screen.findByRole('radio', { name: /Essencial/u });
    expect(essential).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('radio', { name: /Completo/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar plano' }));

    await screen.findByText('Plano salvo');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      rowVersion: 8,
      planId: COMPLETE_ID,
    });
  });

  it('recarrega o estado após conflito sem manter a escolha vencida', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, STATE))
      .mockResolvedValueOnce(json(409, { error: 'conflict' }))
      .mockResolvedValueOnce(json(200, { ...STATE, rowVersion: 8, selectedPlanId: ESSENTIAL_ID }));
    render(<PlanSelectionForm />);

    fireEvent.click(await screen.findByRole('radio', { name: /Completo/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar plano' }));

    await screen.findByText('O cadastro foi atualizado em outra aba. Revise a escolha carregada.');
    expect(screen.getByRole('radio', { name: /Essencial/u })).toHaveProperty('checked', true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('mostra catálogo vazio e permite atualizar sem submeter', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ...STATE, plans: [] }));
    render(<PlanSelectionForm />);

    expect(await screen.findByText('Planos indisponíveis')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Salvar plano' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Atualizar planos' })).toBeTruthy();
  });

  it('categoriza sessão encerrada e draft expirado', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: 'unauthorized' }));
    const { unmount } = render(<PlanSelectionForm />);
    expect(await screen.findByText('Sessão encerrada')).toBeTruthy();
    unmount();

    fetchMock.mockResolvedValueOnce(json(410, { error: 'gone' }));
    render(<PlanSelectionForm />);
    expect(await screen.findByText('Cadastro temporário expirado')).toBeTruthy();
  });

  it('bloqueia envio sem escolha', async () => {
    fetchMock.mockResolvedValueOnce(json(200, STATE));
    render(<PlanSelectionForm />);

    await screen.findByText('Clínica Sintética');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar plano' }));
    await waitFor(() => {
      expect(screen.getByText('Selecione um plano para continuar.')).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
