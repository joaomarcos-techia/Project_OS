// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByRole('radiogroup', { name: 'Planos disponíveis' }).className).toContain(
      'md:grid-cols-3',
    );
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
    await screen.findByText('Clínica 2');
    for (const doctors of [2, 3, 4, 5]) {
      expect(screen.getByText(`${doctors} médicos + até 3 acessos administrativos`)).toBeTruthy();
      expect(screen.getByText(`Até ${doctors + 3} pessoas incluídas no total`)).toBeTruthy();
    }
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
    expect(await screen.findByText(/termina em 01\/10\/2026, 10:45/u)).toBeTruthy();
    expect(screen.getByText(/Após esse horário, acesso só com pagamento confirmado/u)).toBeTruthy();
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
    fireEvent.click(screen.getByRole('radio', { name: /Consultório/u }));
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
    expect(screen.getByRole('button', { name: /Continuar para o checkout/u })).toHaveProperty(
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
