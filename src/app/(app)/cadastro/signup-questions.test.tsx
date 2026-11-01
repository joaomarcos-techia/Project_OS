// @vitest-environment happy-dom

import { StrictMode } from 'react';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SignupAnswerValues, SignupSessionState } from '@/contexts/onboarding';

import { SignupQuestions } from './signup-questions';

vi.mock('@/components/shared/turnstile-widget', () => ({
  TurnstileWidget: () => (
    <input type="hidden" name="captchaToken" value="challenge-token" readOnly />
  ),
}));

const fetchMock = vi.fn<typeof fetch>();
/** O happy-dom não navega; `assign` prova o destino após o handoff explícito. */
const assignMock = vi.fn<(url: string | URL) => void>();

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

/** Mesmo intervalo do componente: no máximo 45 leituras por janela de 15 min. */
const POLL_INTERVAL_MS = 20_000;

it.each([false, true])(
  'email_pending congela perguntas/identidade, inclusive gate %s, sem repetir Auth',
  async (identityEnabled) => {
    fetchMock.mockResolvedValueOnce(
      json(200, { session: { ...SAVED_SESSION, status: 'email_pending', rowVersion: 5 } }),
    );
    render(<SignupQuestions identityEnabled={identityEnabled} />);
    await screen.findByRole('heading', { name: 'Aguardando a confirmação do e-mail' });
    expect(screen.getByText(/enviaremos um link e um código de 8 dígitos/u)).toBeTruthy();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Salvar e continuar' })).toBeNull();
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
  if (session.answers) {
    await screen.findByText('Respostas salvas');
  } else {
    await screen.findByRole('heading', { name: 'Quantos médicos atendem na clínica?' });
  }
}

async function chooseAll(): Promise<void> {
  fireEvent.click(screen.getByRole('radio', { name: '2 a 5' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await screen.findByRole('heading', { name: 'Quantos atendimentos são realizados por semana?' });
  fireEvent.click(screen.getByRole('radio', { name: '21 a 50' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await screen.findByRole('heading', { name: 'Como a clínica se organiza hoje?' });
  fireEvent.click(screen.getByRole('radio', { name: 'Outro sistema' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await screen.findByRole('heading', { name: 'Como você conheceu a Qoro?' });
  fireEvent.click(screen.getByRole('radio', { name: 'Indicação de um colega' }));
}

beforeEach(() => {
  fetchMock.mockReset();
  assignMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // `window.location` e read-only no happy-dom; so o metodo e substituivel.
  vi.spyOn(window.location, 'assign').mockImplementation(assignMock);
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
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

    await screen.findByRole('heading', { name: 'Quantos médicos atendem na clínica?' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/signup/sessions/me');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/signup/sessions');
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('POST');
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(
      document.querySelector('input[type="password"], input[type="email"], textarea'),
    ).toBeNull();
  });

  it('retoma respostas persistidas por GET /me sem criar outra sessão', async () => {
    await renderReady(SAVED_SESSION);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Respostas salvas')).toBeTruthy();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByRole('alert').textContent).toContain('Carregamos as respostas salvas');
  });

  it('avança uma pergunta por tela e preserva a escolha ao voltar', async () => {
    await renderReady();

    expect(screen.getByText('Pergunta 1 de 4')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Voltar' })).toBeNull();
    expect(screen.getByText(/Não pedimos dados de pacientes/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '2 a 5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    await screen.findByRole('heading', {
      name: 'Quantos atendimentos são realizados por semana?',
    });
    expect(screen.getByText('Pergunta 2 de 4')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: '2 a 5' })).toBeNull();
    // O contexto é dito uma vez, antes da primeira resposta; repeti-lo nas
    // quatro telas seria ruído e tiraria a hierarquia do título.
    expect(screen.queryByText(/Não pedimos dados de pacientes/u)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));

    await screen.findByRole('heading', { name: 'Quantos médicos atendem na clínica?' });
    expect(screen.getByRole('radio', { name: '2 a 5' })).toHaveProperty('checked', true);
    // Navegar entre perguntas é estado de tela: nada vai ao servidor antes da
    // quarta resposta, então o bootstrap continua sendo a única chamada.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retoma a primeira pergunta ainda não respondida depois de recarregar a página', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { session: EMPTY_SESSION }));
    const firstRender = render(<SignupQuestions />);

    await screen.findByRole('heading', { name: 'Quantos médicos atendem na clínica?' });
    fireEvent.click(screen.getByRole('radio', { name: '2 a 5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByRole('heading', {
      name: 'Quantos atendimentos são realizados por semana?',
    });

    firstRender.unmount();
    fetchMock.mockResolvedValueOnce(json(200, { session: EMPTY_SESSION }));
    render(<SignupQuestions />);

    await screen.findByRole('heading', {
      name: 'Quantos atendimentos são realizados por semana?',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByRole('radio', { name: '2 a 5' })).toHaveProperty('checked', true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('não leva respostas locais para uma sessão nova', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { session: EMPTY_SESSION }));
    const firstRender = render(<SignupQuestions />);
    await screen.findByRole('heading', { name: 'Quantos médicos atendem na clínica?' });
    fireEvent.click(screen.getByRole('radio', { name: '2 a 5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByRole('heading', {
      name: 'Quantos atendimentos são realizados por semana?',
    });
    firstRender.unmount();

    fetchMock
      .mockResolvedValueOnce(json(410, { error: 'gone' }))
      .mockResolvedValueOnce(json(201, { session: EMPTY_SESSION }));
    render(<SignupQuestions />);

    await screen.findByRole('heading', { name: 'Quantos médicos atendem na clínica?' });
    expect(screen.getByRole('radio', { name: '2 a 5' })).toHaveProperty('checked', false);
    expect(window.localStorage).toHaveLength(0);
  });

  it('descarta escolhas locais após uma hora, sem renovar o prazo ao editar', async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    await renderReady();
    fireEvent.click(screen.getByRole('radio', { name: '2 a 5' }));
    clock.mockReturnValue(start + 30 * 60 * 1_000);
    fireEvent.click(screen.getByRole('radio', { name: '1 médico' }));
    cleanup();
    clock.mockReturnValue(start + 60 * 60 * 1_000);

    await renderReady();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveProperty('checked', false);
    }
    expect(window.localStorage).toHaveLength(0);
  });

  it.each([
    '{invalid',
    JSON.stringify({ version: 1, expiresAt: Date.now() + 60_000, answers: { role: 'owner' } }),
    JSON.stringify({
      version: 1,
      expiresAt: Date.now() + 60_000,
      answers: { professionalsBand: 'arbitrary' },
    }),
  ])('descarta armazenamento adulterado e permite recomeçar (%#)', async (stored) => {
    window.localStorage.setItem('qoro-signup-answers-v1', stored);
    await renderReady();
    expect(window.localStorage).toHaveLength(0);
    expect(screen.getByText('Pergunta 1 de 4')).toBeTruthy();
  });

  it('continua o cadastro quando o navegador bloqueia o armazenamento', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    await renderReady();
    await chooseAll();
    fetchMock.mockResolvedValueOnce(json(200, { rowVersion: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e continuar' }));
    await screen.findByText('Respostas salvas');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('mantém a última pergunta como a única que salva, com o rótulo próprio', async () => {
    await renderReady();
    await chooseAll();

    expect(screen.getByText('Pergunta 4 de 4')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continuar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Salvar e continuar' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('foca a primeira pergunta ausente e não envia formulário incompleto', async () => {
    await renderReady();

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    const first = screen.getByRole('radio', { name: '1 médico' });
    expect(document.activeElement).toBe(first);
    expect(screen.getByRole('alert').textContent).toContain('Escolha uma opção para continuar');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('radiogroup', { name: 'Quantidade de médicos' })).toBeTruthy();
  });

  it('envia uma vez, bloqueia edição durante o POST e confirma o snapshot salvo', async () => {
    const pending = deferredResponse();
    fetchMock.mockResolvedValueOnce(json(200, { session: EMPTY_SESSION }));
    fetchMock.mockImplementationOnce(() => pending.promise);
    render(<SignupQuestions />);
    await screen.findByRole('heading', { name: 'Quantos médicos atendem na clínica?' });
    await chooseAll();

    const submit = screen.getByRole('button', { name: 'Salvar e continuar' });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getAllByRole('radio').every((radio) => radio.hasAttribute('disabled'))).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Outro' }));
    expect(screen.getByRole('radio', { name: 'Indicação de um colega' })).toHaveProperty(
      'checked',
      true,
    );

    const body = fetchMock.mock.calls[1]?.[1]?.body;
    expect(JSON.parse(String(body))).toEqual({ ...ANSWERS, rowVersion: 1 });
    pending.settle(json(200, { rowVersion: 2 }));

    await screen.findByText(/Respostas salvas\. A etapa de criação da conta será conectada/u);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(window.localStorage).toHaveLength(0);
  });

  it('resolve CAS perdido relendo e exibindo as respostas vencedoras', async () => {
    await renderReady();
    await chooseAll();
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

    fireEvent.click(screen.getByRole('button', { name: 'Salvar e continuar' }));

    await screen.findByText(/Outra aba salvou primeiro/u);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Respostas salvas')).toBeTruthy();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('transforma 409 seguido de 410 em reinício de sessão, não em erro de rede', async () => {
    await renderReady();
    await chooseAll();
    fetchMock
      .mockResolvedValueOnce(json(409, { error: 'conflict' }))
      .mockResolvedValueOnce(json(410, { error: 'gone' }));

    fireEvent.click(screen.getByRole('button', { name: 'Salvar e continuar' }));

    expect(await screen.findByRole('button', { name: 'Começar novamente' })).toBeTruthy();
    expect(screen.getByText(/Esta sessão expirou/u)).toBeTruthy();
  });

  it('mantém o estado pronto quando a releitura do conflito recebe 429', async () => {
    await renderReady();
    await chooseAll();
    fetchMock
      .mockResolvedValueOnce(json(409, { error: 'conflict' }))
      .mockResolvedValueOnce(json(429, { error: 'rate_limited' }));

    fireEvent.click(screen.getByRole('button', { name: 'Salvar e continuar' }));

    await screen.findByText(/a releitura atingiu o limite/u);
    expect(screen.getByRole('button', { name: 'Salvar e continuar' })).toBeTruthy();
  });

  it('distingue sessão expirada e rate limit ao salvar', async () => {
    await renderReady();
    await chooseAll();
    fetchMock.mockResolvedValueOnce(json(410, { error: 'gone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e continuar' }));
    expect(await screen.findByRole('button', { name: 'Começar novamente' })).toBeTruthy();

    cleanup();
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(json(200, { session: EMPTY_SESSION }))
      .mockResolvedValueOnce(json(429, { error: 'rate_limited' }));
    render(<SignupQuestions />);
    await screen.findByRole('heading', { name: 'Quantos médicos atendem na clínica?' });
    await chooseAll();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e continuar' }));
    await screen.findByText(/Aguarde um minuto antes de salvar/u);
    expect(screen.getByRole('radio', { name: 'Indicação de um colega' })).toHaveProperty(
      'checked',
      true,
    );
  });

  it('preserva as escolhas quando a rede falha antes da confirmação', async () => {
    await renderReady();
    await chooseAll();
    fetchMock.mockRejectedValueOnce(new TypeError('network'));

    fireEvent.click(screen.getByRole('button', { name: 'Salvar e continuar' }));

    await screen.findByText(/A conexão falhou antes da confirmação/u);
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

    await screen.findByRole('heading', { name: 'Quantos médicos atendem na clínica?' });
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
  }

  async function renderPendingOriginalTab() {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(json(200, { session: SAVED_SESSION }));
    const view = render(<SignupQuestions identityEnabled />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fillIdentity();
    fireEvent.click(screen.getByRole('checkbox'));
    fetchMock
      .mockResolvedValueOnce(json(200, { rowVersion: 3 }))
      .mockResolvedValueOnce(json(200, { rowVersion: 5 }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar confirmação por e-mail' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      screen.getByRole('heading', { name: 'Aguardando a confirmação do e-mail' }),
    ).toBeTruthy();
    return view;
  }

  function continuationCalls() {
    return fetchMock.mock.calls.filter(([url]) => url === '/api/signup/sessions/continue');
  }

  function fillRefreshedContinuation() {
    fireEvent.change(screen.getByLabelText('E-mail usado no cadastro'), {
      target: { value: 'ana@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Crie sua senha'), {
      target: { value: 'Senha1234' },
    });
    fireEvent.change(screen.getByLabelText('Código do e-mail'), {
      target: { value: '12345678' },
    });
  }

  it('após confirmar exige o código e nunca lê o draft nem avança automaticamente', async () => {
    const verifiedSession: SignupSessionState = {
      ...EMPTY_SESSION,
      status: 'email_verified',
      rowVersion: 6,
    };
    await renderPendingOriginalTab();
    fetchMock.mockResolvedValueOnce(json(200, { session: verifiedSession }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });

    expect(screen.getByRole('heading', { name: 'E-mail confirmado' })).toBeTruthy();
    expect(screen.getByLabelText('Código do e-mail')).toBeTruthy();
    expect(screen.queryByLabelText('E-mail usado no cadastro')).toBeNull();
    expect(screen.getByLabelText('Crie sua senha')).toBeTruthy();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/signup/sessions/me',
      '/api/signup/sessions/identity',
      '/api/signup/sessions/auth',
      '/api/signup/sessions/me',
    ]);
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/signup/draft')).toBe(false);
    expect(continuationCalls()).toHaveLength(0);
    expect(assignMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Código do e-mail'), {
      target: { value: '12345678' },
    });
    fireEvent.change(screen.getByLabelText('Crie sua senha'), { target: { value: 'Senha1234' } });
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(assignMock).toHaveBeenCalledWith('/cadastro/plano');
    expect(JSON.parse(String(continuationCalls()[0]?.[1]?.body))).toEqual({
      rowVersion: 6,
      email: 'ana@example.test',
      password: 'Senha1234',
      verificationCode: '12345678',
    });
  });

  it('após refresh pede e-mail, nova senha com olho e código antes de continuar', async () => {
    const verifiedSession: SignupSessionState = {
      ...EMPTY_SESSION,
      status: 'email_verified',
      rowVersion: 6,
    };
    fetchMock.mockResolvedValueOnce(json(200, { session: verifiedSession }));
    render(<SignupQuestions identityEnabled />);

    await screen.findByRole('heading', { name: 'E-mail confirmado' });
    const password = screen.getByLabelText('Crie sua senha');
    expect(screen.getByLabelText('E-mail usado no cadastro')).toBeTruthy();
    expect(password.getAttribute('type')).toBe('password');
    expect(screen.getByLabelText('Código do e-mail').getAttribute('autocomplete')).toBe(
      'one-time-code',
    );
    const confirmationCode = screen.getByLabelText(/digo do e-mail/u);
    expect(confirmationCode.getAttribute('minlength')).toBe('8');
    expect(confirmationCode.getAttribute('maxlength')).toBe('8');
    expect(confirmationCode.getAttribute('size')).toBe('8');
    expect(confirmationCode.className).toContain('text-center');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(password.getAttribute('type')).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar senha' }));
    expect(password.getAttribute('type')).toBe('password');

    fillRefreshedContinuation();
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/cadastro/plano'));
    expect(JSON.parse(String(continuationCalls()[0]?.[1]?.body))).toEqual({
      rowVersion: 6,
      email: 'ana@example.test',
      password: 'Senha1234',
      verificationCode: '12345678',
    });
  });

  it('recusa código incompleto no cliente sem chamar a continuação', async () => {
    const verifiedSession: SignupSessionState = {
      ...EMPTY_SESSION,
      status: 'email_verified',
      rowVersion: 6,
    };
    fetchMock.mockResolvedValueOnce(json(200, { session: verifiedSession }));
    render(<SignupQuestions identityEnabled />);
    await screen.findByRole('heading', { name: 'E-mail confirmado' });

    fireEvent.change(screen.getByLabelText('E-mail usado no cadastro'), {
      target: { value: 'ana@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Crie sua senha'), {
      target: { value: 'Senha1234' },
    });
    fireEvent.change(screen.getByLabelText('Código do e-mail'), {
      target: { value: '1234567' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText(/Digite os 8 dígitos/u)).toBeTruthy();
    expect(continuationCalls()).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByLabelText('Código do e-mail'));
  });

  it('código recusado mantém a continuação local e não oferece login impossível', async () => {
    const verifiedSession: SignupSessionState = {
      ...EMPTY_SESSION,
      status: 'email_verified',
      rowVersion: 6,
    };
    fetchMock.mockResolvedValueOnce(json(200, { session: verifiedSession }));
    render(<SignupQuestions identityEnabled />);
    await screen.findByRole('heading', { name: 'E-mail confirmado' });
    fillRefreshedContinuation();
    fetchMock.mockResolvedValueOnce(json(401, { error: 'unauthorized' }));

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText(/Não foi possível validar o código/u)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Entrar/u })).toBeNull();
    expect(assignMock).not.toHaveBeenCalled();
    expect(continuationCalls()).toHaveLength(1);
    expect(screen.getByLabelText('E-mail usado no cadastro')).toHaveProperty(
      'value',
      'ana@example.test',
    );
    expect(screen.getByLabelText('Crie sua senha')).toHaveProperty('value', 'Senha1234');
    expect(screen.getByLabelText('Código do e-mail')).toHaveProperty('value', '12345678');
  });

  it('senha recusada na aba original revela somente as credenciais que precisam ser refeitas', async () => {
    const verifiedSession: SignupSessionState = {
      ...EMPTY_SESSION,
      status: 'email_verified',
      rowVersion: 6,
    };
    await renderPendingOriginalTab();
    fetchMock.mockResolvedValueOnce(json(200, { session: verifiedSession }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    fireEvent.change(screen.getByLabelText('Código do e-mail'), {
      target: { value: '12345678' },
    });
    fireEvent.change(screen.getByLabelText('Crie sua senha'), { target: { value: 'Senha1234' } });
    fetchMock.mockResolvedValueOnce(json(422, { error: 'weak_password' }));

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText(/Essa senha não pode ser usada/u)).toBeTruthy();
    expect(screen.queryByLabelText('E-mail usado no cadastro')).toBeNull();
    expect(screen.getByLabelText('Crie sua senha')).toBeTruthy();
    expect(screen.getByLabelText('Código do e-mail')).toHaveProperty('value', '12345678');
    expect(screen.queryByRole('link', { name: /Entrar/u })).toBeNull();

    fireEvent.change(screen.getByLabelText('Crie sua senha'), {
      target: { value: 'OutraSenha8' },
    });
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(JSON.parse(String(continuationCalls()[1]?.[1]?.body))).toEqual({
      rowVersion: 6,
      email: 'ana@example.test',
      password: 'OutraSenha8',
      verificationCode: '12345678',
    });
    expect(assignMock).toHaveBeenCalledWith('/cadastro/plano');
  });

  it('409 relê a versão vencedora e mantém um novo envio explícito', async () => {
    const verifiedSession: SignupSessionState = {
      ...EMPTY_SESSION,
      status: 'email_verified',
      rowVersion: 6,
    };
    fetchMock.mockResolvedValueOnce(json(200, { session: verifiedSession }));
    render(<SignupQuestions identityEnabled />);
    await screen.findByRole('heading', { name: 'E-mail confirmado' });
    fillRefreshedContinuation();
    fetchMock
      .mockResolvedValueOnce(json(409, { error: 'conflict' }))
      .mockResolvedValueOnce(json(200, { session: { ...verifiedSession, rowVersion: 7 } }));

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText(/mudou em outra aba/u)).toBeTruthy();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/signup/sessions/me',
      '/api/signup/sessions/continue',
      '/api/signup/sessions/me',
    ]);
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Entrar/u })).toBeNull();
    expect(screen.getByLabelText('E-mail usado no cadastro')).toHaveProperty(
      'value',
      'ana@example.test',
    );
    expect(screen.getByLabelText('Crie sua senha')).toHaveProperty('value', 'Senha1234');
    expect(screen.getByLabelText('Código do e-mail')).toHaveProperty('value', '12345678');
  });

  it('410 encerra o handoff e 503 preserva o formulário para nova tentativa', async () => {
    const verifiedSession: SignupSessionState = {
      ...EMPTY_SESSION,
      status: 'email_verified',
      rowVersion: 6,
    };
    fetchMock.mockResolvedValueOnce(json(200, { session: verifiedSession }));
    render(<SignupQuestions identityEnabled />);
    await screen.findByRole('heading', { name: 'E-mail confirmado' });
    fillRefreshedContinuation();
    fetchMock.mockResolvedValueOnce(json(503, { error: 'unavailable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText(/Não foi possível continuar agora/u)).toBeTruthy();
    expect(assignMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: /Entrar/u })).toBeNull();

    cleanup();
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(json(200, { session: verifiedSession }))
      .mockResolvedValueOnce(json(410, { error: 'gone' }));
    render(<SignupQuestions identityEnabled />);
    await screen.findByRole('heading', { name: 'E-mail confirmado' });
    fillRefreshedContinuation();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('button', { name: 'Começar novamente' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Entrar/u })).toBeNull();
  });

  it('continua verificando depois de 27 minutos e encerra somente quando a sessão morre', async () => {
    const pendingSession: SignupSessionState = {
      ...SAVED_SESSION,
      status: 'email_pending',
      rowVersion: 5,
    };
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(json(200, { session: pendingSession }));
    render(<SignupQuestions identityEnabled />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(27 * 60 * 1_000);
    });

    // 1 bootstrap + 81 leituras: o atraso real de 27 min não pode congelar a aba.
    expect(fetchMock).toHaveBeenCalledTimes(82);
    expect(
      screen.getByRole('heading', { name: 'Aguardando a confirmação do e-mail' }),
    ).toBeTruthy();

    fetchMock.mockResolvedValueOnce(json(410, { error: 'gone' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(screen.getByRole('heading', { name: 'Vamos retomar daqui' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(83);
  });

  it('encerra a espera quando a sessão morre, sem insistir contra o limite', async () => {
    const pendingSession: SignupSessionState = {
      ...SAVED_SESSION,
      status: 'email_pending',
      rowVersion: 5,
    };
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(json(200, { session: pendingSession }));
    render(<SignupQuestions identityEnabled />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fetchMock.mockResolvedValue(json(410, { error: 'gone' }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    });

    expect(screen.getByRole('heading', { name: 'Vamos retomar daqui' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('mantém o gate fechado e só abre os dados depois das quatro respostas', async () => {
    await renderReady(SAVED_SESSION);
    expect(screen.queryByRole('textbox')).toBeNull();
    cleanup();
    await renderIdentity(identitySession);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('solicitação da conta ainda não foi');
    expect(screen.queryByRole('button', { name: 'Salvar e continuar' })).toBeNull();
    cleanup();
    fetchMock.mockResolvedValueOnce(json(200, { session: EMPTY_SESSION }));
    render(<SignupQuestions identityEnabled />);
    await screen.findByRole('heading', { name: 'Quantos médicos atendem na clínica?' });
    expect(screen.queryByRole('textbox')).toBeNull();
    await chooseAll();
    fetchMock.mockResolvedValueOnce(json(200, { rowVersion: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e continuar' }));
    await screen.findByLabelText('Seu nome');
    expect(document.activeElement).toBe(screen.getByLabelText('Seu nome'));
  });

  it('não pede senha antes de confirmar o e-mail', async () => {
    await renderIdentity();
    expect(screen.queryByLabelText('Senha')).toBeNull();
    expect(document.querySelector('input[name="password"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mostrar senha' })).toBeNull();
    expect(screen.getByText(/Você criará sua senha somente depois/u)).toBeTruthy();
  });

  it('valida os dados e o aceite antes de enviar a confirmação', async () => {
    await renderIdentity();
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByLabelText('Seu nome').getAttribute('maxlength')).toBe('120');
    expect(screen.getByLabelText('E-mail').getAttribute('maxlength')).toBe('160');
    expect(screen.getByRole('link', { name: 'Termos de Uso' }).getAttribute('href')).toBe(
      'https://qoro.dev/termos-de-uso',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enviar confirmação por e-mail' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Seu nome'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('não avança para espera se o provedor recusar o envio', async () => {
    await renderIdentity();
    fillIdentity();
    fireEvent.click(screen.getByRole('checkbox'));
    fetchMock
      .mockResolvedValueOnce(json(200, { rowVersion: 4 }))
      .mockResolvedValueOnce(json(422, { error: 'weak_password', rowVersion: 5 }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar confirmação por e-mail' }));
    await screen.findByText(/Não foi possível enviar a confirmação/u);
    expect(
      screen.queryByRole('heading', { name: 'Aguardando a confirmação do e-mail' }),
    ).toBeNull();
    expect(screen.getByLabelText('Seu nome')).toHaveProperty('value', ' Ana ');
    expect(screen.getByLabelText('E-mail')).toHaveProperty('value', 'ana@example.test');
    expect(document.querySelector('input[name="password"]')).toBeNull();
    fetchMock
      .mockResolvedValueOnce(json(200, { rowVersion: 6 }))
      .mockResolvedValueOnce(json(200, { rowVersion: 7 }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar confirmação por e-mail' }));
    await screen.findByRole('heading', { name: 'Aguardando a confirmação do e-mail' });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)).rowVersion).toBe(5);
  });

  it('salva staging e solicita confirmação sem enviar ou armazenar senha', async () => {
    await renderIdentity();
    fillIdentity();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar confirmação por e-mail' }));
    expect(document.activeElement).toBe(screen.getByRole('checkbox'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('checkbox'));
    fetchMock
      .mockResolvedValueOnce(json(200, { rowVersion: 3 }))
      .mockResolvedValueOnce(json(200, { rowVersion: 5 }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar confirmação por e-mail' }));
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
      accepted: true,
    });
    expect(screen.queryByLabelText('Senha')).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('reenvia em um clique na aba original usando apenas o e-mail em memória', async () => {
    await renderIdentity();
    fillIdentity();
    fireEvent.click(screen.getByRole('checkbox'));
    fetchMock
      .mockResolvedValueOnce(json(200, { rowVersion: 3 }))
      .mockResolvedValueOnce(json(200, { rowVersion: 5 }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar confirmação por e-mail' }));
    await screen.findByRole('heading', { name: 'Aguardando a confirmação do e-mail' });

    expect(screen.queryByLabelText('E-mail usado no cadastro')).toBeNull();
    expect(screen.queryByLabelText('Senha escolhida')).toBeNull();
    fetchMock.mockResolvedValueOnce(json(200, { rowVersion: 6 }));
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar o e-mail' }));

    await screen.findByText(/novo e-mail está a caminho/u);
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/signup/sessions/resend');
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({
      rowVersion: 5,
      email: 'ana@example.test',
    });
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
    expect(screen.queryByLabelText('Senha')).toBeNull();
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
    expect(document.activeElement).toBe(screen.getByLabelText('Seu nome'));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar confirmação por e-mail' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Seu nome'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('não pede senha após rate limit e reutiliza somente a versão confirmada do staging', async () => {
    await renderIdentity();
    fillIdentity();
    fireEvent.click(screen.getByRole('checkbox'));
    fetchMock
      .mockResolvedValueOnce(json(200, { rowVersion: 3 }))
      .mockResolvedValueOnce(json(429, { error: 'rate_limited' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar confirmação por e-mail' }));
    await screen.findByText(/Aguarde antes de solicitar a conta/u);
    expect(screen.queryByLabelText('Senha')).toBeNull();
    expect(screen.getByLabelText('Seu nome')).toHaveProperty('value', ' Ana ');

    fetchMock
      .mockResolvedValueOnce(json(200, { rowVersion: 4 }))
      .mockResolvedValueOnce(json(200, { rowVersion: 6 }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar confirmação por e-mail' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Enviar confirmação por e-mail' }));
    await screen.findByRole('heading', { name: 'Aguardando a confirmação do e-mail' });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/signup/sessions/me',
      '/api/signup/sessions/identity',
      '/api/signup/sessions/auth',
      '/api/signup/sessions/me',
    ]);
    expect(screen.getByText(/Não repetimos automaticamente/u)).toBeTruthy();
  });

  it('reenvio é discreto e pede somente o e-mail quando a aba foi recarregada', async () => {
    const pendingSession: SignupSessionState = {
      ...identitySession,
      status: 'email_pending',
      rowVersion: 5,
    };
    fetchMock.mockResolvedValueOnce(json(200, { session: pendingSession }));
    render(<SignupQuestions identityEnabled />);
    await screen.findByRole('heading', { name: 'Aguardando a confirmação do e-mail' });

    // A tela de espera abre SÓ com a espera: nada de formulário à mostra.
    expect(screen.queryByLabelText('Senha')).toBeNull();
    expect(screen.queryByLabelText('E-mail usado no cadastro')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();

    // Esta aba foi recarregada (o e-mail só vive em memória, nunca no servidor),
    // então o primeiro clique pede o endereço em vez de tentar um envio cego.
    fireEvent.click(screen.getByRole('button', { name: 'Não recebeu? Reenviar o e-mail' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(await screen.findByLabelText('E-mail usado no cadastro'), {
      target: { value: 'ana@example.test' },
    });
    expect(screen.queryByLabelText('Senha escolhida')).toBeNull();
    expect(screen.queryByLabelText('Crie sua senha')).toBeNull();
    fetchMock.mockResolvedValueOnce(json(200, { rowVersion: 7 }));
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar o e-mail' }));

    await screen.findByText(/novo e-mail está a caminho/u);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/signup/sessions/resend');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      rowVersion: 5,
      email: 'ana@example.test',
    });
  });
});
