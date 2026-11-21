// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SignupPlanState } from '@/contexts/onboarding';

import { PlanSelectionForm } from './plan-selection-form';

const fetchMock = vi.fn<typeof fetch>();
const assignMock = vi.fn<(url: string | URL) => void>();
const ESSENTIAL_ID = '22222222-2222-4222-8222-222222222222';
const COMPLETE_ID = '33333333-3333-4333-8333-333333333333';
const CONSULTORIO_2026_ID = '44444444-4444-4444-8444-444444444444';
const STATE: SignupPlanState = {
  status: 'email_verified',
  rowVersion: 7,
  clinicName: 'Clínica Sintética',
  selectedPlanId: null,
  selectedBillingCycle: 'monthly',
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
  offerTrialEndsAt: null,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deferredResponse() {
  let resolve: (response: Response) => void = () => {
    throw new Error('Deferred response was not initialized');
  };
  const promise = new Promise<Response>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
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
  it('uses only the restricted provisioning endpoint for the approved pilot', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(200, {
          ...STATE,
          pilot: true,
          signupFlow: 'trial_first',
          selectedPlanId: CONSULTORIO_2026_ID,
          trialDays: 14,
          offerTrialEndsAt: '2026-11-30T12:00:00.000Z',
          plans: [
            {
              id: CONSULTORIO_2026_ID,
              code: 'consultorio_2026',
              name: 'Consultório',
              priceCents: 19700,
              cycle: 'monthly',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(json(200, { state: 'provisioned' }));
    render(<PlanSelectionForm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Começar avaliação gratuita' }));
    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith('/auth/session-refresh?next=/dashboard'),
    );
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/signup/plan',
      '/api/signup/pilot/provision',
    ]);
    expect(assignMock).toHaveBeenCalledTimes(1);
  });
  it.each([2, 3, 4, 5])(
    'preserva resumo e seleção de %i médicos no redesign sem cobrança inicial',
    async (doctors) => {
      const id = `00000000-0000-4000-8000-00000000000${doctors}`;
      const amount = 39700 + (doctors - 2) * 14700;
      const checkout = deferredResponse();
      fetchMock
        .mockResolvedValueOnce(
          json(200, {
            ...STATE,
            signupFlow: 'trial_first',
            trialDays: 14,
            offerTrialEndsAt: '2026-11-24T12:00:00.000Z',
            plans: [2, 3, 4, 5].map((count) => ({
              id: `00000000-0000-4000-8000-00000000000${count}`,
              code: `clinica_2026_${count}`,
              name: `Clínica ${count}`,
              priceCents: 39700 + (count - 2) * 14700,
              cycle: 'monthly',
            })),
          }),
        )
        .mockResolvedValueOnce(
          json(200, { rowVersion: 8, selectedPlanId: id, selectedBillingCycle: 'monthly' }),
        )
        .mockReturnValueOnce(checkout.promise);
      render(<PlanSelectionForm />);
      fireEvent.click(await screen.findByRole('radio', { name: new RegExp(`Clínica ${doctors}`) }));
      const summary = within(screen.getByRole('complementary'));
      expect(summary.getByRole('heading', { name: `Clínica ${doctors}` })).toBeTruthy();
      expect(summary.getByText('Mensalidade do plano')).toBeTruthy();
      expect(
        summary.getByText(new RegExp(`R\\$\\s*${(amount / 100).toFixed(2).replace('.', ',')}`)),
      ).toBeTruthy();
      const button = screen.getByRole('button', { name: 'Começar avaliação gratuita' });
      fireEvent.click(button);
      fireEvent.click(button);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
        rowVersion: 7,
        planId: id,
        cycle: 'monthly',
      });
      expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({});
      expect(assignMock).not.toHaveBeenCalled();
      checkout.resolve(json(200, { state: 'provisioned' }));
      await waitFor(() =>
        expect(assignMock).toHaveBeenCalledWith('/auth/session-refresh?next=/dashboard'),
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
  );
  it('starts a selected free trial without redirecting to a payment provider', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(200, {
          ...STATE,
          signupFlow: 'trial_first',
          selectedPlanId: CONSULTORIO_2026_ID,
          trialDays: 14,
          offerTrialEndsAt: '2026-11-15T12:00:00.000Z',
          plans: [
            {
              id: CONSULTORIO_2026_ID,
              code: 'consultorio_2026',
              name: 'Consultório',
              priceCents: 19700,
              cycle: 'monthly',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(json(200, { state: 'provisioned' }));
    render(<PlanSelectionForm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Começar avaliação gratuita' }));
    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith('/auth/session-refresh?next=/dashboard'),
    );
    expect(
      screen.getByText(/Nenhum cartão ou pagamento é necessário para iniciar a avaliação\./u),
    ).toBeTruthy();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/signup/plan',
      '/api/signup/checkout',
    ]);
  });
  it('resumes the persisted plan at checkout without another selection or plan write', async () => {
    const checkoutUrl = 'https://sandbox.asaas.com/checkoutSession/show?id=existing_fixture';
    fetchMock
      .mockResolvedValueOnce(json(200, { ...STATE, selectedPlanId: COMPLETE_ID }))
      .mockResolvedValueOnce(json(200, { state: 'checkout_pending', checkoutUrl }));
    render(<PlanSelectionForm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuar para o checkout' }));
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith(checkoutUrl));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/signup/plan',
      '/api/signup/checkout',
    ]);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });
  it('mostra clínica, preço mensal de tabela e trial resolvidos pelo servidor', async () => {
    fetchMock.mockResolvedValueOnce(json(200, STATE));
    render(<PlanSelectionForm />);

    expect(await screen.findByText('Clínica Sintética')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Essencial/u })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Completo/u })).toBeTruthy();
    expect(screen.getByText(/R\$.*149,00/u)).toBeTruthy();
    expect(screen.getByText(/R\$.*249,90/u)).toBeTruthy();
    expect(screen.getAllByText('/mês')).toHaveLength(2);
    expect(screen.getAllByText('7 dias grátis após a ativação')).toHaveLength(2);
    expect(within(screen.getByRole('complementary')).getByText('Clínica Sintética')).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Planos disponíveis' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/signup/plan', { cache: 'no-store' });
    expect(screen.queryByText(/Atendente: já está incluído/u)).toBeNull();
    expect(screen.queryByText('O que você pode testar')).toBeNull();
  });

  it('discloses the new evaluation quotas before the checkout', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        ...STATE,
        trialDays: 14,
        offerTrialEndsAt: '2026-11-02T13:45:00.000Z',
        plans: [
          {
            id: CONSULTORIO_2026_ID,
            code: 'consultorio_2026',
            name: 'Consultório',
            priceCents: 19700,
            cycle: 'monthly',
          },
        ],
      }),
    );
    render(<PlanSelectionForm />);
    expect(await screen.findByText('O que você pode testar')).toBeTruthy();
    expect(screen.getByText(/10 pacientes, 15 agendamentos e 15 documentos/u)).toBeTruthy();
    expect(
      screen.getByText(/convites de equipe ficam disponíveis após a confirmação do pagamento/u),
    ).toBeTruthy();
  });

  it('explica que o prazo da nova oferta começa na criação da conta, sem alterar o legado', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        ...STATE,
        offerTrialEndsAt: '2026-11-02T13:45:00.000Z',
        plans: [
          STATE.plans[0],
          {
            id: CONSULTORIO_2026_ID,
            code: 'consultorio_2026',
            name: 'Consultório',
            priceCents: 19700,
            cycle: 'monthly',
          },
        ],
      }),
    );
    render(<PlanSelectionForm />);

    expect(await screen.findByText('Consultório')).toBeTruthy();
    expect(
      screen.getByText(
        /14 dias desde a criação da conta; termina em 02\/11\/2026, 10:45 \(Brasília\)/u,
      ),
    ).toBeTruthy();
    expect(screen.getByText('7 dias grátis após a ativação')).toBeTruthy();
    expect(screen.getByText('1 médico + até 3 acessos administrativos')).toBeTruthy();
    expect(screen.getByText('Até 4 pessoas incluídas no total')).toBeTruthy();
    expect(
      screen.getByText(/Atendente: já está incluído nos 3 acessos administrativos/u),
    ).toBeTruthy();
    expect(
      screen.getByText(/Dono ou gestor com CRM cadastrado também conta como médico/u),
    ).toBeTruthy();
  });

  it('mostra cotas separadas de médicos e equipe para todas as variantes da Clínica', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        ...STATE,
        offerTrialEndsAt: '2026-11-02T13:45:00.000Z',
        plans: [2, 3, 4, 5].map((doctors) => ({
          id: `clinica-${doctors}`,
          code: `clinica_2026_${doctors}`,
          name: `Clínica ${doctors}`,
          priceCents: 39_700 + (doctors - 2) * 14_700,
          cycle: 'monthly',
        })),
      }),
    );
    render(<PlanSelectionForm />);
    // Desenho aprovado: a família vem primeiro; a quantidade de médicos fica no resumo.
    fireEvent.click(await screen.findByRole('button', { name: /^Clínica/u }));
    const mais = screen.getByRole('button', { name: 'Mais um médico' });
    const precos: Record<number, string> = { 2: '397,00', 3: '544,00', 4: '691,00', 5: '838,00' };
    for (const doctors of [2, 3, 4, 5]) {
      expect(screen.getByRole('group', { name: 'Médicos na clínica' }).textContent).toContain(
        String(doctors),
      );
      expect(screen.getByText('Até 3 acessos administrativos')).toBeTruthy();
      expect(screen.getByText('Pessoas no total').nextElementSibling?.textContent).toBe(
        `Até ${doctors + 3}`,
      );
      expect(screen.getByText('Total mensal').nextElementSibling?.textContent).toMatch(
        new RegExp(`R\\$\\s${precos[doctors]}/mês`, 'u'),
      );
      if (doctors < 5) fireEvent.click(mais);
    }
    expect((mais as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/mesmo antes de preencher o CRM/u)).toBeTruthy();
  });

  it('avisa que o pagamento confirmado é necessário depois do prazo, inclusive com data passada', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        ...STATE,
        offerTrialEndsAt: '2026-10-01T13:45:00.000Z',
        plans: [
          {
            id: CONSULTORIO_2026_ID,
            code: 'consultorio_2026',
            name: 'Consultório',
            priceCents: 19700,
            cycle: 'monthly',
          },
        ],
      }),
    );
    render(<PlanSelectionForm />);
    fireEvent.click(await screen.findByRole('button', { name: /^Consultório/u }));
    expect(
      screen.getByText(/A avaliação terminou em 01\/10\/2026, 10:45 \(Brasília\)/u),
    ).toBeTruthy();
    expect(screen.getByText(/O acesso continua só com o pagamento confirmado/u)).toBeTruthy();
    expect(screen.getByText(/R\$\s197,00 · primeira mensalidade/u)).toBeTruthy();
    expect(screen.getByText('Primeira mensalidade').nextElementSibling?.textContent).toBe('hoje');
    expect(screen.getByText(/a primeira mensalidade é cobrada hoje/u)).toBeTruthy();
    expect(screen.queryByText(/R\$\s0,00/u)).toBeNull();
  });

  it('mostra preço anual e envia plano mais ciclo sem aceitar preço do browser', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(200, {
          ...STATE,
          trialDays: 14,
          offerTrialEndsAt: '2026-11-02T13:45:00.000Z',
          plans: [
            {
              id: CONSULTORIO_2026_ID,
              code: 'consultorio_2026',
              name: 'Consultório',
              priceCents: 19_700,
              cycle: 'monthly',
            },
            {
              id: CONSULTORIO_2026_ID,
              code: 'consultorio_2026',
              name: 'Consultório',
              priceCents: 197_000,
              cycle: 'annual',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json(200, {
          rowVersion: 8,
          selectedPlanId: CONSULTORIO_2026_ID,
          selectedBillingCycle: 'annual',
        }),
      )
      .mockResolvedValueOnce(json(200, { state: 'pending' }));
    render(<PlanSelectionForm />);
    expect(await screen.findByText(/R\$.*197,00/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Anual/u }));
    expect(screen.getByText(/R\$.*1\.970,00/u)).toBeTruthy();
    expect(screen.queryByText(/R\$.*197,00/u)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Consultório/u }));
    expect(screen.getByText('Total anual')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar para o checkout' }));
    await screen.findByText('Plano salvo');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      rowVersion: 7,
      planId: CONSULTORIO_2026_ID,
      cycle: 'annual',
    });
  });

  it('salva a escolha e abre o checkout no mesmo clique, sem enviar preço do browser', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, STATE))
      .mockResolvedValueOnce(
        json(200, { rowVersion: 8, selectedPlanId: COMPLETE_ID, selectedBillingCycle: 'monthly' }),
      )
      .mockResolvedValueOnce(json(200, { state: 'pending' }));
    render(<PlanSelectionForm />);

    fireEvent.click(await screen.findByRole('radio', { name: /Completo/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar para o checkout' }));

    await screen.findByText('Plano salvo');
    expect(screen.getByRole('alert').textContent).toMatch(/7 dias grátis após a ativação/u);
    expect(screen.getByRole('alert').textContent).toMatch(
      /pagamento acontece com segurança na página do Asaas/u,
    );
    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith('/cadastro/pagamento?resultado=pending'),
    );
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/signup/plan',
      '/api/signup/plan',
      '/api/signup/checkout',
    ]);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/signup/plan');
    expect(fetchMock.mock.calls[1]?.[1]).toEqual({
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rowVersion: 7, planId: COMPLETE_ID, cycle: 'monthly' }),
    });
  });

  it('restaura escolha salva e usa a nova versão em alterações posteriores', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { ...STATE, rowVersion: 8, selectedPlanId: ESSENTIAL_ID }))
      .mockResolvedValueOnce(
        json(200, { rowVersion: 9, selectedPlanId: COMPLETE_ID, selectedBillingCycle: 'monthly' }),
      )
      .mockResolvedValueOnce(json(200, { state: 'pending' }));
    render(<PlanSelectionForm />);

    const essential = await screen.findByRole('radio', { name: /Essencial/u });
    expect(essential).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('radio', { name: /Completo/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar para o checkout' }));

    await screen.findByText('Plano salvo');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      rowVersion: 8,
      planId: COMPLETE_ID,
      cycle: 'monthly',
    });
  });

  it('recarrega o estado após conflito sem manter a escolha vencida', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, STATE))
      .mockResolvedValueOnce(json(409, { error: 'conflict' }))
      .mockResolvedValueOnce(json(200, { ...STATE, rowVersion: 8, selectedPlanId: ESSENTIAL_ID }));
    render(<PlanSelectionForm />);

    fireEvent.click(await screen.findByRole('radio', { name: /Completo/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar para o checkout' }));

    await screen.findByText('O cadastro foi atualizado em outra aba. Revise a escolha carregada.');
    expect(screen.getByRole('radio', { name: /Essencial/u })).toHaveProperty('checked', true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('mostra catálogo vazio e permite atualizar sem submeter', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ...STATE, plans: [] }));
    render(<PlanSelectionForm />);

    expect(await screen.findByText('Planos indisponíveis')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continuar para o checkout' })).toBeNull();
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
    fireEvent.click(screen.getByRole('button', { name: 'Continuar para o checkout' }));
    await waitFor(() => {
      expect(screen.getByText('Selecione um plano para continuar.')).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('abre a URL hospedada do Asaas e não entra direto no dashboard', async () => {
    const checkoutUrl = 'https://sandbox.asaas.com/checkoutSession/show?id=checkout_1';
    fetchMock
      .mockResolvedValueOnce(json(200, STATE))
      .mockResolvedValueOnce(
        json(200, { rowVersion: 8, selectedPlanId: COMPLETE_ID, selectedBillingCycle: 'monthly' }),
      )
      .mockResolvedValueOnce(json(200, { state: 'checkout_pending', checkoutUrl }));
    render(<PlanSelectionForm />);

    fireEvent.click(await screen.findByRole('radio', { name: /Completo/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar para o checkout' }));
    await screen.findByText('Plano salvo');
    expect(screen.queryByRole('textbox', { name: /CPF ou CNPJ/u })).toBeNull();

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith(checkoutUrl));
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(JSON.stringify({}));
    expect(assignMock).not.toHaveBeenCalledWith('/auth/session-refresh?next=/dashboard');
  });

  it('retoma a verificação de uma assinatura já criada sem declarar erro nem abrir outro Checkout', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, STATE))
      .mockResolvedValueOnce(
        json(200, { rowVersion: 8, selectedPlanId: COMPLETE_ID, selectedBillingCycle: 'monthly' }),
      )
      .mockResolvedValueOnce(json(200, { state: 'pending' }));
    render(<PlanSelectionForm />);

    fireEvent.click(await screen.findByRole('radio', { name: /Completo/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar para o checkout' }));
    await screen.findByText('Plano salvo');

    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith('/cadastro/pagamento?resultado=pending'),
    );
  });

  it('recusa URL de Checkout fora dos hosts oficiais', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, STATE))
      .mockResolvedValueOnce(
        json(200, { rowVersion: 8, selectedPlanId: COMPLETE_ID, selectedBillingCycle: 'monthly' }),
      )
      .mockResolvedValueOnce(
        json(200, { state: 'checkout_pending', checkoutUrl: 'https://evil.test/coletar-cartao' }),
      );
    render(<PlanSelectionForm />);

    fireEvent.click(await screen.findByRole('radio', { name: /Completo/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar para o checkout' }));
    await screen.findByText('Plano salvo');

    await screen.findByText(/poss.vel concluir agora/u);
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('aguarda o salvamento e bloqueia cliques e mudanças durante as duas requisições', async () => {
    const save = deferredResponse();
    const checkout = deferredResponse();
    fetchMock
      .mockResolvedValueOnce(json(200, STATE))
      .mockReturnValueOnce(save.promise)
      .mockReturnValueOnce(checkout.promise);
    const { container } = render(<PlanSelectionForm />);
    fireEvent.click(await screen.findByRole('radio', { name: /Completo/u }));
    const form = container.querySelector('form');
    if (!form) throw new Error('Plan form missing');
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('radio', { name: /Essencial/u })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /Continuar para o checkout/u })).toHaveProperty(
      'disabled',
      true,
    );
    save.resolve(
      json(200, { rowVersion: 8, selectedPlanId: COMPLETE_ID, selectedBillingCycle: 'monthly' }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('radio', { name: /Essencial/u })).toHaveProperty('disabled', true);
    // Estado "processando" da prancha: o pagamento seguro está sendo aberto.
    expect(screen.getByRole('button', { name: 'Abrindo o pagamento seguro…' })).toHaveProperty(
      'disabled',
      true,
    );
    checkout.resolve(json(200, { state: 'pending' }));
    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith('/cadastro/pagamento?resultado=pending'),
    );
  });

  it('mantém o plano salvo após falha no checkout e retoma sem salvar novamente', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, STATE))
      .mockResolvedValueOnce(
        json(200, { rowVersion: 8, selectedPlanId: COMPLETE_ID, selectedBillingCycle: 'monthly' }),
      )
      .mockRejectedValueOnce(new TypeError('Network unavailable'))
      .mockResolvedValueOnce(json(200, { state: 'pending' }));
    render(<PlanSelectionForm />);
    fireEvent.click(await screen.findByRole('radio', { name: /Completo/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar para o checkout' }));
    await screen.findByText(/a assinatura pode ter sido criada/u);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar para o checkout' }));
    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith('/cadastro/pagamento?resultado=pending'),
    );
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/signup/checkout')).toHaveLength(2);
  });

  it.each([400, 401, 403, 410, 429, 500])(
    'não abre checkout quando salvar falha com HTTP %s',
    async (status) => {
      fetchMock.mockResolvedValueOnce(json(200, STATE)).mockResolvedValueOnce(json(status, {}));
      render(<PlanSelectionForm />);
      fireEvent.click(await screen.findByRole('radio', { name: /Completo/u }));
      fireEvent.click(screen.getByRole('button', { name: 'Continuar para o checkout' }));
      await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(assignMock).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/signup/checkout')).toBe(false);
    },
  );

  it.each([
    { rowVersion: 8, selectedPlanId: ESSENTIAL_ID, selectedBillingCycle: 'monthly' },
    { rowVersion: 8, selectedPlanId: COMPLETE_ID, selectedBillingCycle: 'annual' },
    { rowVersion: '8', selectedPlanId: COMPLETE_ID, selectedBillingCycle: 'monthly' },
  ])('não abre checkout com confirmação de salvamento incompatível: %j', async (body) => {
    fetchMock.mockResolvedValueOnce(json(200, STATE)).mockResolvedValueOnce(json(200, body));
    render(<PlanSelectionForm />);
    fireEvent.click(await screen.findByRole('radio', { name: /Completo/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar para o checkout' }));
    await screen.findByText('Não foi possível salvar o plano. Tente novamente.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(assignMock).not.toHaveBeenCalled();
  });
});

// Checkout no desenho aprovado no Claude Design ("Cadastro · 3. Checkout"), 18/11/2026.
describe('checkout do cadastro no desenho aprovado', () => {
  // O painel "Hoje / Primeira mensalidade" depende do relógio: fixa a data (só o Date).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T15:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const OFERTA = [
    { id: 'consultorio', code: 'consultorio_2026', name: 'Consultório', priceCents: 19_700 },
    ...[2, 3, 4, 5].map((doctors) => ({
      id: `clinica-${doctors}`,
      code: `clinica_2026_${doctors}`,
      name: `Clínica · ${doctors} médicos`,
      priceCents: 39_700 + (doctors - 2) * 14_700,
    })),
  ].map((plan) => ({ ...plan, cycle: 'monthly' as const }));

  const texto = (el: Element | null | undefined) => el?.textContent?.replace(/\s/gu, ' ');

  function estado(selectedPlanId: string | null, plans = OFERTA) {
    return {
      ...STATE,
      trialDays: 14,
      offerTrialEndsAt: '2026-12-02T15:00:00.000Z',
      selectedPlanId,
      plans,
    };
  }

  it('mostra o plano vindo do site no resumo: família, médicos, linhas, total e hoje', async () => {
    fetchMock.mockResolvedValueOnce(json(200, estado('clinica-3')));
    render(<PlanSelectionForm />);
    expect(await screen.findByRole('heading', { name: 'Clínica' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Cartão de crédito' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Médicos na clínica' }).textContent).toContain('3');
    expect(texto(screen.getByText('Plano Clínica com 2 médicos').nextElementSibling)).toBe(
      'R$ 397,00',
    );
    expect(texto(screen.getByText('1 médico extra × R$ 147,00').nextElementSibling)).toBe(
      'R$ 147,00',
    );
    expect(texto(screen.getByText('Total mensal').nextElementSibling)).toBe('R$ 544,00/mês');
    expect(screen.getByText('R$ 0,00 · 14 dias grátis')).toBeTruthy();
    expect(texto(screen.getByText('Primeira mensalidade').nextElementSibling)).toBe('03/12/2026');
    expect(screen.getByText(/Grátis até 02\/12\/2026, 12:00 \(Brasília\)/u)).toBeTruthy();
    expect(
      screen.getByText(/Nada é cobrado hoje; a primeira mensalidade vence em 03\/12\/2026/u),
    ).toBeTruthy();
    expect(screen.getByText('O cartão é informado na página segura do Asaas.')).toBeTruthy();
    // No carregamento o plano já está no resumo; o aviso só vem depois de salvar.
    expect(screen.queryByText('Plano salvo')).toBeNull();
    // Nenhum campo de cartão: o cartão é informado na página hospedada.
    expect(document.querySelector('input[autocomplete^="cc-"]')).toBeNull();
  });

  it('Trocar plano alterna entre Consultório e Clínica, e o resumo acompanha', async () => {
    fetchMock.mockResolvedValueOnce(json(200, estado('clinica-3')));
    render(<PlanSelectionForm />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Trocar plano: mudar para Consultório' }),
    );
    expect(screen.getByRole('heading', { name: 'Consultório' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Médicos na clínica' })).toBeNull();
    expect(texto(screen.getByText('Total mensal').nextElementSibling)).toBe('R$ 197,00/mês');
    fireEvent.click(screen.getByRole('button', { name: 'Trocar plano: mudar para Clínica' }));
    expect(screen.getByRole('heading', { name: 'Clínica' })).toBeTruthy();
    expect(texto(screen.getByText('Total mensal').nextElementSibling)).toBe('R$ 397,00/mês');
  });

  it('o seletor de médicos escolhe o plano do servidor e só ele vai no PUT', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, estado('clinica-3')))
      .mockResolvedValueOnce(
        json(200, { rowVersion: 8, selectedPlanId: 'clinica-4', selectedBillingCycle: 'monthly' }),
      )
      .mockResolvedValueOnce(json(200, { state: 'pending' }));
    render(<PlanSelectionForm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mais um médico' }));
    expect(texto(screen.getByText('Total mensal').nextElementSibling)).toBe('R$ 691,00/mês');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar para o checkout' }));
    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith('/cadastro/pagamento?resultado=pending'),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      rowVersion: 7,
      planId: 'clinica-4',
      cycle: 'monthly',
    });
    expect(screen.getByText('Plano salvo')).toBeTruthy();
  });

  it('com só os planos de entrada, o seletor fica em 2 e diz onde ampliar', async () => {
    fetchMock.mockResolvedValueOnce(json(200, estado('clinica-2', OFERTA.slice(0, 2))));
    render(<PlanSelectionForm />);
    const menos = await screen.findByRole('button', { name: 'Menos um médico' });
    expect((menos as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Mais um médico' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText('Amplie depois, na assinatura.')).toBeTruthy();
    expect(screen.queryByText(/médico extra/u)).toBeNull();
  });

  it('conta os dias que restam da avaliação, sem prometer 14 quando já passaram alguns', async () => {
    vi.setSystemTime(new Date('2026-11-29T15:00:00.000Z'));
    fetchMock.mockResolvedValueOnce(json(200, estado('clinica-3')));
    render(<PlanSelectionForm />);
    expect(await screen.findByText('R$ 0,00 · 3 dias grátis')).toBeTruthy();
  });

  it('cartão recusado pelo provedor: aviso no topo do pagamento, nada cobrado, nova tentativa limpa', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, estado('clinica-3')))
      .mockResolvedValueOnce(json(402, { error: 'declined' }))
      .mockResolvedValueOnce(json(200, { state: 'pending' }));
    render(<PlanSelectionForm />);
    // Plano já salvo: o clique vai direto ao checkout.
    fireEvent.click(await screen.findByRole('button', { name: 'Continuar para o checkout' }));
    const alerta = await screen.findByText('O provedor recusou o pagamento. Nada foi cobrado.');
    const pagamento = screen.getByRole('region', { name: 'Cartão de crédito' });
    expect(pagamento.contains(alerta)).toBe(true);
    expect(assignMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar para o checkout' }));
    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith('/cadastro/pagamento?resultado=pending'),
    );
    expect(screen.queryByText('O provedor recusou o pagamento. Nada foi cobrado.')).toBeNull();
  });

  it('sem plano escolhido, pede a família e não deixa seguir sem escolha', async () => {
    fetchMock.mockResolvedValueOnce(json(200, estado(null)));
    render(<PlanSelectionForm />);
    expect(await screen.findByRole('heading', { name: 'Escolha o plano' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Clínica De 2 a 5 médicos/u })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar para o checkout' }));
    expect(await screen.findByText('Selecione um plano para continuar.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
