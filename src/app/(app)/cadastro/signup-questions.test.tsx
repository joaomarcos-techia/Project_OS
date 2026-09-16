// @vitest-environment happy-dom

import { StrictMode } from 'react';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SignupAnswerValues, SignupSessionState } from '@/contexts/onboarding';

import { SignupQuestions } from './signup-questions';

vi.mock('@/components/shared/turnstile-widget', () => ({
  TurnstileWidget: () => (
    <input type="hidden" name="captchaToken" value="challenge-token" readOnly />
  ),
}));

const fetchMock = vi.fn<typeof fetch>();

const ANSWERS: SignupAnswerValues = {
  professionalsBand: '2_5',
  weeklyAppointmentsBand: '21_50',
  currentTooling: 'outro_sistema',
  discoverySource: 'indicacao_colega',
};

const EMPTY_SESSION: SignupSessionState = {
  status: 'initiated',
  riskLevel: 0,
  expiresAt: '2026-09-14T15:00:00.000Z',
  rowVersion: 1,
  answers: null,
};

const SAVED_SESSION: SignupSessionState = {
  ...EMPTY_SESSION,
  status: 'details_complete',
  rowVersion: 2,
  answers: ANSWERS,
};

it.each([false, true])(
  'email_pending congela perguntas/identidade, inclusive gate %s, sem repetir Auth',
  async (identityEnabled) => {
    fetchMock.mockResolvedValueOnce(
      json(200, { session: { ...SAVED_SESSION, status: 'email_pending', rowVersion: 5 } }),
    );
    render(<SignupQuestions identityEnabled={identityEnabled} />);
    await screen.findByText(/Se houver uma etapa de confirmação/u);
    expect(screen.getAllByRole('radio').every((radio) => radio.hasAttribute('disabled'))).toBe(
      true,
    );
    expect(screen.queryByRole('button', { name: 'Salvar respostas' })).toBeNull();
    expect(screen.queryByLabelText('Seu nome')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Substituir dados salvos' })).toBeNull();
    expect(screen.queryByText(/Nenhum e-mail de confirmação foi enviado/u)).toBeNull();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/signup/sessions/me']);
  },
);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deferredResponse() {
  let settle = (_response: Response): void => {
    throw new Error('deferred response not initialized');
  };
  const promise = new Promise<Response>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

async function renderReady(session: SignupSessionState = EMPTY_SESSION) {
  fetchMock.mockResolvedValueOnce(json(200, { session }));
  render(<SignupQuestions />);
  await screen.findByRole('heading', { name: 'Conte como sua clínica funciona hoje' });
}

function chooseAll(): void {
  fireEvent.click(screen.getByRole('radio', { name: '2 a 5' }));
  fireEvent.click(screen.getByRole('radio', { name: '21 a 50' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Outro sistema' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Indicação de um colega' }));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('cadastro — quatro perguntas impessoais', () => {
  it('abre uma única sessão no StrictMode e não renderiza campos de PII', async () => {
    fetchMock
      .mockResolvedValueOnce(json(410, { error: 'gone' }))
      .mockResolvedValueOnce(json(201, { session: EMPTY_SESSION }));

    render(
      <StrictMode>
        <SignupQuestions />
      </StrictMode>,
    );

    await screen.findByRole('heading', { name: 'Conte como sua clínica funciona hoje' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/signup/sessions/me');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/signup/sessions');
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('POST');
    expect(screen.getAllByRole('radio')).toHaveLength(17);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(
      document.querySelector('input[type="password"], input[type="email"], textarea'),
    ).toBeNull();
  });

  it('retoma respostas persistidas por GET /me sem criar outra sessão', async () => {
    await renderReady(SAVED_SESSION);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('radio', { name: '2 a 5' })).toHaveProperty('checked', true);
    expect(screen.getByRole('radio', { name: '21 a 50' })).toHaveProperty('checked', true);
    expect(screen.getByRole('radio', { name: 'Outro sistema' })).toHaveProperty('checked', true);
    expect(screen.getByRole('radio', { name: 'Indicação de um colega' })).toHaveProperty(
      'checked',
      true,
    );
    expect(screen.getByRole('alert').textContent).toContain('Carregamos as respostas salvas');
  });

  it('foca a primeira pergunta ausente e não envia formulário incompleto', async () => {
    await renderReady();

    fireEvent.click(screen.getByRole('button', { name: 'Salvar respostas' }));

    const first = screen.getByRole('radio', { name: '1 profissional' });
    expect(document.activeElement).toBe(first);
    expect(screen.getByRole('alert').textContent).toContain('Marque uma opção em cada pergunta');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('radiogroup', { name: 'Quantidade de profissionais' })).toBeTruthy();
  });

  it('envia uma vez, bloqueia edição durante o POST e confirma o snapshot salvo', async () => {
    const pending = deferredResponse();
    fetchMock.mockResolvedValueOnce(json(200, { session: EMPTY_SESSION }));
    fetchMock.mockImplementationOnce(() => pending.promise);
    render(<SignupQuestions />);
    await screen.findByRole('heading', { name: 'Conte como sua clínica funciona hoje' });
    chooseAll();

    const submit = screen.getByRole('button', { name: 'Salvar respostas' });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getAllByRole('radio').every((radio) => radio.hasAttribute('disabled'))).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('radio', { name: '1 profissional' }));
    expect(screen.getByRole('radio', { name: '2 a 5' })).toHaveProperty('checked', true);

    const body = fetchMock.mock.calls[1]?.[1]?.body;
    expect(JSON.parse(String(body))).toEqual({ ...ANSWERS, rowVersion: 1 });
    pending.settle(json(200, { rowVersion: 2 }));

    await screen.findByText(/Respostas salvas\. A etapa de criação da conta será conectada/u);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('radio', { name: '2 a 5' })).toHaveProperty('checked', true);
  });

  it('resolve CAS perdido relendo e exibindo as respostas vencedoras', async () => {
    await renderReady();
    chooseAll();
    const winner: SignupSessionState = {
      ...SAVED_SESSION,
      answers: {
        professionalsBand: '1',
        weeklyAppointmentsBand: 'ate_20',
        currentTooling: 'agenda_generica',
        discoverySource: 'evento',
      },
    };
    fetchMock
      .mockResolvedValueOnce(json(409, { error: 'conflict' }))
      .mockResolvedValueOnce(json(200, { session: winner }));

    fireEvent.click(screen.getByRole('button', { name: 'Salvar respostas' }));

    await screen.findByText(/Outra aba salvou primeiro/u);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('radio', { name: '1 profissional' })).toHaveProperty('checked', true);
    expect(screen.getByRole('radio', { name: 'Até 20' })).toHaveProperty('checked', true);
    expect(screen.getByRole('radio', { name: 'Agenda genérica' })).toHaveProperty('checked', true);
    expect(screen.getByRole('radio', { name: 'Evento ou congresso' })).toHaveProperty(
      'checked',
      true,
    );
  });

  it('transforma 409 seguido de 410 em reinício de sessão, não em erro de rede', async () => {
    await renderReady();
    chooseAll();
    fetchMock
      .mockResolvedValueOnce(json(409, { error: 'conflict' }))
      .mockResolvedValueOnce(json(410, { error: 'gone' }));

    fireEvent.click(screen.getByRole('button', { name: 'Salvar respostas' }));

    expect(await screen.findByRole('button', { name: 'Começar novamente' })).toBeTruthy();
    expect(screen.getByText(/Esta sessão expirou/u)).toBeTruthy();
  });

  it('mantém o estado pronto quando a releitura do conflito recebe 429', async () => {
    await renderReady();
    chooseAll();
    fetchMock
      .mockResolvedValueOnce(json(409, { error: 'conflict' }))
      .mockResolvedValueOnce(json(429, { error: 'rate_limited' }));

    fireEvent.click(screen.getByRole('button', { name: 'Salvar respostas' }));

    await screen.findByText(/a releitura atingiu o limite/u);
    expect(screen.getByRole('button', { name: 'Salvar respostas' })).toBeTruthy();
  });

  it('distingue sessão expirada e rate limit ao salvar', async () => {
    await renderReady();
    chooseAll();
    fetchMock.mockResolvedValueOnce(json(410, { error: 'gone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar respostas' }));
    expect(await screen.findByRole('button', { name: 'Começar novamente' })).toBeTruthy();

    cleanup();
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(json(200, { session: EMPTY_SESSION }))
      .mockResolvedValueOnce(json(429, { error: 'rate_limited' }));
    render(<SignupQuestions />);
    await screen.findByRole('heading', { name: 'Conte como sua clínica funciona hoje' });
    chooseAll();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar respostas' }));
    await screen.findByText(/Aguarde um minuto antes de salvar/u);
    expect(
      screen.getAllByRole('radio').filter((radio) => radio.hasAttribute('checked')),
    ).toHaveLength(0);
    expect(screen.getByRole('radio', { name: '2 a 5' })).toHaveProperty('checked', true);
  });

  it('preserva as escolhas quando a rede falha antes da confirmação', async () => {
    await renderReady();
    chooseAll();
    fetchMock.mockRejectedValueOnce(new TypeError('network'));

    fireEvent.click(screen.getByRole('button', { name: 'Salvar respostas' }));

    await screen.findByText(/A conexão falhou antes da confirmação/u);
    expect(screen.getByRole('radio', { name: '2 a 5' })).toHaveProperty('checked', true);
    expect(screen.getByRole('radio', { name: 'Indicação de um colega' })).toHaveProperty(
      'checked',
      true,
    );
  });

  it('resolve o desafio exigido e usa o token apenas na nova tentativa', async () => {
    fetchMock
      .mockResolvedValueOnce(json(410, { error: 'gone' }))
      .mockResolvedValueOnce(json(401, { error: 'challenge_required' }))
      .mockResolvedValueOnce(json(410, { error: 'gone' }))
      .mockResolvedValueOnce(json(201, { session: EMPTY_SESSION }));
    render(<SignupQuestions />);

    expect(await screen.findByRole('heading', { name: 'Vamos retomar daqui' })).toBeTruthy();
    expect(screen.getByText(/Conclua a verificação de segurança/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    await screen.findByRole('heading', { name: 'Conte como sua clínica funciona hoje' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({});
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({
      turnstileToken: 'challenge-token',
    });
  });

  it('mostra limite de leitura sem tentar criar uma sessão', async () => {
    fetchMock.mockResolvedValueOnce(json(429, { error: 'rate_limited' }));
    render(<SignupQuestions />);

    await screen.findByText(/Muitas consultas em pouco tempo/u);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
  });
});

describe('cadastro — conta e espera O-3b.5', () => {
  const identitySession: SignupSessionState = {
    ...SAVED_SESSION,
    status: 'identity_pending',
    rowVersion: 3,
  };

  async function renderIdentity(session = SAVED_SESSION) {
    fetchMock.mockResolvedValueOnce(json(200, { session }));
    render(<SignupQuestions identityEnabled />);
    await screen.findByRole('heading', { name: 'Seus dados e o nome da clínica' });
  }

  function fillIdentity() {
    fireEvent.change(screen.getByLabelText('Seu nome'), { target: { value: ' Ana ' } });
    fireEvent.change(screen.getByLabelText('Nome da clínica'), {
      target: { value: ' Clínica Teste ' },
    });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@example.test' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'Senha123!' } });
  }

  it('mantém o gate fechado e só abre os dados depois das quatro respostas', async () => {
    await renderReady(SAVED_SESSION);
    expect(screen.queryByRole('textbox')).toBeNull();
    cleanup();
    await renderIdentity(identitySession);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('solicitação da conta ainda não foi');
    expect(screen.queryByRole('button', { name: 'Salvar respostas' })).toBeNull();
    cleanup();
    fetchMock.mockResolvedValueOnce(json(200, { session: EMPTY_SESSION }));
    render(<SignupQuestions identityEnabled />);
    await screen.findByRole('heading', { name: 'Conte como sua clínica funciona hoje' });
    expect(screen.queryByRole('textbox')).toBeNull();
    chooseAll();
    fetchMock.mockResolvedValueOnce(json(200, { rowVersion: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar respostas' }));
    await screen.findByLabelText('Seu nome');
    expect(document.activeElement).toBe(screen.getByLabelText('Seu nome'));
  });

  it('aplica o mesmo filtro de senha da API antes de qualquer escrita', async () => {
    await renderIdentity();
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByLabelText('Seu nome').getAttribute('maxlength')).toBe('120');
    expect(screen.getByLabelText('E-mail').getAttribute('maxlength')).toBe('160');
    expect(screen.getByLabelText('Senha').getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByLabelText('Senha').getAttribute('maxlength')).toBe('72');
    expect(screen.getByText(/De 8 a 72 caracteres/u)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Termos de Uso' }).getAttribute('href')).toBe(
      'https://qoro.dev/termos-de-uso',
    );
    fillIdentity();
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'semregras' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta e continuar' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Senha'));
    expect(screen.getByText(/Use de 8 a 72 caracteres, sem espaços/u)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('salva staging e chama Auth uma vez com a versão nova, senha e captcha efêmeros', async () => {
    await renderIdentity();
    fillIdentity();
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta e continuar' }));
    expect(document.activeElement).toBe(screen.getByRole('checkbox'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('checkbox'));
    fetchMock
      .mockResolvedValueOnce(json(200, { rowVersion: 3 }))
      .mockResolvedValueOnce(json(200, { rowVersion: 5 }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta e continuar' }));
    await screen.findByRole('heading', { name: 'Aguardando a confirmação do e-mail' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/signup/sessions/identity');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      rowVersion: 2,
      ownerName: 'Ana',
      clinicName: 'Clínica Teste',
      email: 'ana@example.test',
      accepted: true,
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/signup/sessions/auth');
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      rowVersion: 3,
      email: 'ana@example.test',
      password: 'Senha123!',
      accepted: true,
      captchaToken: 'challenge-token',
    });
    expect(screen.queryByLabelText('Senha')).toBeNull();
    expect(screen.getAllByRole('radio').every((radio) => radio.hasAttribute('disabled'))).toBe(
      true,
    );
  });

  it('retoma identity_pending sem PII/senha e exige redigitação para continuar', async () => {
    await renderIdentity(identitySession);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByLabelText('Senha')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retomar criação da conta' }));
    expect(
      screen
        .getAllByRole('textbox')
        .every((input) => input instanceof HTMLInputElement && input.value === ''),
    ).toBe(true);
    expect(screen.getByLabelText('Senha')).toHaveProperty('value', '');
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
    expect(document.activeElement).toBe(screen.getByLabelText('Seu nome'));
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta e continuar' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Seu nome'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('limpa a senha depois de rate limit e reutiliza somente a versão confirmada do staging', async () => {
    await renderIdentity();
    fillIdentity();
    fireEvent.click(screen.getByRole('checkbox'));
    fetchMock
      .mockResolvedValueOnce(json(200, { rowVersion: 3 }))
      .mockResolvedValueOnce(json(429, { error: 'rate_limited' }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta e continuar' }));
    await screen.findByText(/Aguarde antes de solicitar a conta/u);
    expect(screen.getByLabelText('Senha')).toHaveProperty('value', '');
    expect(screen.getByLabelText('Seu nome')).toHaveProperty('value', ' Ana ');

    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'Outra123!' } });
    fetchMock
      .mockResolvedValueOnce(json(200, { rowVersion: 4 }))
      .mockResolvedValueOnce(json(200, { rowVersion: 6 }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta e continuar' }));
    await screen.findByRole('heading', { name: 'Aguardando a confirmação do e-mail' });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)).rowVersion).toBe(3);
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body)).rowVersion).toBe(4);
  });

  it('reconcilia resposta Auth ambígua e não repete a criação da conta', async () => {
    await renderIdentity();
    fillIdentity();
    fireEvent.click(screen.getByRole('checkbox'));
    fetchMock
      .mockResolvedValueOnce(json(200, { rowVersion: 3 }))
      .mockResolvedValueOnce(json(503, { error: 'unavailable' }))
      .mockResolvedValueOnce(
        json(200, { session: { ...identitySession, status: 'email_pending', rowVersion: 5 } }),
      );
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta e continuar' }));
    await screen.findByRole('heading', { name: 'Aguardando a confirmação do e-mail' });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/signup/sessions/me',
      '/api/signup/sessions/identity',
      '/api/signup/sessions/auth',
      '/api/signup/sessions/me',
    ]);
    expect(screen.getByText(/Não repetimos automaticamente/u)).toBeTruthy();
  });

  it('faz reenvio explícito sem senha, com redigitação, aceite e captcha novos', async () => {
    const pendingSession: SignupSessionState = {
      ...identitySession,
      status: 'email_pending',
      rowVersion: 5,
    };
    fetchMock.mockResolvedValueOnce(json(200, { session: pendingSession }));
    render(<SignupQuestions identityEnabled />);
    await screen.findByRole('heading', { name: 'Aguardando a confirmação do e-mail' });
    expect(screen.queryByLabelText('Senha')).toBeNull();
    fireEvent.change(screen.getByLabelText('E-mail usado no cadastro'), {
      target: { value: 'ana@example.test' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fetchMock.mockResolvedValueOnce(json(200, { rowVersion: 7 }));
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar instruções' }));
    await screen.findByText(/nova solicitação foi concluída/u);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      rowVersion: 5,
      email: 'ana@example.test',
      accepted: true,
      captchaToken: 'challenge-token',
    });
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).not.toContain('password');
    expect(screen.getByLabelText('E-mail usado no cadastro')).toHaveProperty('value', '');
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
  });
});
