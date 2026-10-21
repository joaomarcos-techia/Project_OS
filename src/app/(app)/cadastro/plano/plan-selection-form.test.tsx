// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SignupPlanState } from '@/contexts/onboarding';

import { PlanSelectionForm } from './plan-selection-form';

const fetchMock = vi.fn<typeof fetch>();
const assignMock = vi.fn<(url: string | URL) => void>();
const CONSULTORIO_ID = '22222222-2222-4222-8222-222222222222';
const CLINICA_2_ID = '33333333-3333-4333-8333-333333333333';
const CLINICA_3_ID = '44444444-4444-4444-8444-444444444444';
/** Valores do servidor (ADR-067). A tela não calcula preço, só mostra. */
const STATE: SignupPlanState = {
  status: 'email_verified',
  rowVersion: 7,
  clinicName: 'Clínica Sintética',
  selectedPlanId: null,
  plans: [
    {
      id: CONSULTORIO_ID,
      code: 'consultorio_2026',
      name: 'Consultório',
      priceCents: 19700,
      cycle: 'monthly',
      professionals: 1,
      staffLimit: 3,
    },
    {
      id: CLINICA_3_ID,
      code: 'clinica_2026_3',
      name: 'Clínica · 3 profissionais',
      priceCents: 54400,
      cycle: 'monthly',
      professionals: 3,
      staffLimit: null,
    },
    {
      id: CLINICA_2_ID,
      code: 'clinica_2026_2',
      name: 'Clínica · 2 profissionais',
      priceCents: 39700,
      cycle: 'monthly',
      professionals: 2,
      staffLimit: null,
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
  assignMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(window.location, 'assign').mockImplementation(assignMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('seleção de plano O-4', () => {
  it('mostra Consultório e Clínica com preços e trial resolvidos pelo servidor', async () => {
    fetchMock.mockResolvedValueOnce(json(200, STATE));
    render(<PlanSelectionForm />);

    expect(await screen.findByText('Clínica Sintética')).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    const consultorio = screen.getByRole('radio', { name: /Consultório/u });
    const clinica = screen.getByRole('radio', { name: /^Clínica/u });
    expect(consultorio.closest('label')?.textContent).toMatch(/R\$.*197,00/u);
    expect(consultorio.closest('label')?.textContent).toMatch(
      /1 profissional de saúde e até 3 usuários de equipe/u,
    );
    expect(clinica.closest('label')?.textContent).toMatch(/a partir de.*R\$.*397,00/u);
    // O adicional é a diferença do próprio catálogo (544 − 397), não constante da tela.
    expect(clinica.closest('label')?.textContent).toMatch(
      /2 a 3 profissionais de saúde e equipe administrativa ilimitada, R\$.*147,00 por profissional adicional/u,
    );
    expect(screen.getAllByText(/7 dias grátis após a ativação/u)).toHaveLength(2);
    expect(screen.getByRole('radiogroup', { name: 'Planos disponíveis' }).className).toContain(
      'md:grid-cols-2',
    );
    // O seletor só aparece com a Clínica escolhida.
    expect(screen.queryByLabelText('Profissionais de saúde')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/signup/plan', { cache: 'no-store' });
  });

  it('na Clínica, o seletor escolhe o plano da quantidade e mostra o total do servidor', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, STATE))
      .mockResolvedValueOnce(json(200, { rowVersion: 8, selectedPlanId: CLINICA_3_ID }));
    render(<PlanSelectionForm />);

    fireEvent.click(await screen.findByRole('radio', { name: /^Clínica/u }));
    const selector = screen.getByLabelText('Profissionais de saúde');
    expect(selector).toHaveProperty('value', CLINICA_2_ID);
    expect(
      Array.from((selector as HTMLSelectElement).options).map((option) => option.text),
    ).toEqual(['2 profissionais', '3 profissionais']);
    expect(
      screen.getByText(/R\$.*397,00/u, { selector: 'span.tabular-nums.text-lg' }),
    ).toBeTruthy();

    fireEvent.change(selector, { target: { value: CLINICA_3_ID } });
    expect(
      screen.getByText(/R\$.*544,00/u, { selector: 'span.tabular-nums.text-lg' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar plano' }));

    await screen.findByText('Plano salvo');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      rowVersion: 7,
      planId: CLINICA_3_ID,
    });
  });

  it('salva somente planId e rowVersion, e só então oferece a ativação', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, STATE))
      .mockResolvedValueOnce(json(200, { rowVersion: 8, selectedPlanId: CLINICA_2_ID }));
    render(<PlanSelectionForm />);

    fireEvent.click(await screen.findByRole('radio', { name: /^Clínica/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar plano' }));

    await screen.findByText('Plano salvo');
    // O texto mudou quando O-5 passou a existir: salvar o plano deixou de ser o
    // fim do funil e virou o passo anterior à ativação. O que segue valendo, e
    // é o ponto do caso, é que salvar NÃO cobra nada.
    expect(screen.getByRole('alert').textContent).toMatch(/7 dias grátis após a ativação/u);
    expect(screen.getByRole('alert').textContent).toMatch(
      /pagamento acontece com segurança na página do Asaas/u,
    );
    // A ativação é um segundo ato explícito, nunca efeito colateral do salvar.
    expect(screen.getByRole('button', { name: 'Continuar no Checkout Asaas' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some((call) => call[0] === '/api/signup/checkout')).toBe(false);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/signup/plan');
    expect(fetchMock.mock.calls[1]?.[1]).toEqual({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rowVersion: 7, planId: CLINICA_2_ID }),
    });
  });

  it('restaura escolha salva e usa a nova versão em alterações posteriores', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { ...STATE, rowVersion: 8, selectedPlanId: CONSULTORIO_ID }))
      .mockResolvedValueOnce(json(200, { rowVersion: 9, selectedPlanId: CLINICA_2_ID }));
    render(<PlanSelectionForm />);

    const consultorio = await screen.findByRole('radio', { name: /Consultório/u });
    expect(consultorio).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('radio', { name: /^Clínica/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar plano' }));

    await screen.findByText('Plano salvo');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      rowVersion: 8,
      planId: CLINICA_2_ID,
    });
  });

  it('recarrega o estado após conflito sem manter a escolha vencida', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, STATE))
      .mockResolvedValueOnce(json(409, { error: 'conflict' }))
      .mockResolvedValueOnce(
        json(200, { ...STATE, rowVersion: 8, selectedPlanId: CONSULTORIO_ID }),
      );
    render(<PlanSelectionForm />);

    fireEvent.click(await screen.findByRole('radio', { name: /^Clínica/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar plano' }));

    await screen.findByText('O cadastro foi atualizado em outra aba. Revise a escolha carregada.');
    expect(screen.getByRole('radio', { name: /Consultório/u })).toHaveProperty('checked', true);
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

  it('abre a URL hospedada do Asaas e não entra direto no dashboard', async () => {
    const checkoutUrl = 'https://sandbox.asaas.com/checkoutSession/show?id=checkout_1';
    fetchMock
      .mockResolvedValueOnce(json(200, STATE))
      .mockResolvedValueOnce(json(200, { rowVersion: 8, selectedPlanId: CLINICA_2_ID }))
      .mockResolvedValueOnce(json(200, { state: 'checkout_pending', checkoutUrl }));
    render(<PlanSelectionForm />);

    fireEvent.click(await screen.findByRole('radio', { name: /^Clínica/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar plano' }));
    await screen.findByText('Plano salvo');
    expect(screen.queryByRole('textbox', { name: /CPF ou CNPJ/u })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar no Checkout Asaas' }));

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith(checkoutUrl));
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(JSON.stringify({}));
    expect(assignMock).not.toHaveBeenCalledWith('/auth/session-refresh?next=/dashboard');
  });

  it('volta à escolha quando o Checkout recusa um plano que deixou de ser vendido', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, STATE))
      .mockResolvedValueOnce(json(200, { rowVersion: 8, selectedPlanId: CLINICA_2_ID }))
      .mockResolvedValueOnce(json(409, { error: 'invalid_plan' }))
      .mockResolvedValueOnce(json(200, { ...STATE, rowVersion: 8, selectedPlanId: null }));
    render(<PlanSelectionForm />);

    fireEvent.click(await screen.findByRole('radio', { name: /^Clínica/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar plano' }));
    await screen.findByText('Plano salvo');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar no Checkout Asaas' }));

    await screen.findByText('Esse plano não está mais disponível. Escolha uma opção atualizada.');
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/signup/plan');
    expect(screen.getByRole('radio', { name: /^Clínica/u })).toHaveProperty('checked', false);
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('recusa URL de Checkout fora dos hosts oficiais', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, STATE))
      .mockResolvedValueOnce(json(200, { rowVersion: 8, selectedPlanId: CLINICA_2_ID }))
      .mockResolvedValueOnce(
        json(200, { state: 'checkout_pending', checkoutUrl: 'https://evil.test/coletar-cartao' }),
      );
    render(<PlanSelectionForm />);

    fireEvent.click(await screen.findByRole('radio', { name: /^Clínica/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar plano' }));
    await screen.findByText('Plano salvo');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar no Checkout Asaas' }));

    await screen.findByText(/poss.vel concluir agora/u);
    expect(assignMock).not.toHaveBeenCalled();
  });
});
