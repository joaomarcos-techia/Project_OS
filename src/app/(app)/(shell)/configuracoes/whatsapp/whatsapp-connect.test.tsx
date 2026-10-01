// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { WhatsappStatusDTO } from './data';

const mocks = vi.hoisted(() => ({
  connectWhatsappAction: vi.fn(),
  disconnectWhatsappAction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('next/script', async () => {
  const React = await import('react');
  function MockScript({ onLoad }: { onLoad?: () => void }) {
    React.useEffect(() => {
      onLoad?.();
    }, [onLoad]);
    return null;
  }
  return {
    default: MockScript,
  };
});
vi.mock('./actions', () => ({
  connectWhatsappAction: mocks.connectWhatsappAction,
  disconnectWhatsappAction: mocks.disconnectWhatsappAction,
}));

import { WhatsappConnect } from './whatsapp-connect';

const status: WhatsappStatusDTO = {
  connected: false,
  hasActiveNumber: false,
  degraded: false,
  phoneNumberMasked: null,
  connectionStatus: null,
  verifiedAt: null,
  coexistence: false,
  health: { verdict: 'indeterminate', messages: [] },
};

/** Dispara um postMessage do Embedded Signup vindo de uma origem confiável. */
function postSignupMessage(payload: Record<string, unknown>) {
  const event = new MessageEvent('message', { data: JSON.stringify(payload) });
  Object.defineProperty(event, 'origin', { value: 'https://www.facebook.com' });
  fireEvent(window, event);
}

type FbLoginResult = { authResponse?: { code?: string } | null };

/**
 * Renderiza a tela desconectada, preenche o PIN e, por padrão, já dispara o
 * Embedded Signup.
 *
 * `login` executa o callback do SDK da tentativa ATUAL; `loginOfAttempt` executa
 * o de uma tentativa anterior (chegada atrasada). `advance` avança os timers —
 * exige `vi.useFakeTimers()` no teste. `attempts()` conta quantas vezes o
 * `FB.login` foi realmente chamado, que é a prova do single-flight.
 */
function startSignup({ autoLaunch = true }: { autoLaunch?: boolean } = {}) {
  const callbacks: Array<(response: FbLoginResult) => void> = [];
  window.FB = {
    init: vi.fn(),
    login: vi.fn((callback) => {
      callbacks.push(callback);
    }),
  };

  render(
    <WhatsappConnect
      status={status}
      appId="app-id"
      configId="config-id"
      graphVersion="v23.0"
      ready={true}
    />,
  );

  fireEvent.change(screen.getByLabelText(/PIN de ativação do WhatsApp/), {
    target: { value: '123456' },
  });

  const connectButton = () => screen.getByRole('button', { name: /Conectar WhatsApp/ });
  const api = {
    /** Clica em conectar, mesmo que o botão esteja desabilitado na tela. */
    clickConnect: () => {
      fireEvent.click(connectButton());
      return api;
    },
    button: connectButton,
    /**
     * Dois cliques no MESMO `act`: o React não re-renderiza entre eles, então o
     * atributo `disabled` ainda não foi aplicado quando o segundo dispara. É o
     * único jeito de provar a guarda programática em vez da guarda visual.
     */
    doubleClickConnect: () => {
      const btn = connectButton();
      act(() => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      return api;
    },
    /** Callback do SDK roda fora do React: `act` garante o flush do setState. */
    login: (response: FbLoginResult) => {
      act(() => callbacks[callbacks.length - 1]?.(response));
    },
    /** Executa o callback de uma tentativa ANTERIOR (chegada atrasada). */
    loginOfAttempt: (index: number, response: FbLoginResult) => {
      act(() => callbacks[index]?.(response));
    },
    attempts: () => callbacks.length,
    /** Avança além das janelas de tolerância/quiescência; exige timers falsos. */
    advance: (ms = 10_000) => {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    },
  };
  if (autoLaunch) api.clickConnect();
  return api;
}

const alertText = () => screen.getByRole('alert').textContent ?? '';

afterEach(() => {
  cleanup();
  // Depois do unmount: nenhum timer da janela de tolerância pode continuar vivo.
  if (vi.isFakeTimers()) {
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  }
  mocks.connectWhatsappAction.mockReset();
  mocks.disconnectWhatsappAction.mockReset();
  mocks.refresh.mockReset();
  delete window.FB;
});

describe('WhatsappConnect', () => {
  it('não fica conectando nem chama o servidor quando o Embedded Signup é cancelado', () => {
    let loginCallback:
      | ((response: { authResponse?: { code?: string } | null }) => void)
      | undefined;
    window.FB = {
      init: vi.fn(),
      login: vi.fn((callback) => {
        loginCallback = callback;
      }),
    };

    render(
      <WhatsappConnect
        status={status}
        appId="app-id"
        configId="config-id"
        graphVersion="v23.0"
        ready={true}
      />,
    );

    fireEvent.change(screen.getByLabelText(/PIN de ativação do WhatsApp/), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Conectar WhatsApp' }));
    loginCallback?.({ authResponse: { code: 'oauth-code' } });

    const cancelEvent = new MessageEvent('message', {
      data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL' }),
    });
    Object.defineProperty(cancelEvent, 'origin', { value: 'https://www.facebook.com' });
    fireEvent(window, cancelEvent);

    expect(mocks.connectWhatsappAction).not.toHaveBeenCalled();
    expect(screen.getByText('Conexão cancelada. Nenhuma alteração foi feita.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Código: CANCELLED');
    expect(screen.getByRole('button', { name: 'Conectar WhatsApp' })).toBeTruthy();
  });

  // ==== D78 — a tela precisa parar de chamar tudo de "cancelamento" ==========

  // --- Corrida entre o callback do FB.login e o postMessage do pop-up -------
  // Os dois canais são independentes; nenhuma ordem pode produzir diagnóstico
  // errado. Timers falsos porque o veredito de "sem code" espera uma janela.

  it('D78 ordem 2: FINISH antes do callback com code → conecta', async () => {
    mocks.connectWhatsappAction.mockResolvedValueOnce({ ok: true, data: { connected: true } });
    const signup = startSignup();
    postSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data: { waba_id: 'waba-id', phone_number_id: 'phone-id' },
    });
    signup.login({ authResponse: { code: 'oauth-code' } });

    await waitFor(() => expect(mocks.connectWhatsappAction).toHaveBeenCalledTimes(1));
    expect(mocks.connectWhatsappAction).toHaveBeenCalledWith({
      code: 'oauth-code',
      mode: 'cloud_api',
      registrationPin: '123456',
      wabaId: 'waba-id',
      phoneNumberId: 'phone-id',
    });
  });

  it('D78 ordem 5: callback sem code e nenhum evento → SIGNUP_NOT_STARTED', () => {
    vi.useFakeTimers();
    const signup = startSignup();

    // Foi exatamente o incidente: o diálogo OAuth recusou e nenhum
    // WA_EMBEDDED_SIGNUP chegou.
    signup.login({ authResponse: null });
    // Antes da janela fechar não há veredito — a tela não acusa nada ainda.
    expect(screen.queryByRole('alert')).toBeNull();
    signup.advance();

    expect(mocks.connectWhatsappAction).not.toHaveBeenCalled();
    expect(alertText()).toContain('Código: SIGNUP_NOT_STARTED');
    expect(alertText()).toContain('nenhum evento do Embedded Signup chegou');
    // Não inventa qual aviso a Meta exibiu dentro do pop-up cross-origin.
    expect(alertText()).not.toContain('Recurso indisponível');
    expect(screen.queryByText('Conexão cancelada. Nenhuma alteração foi feita.')).toBeNull();
  });

  it('D78 ordem 3: callback sem code e FINISH depois → AUTHORIZATION_MISSING', () => {
    vi.useFakeTimers();
    const signup = startSignup();

    signup.login({ authResponse: null });
    postSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data: { waba_id: 'waba-id', phone_number_id: 'phone-id' },
    });

    expect(alertText()).toContain('Código: AUTHORIZATION_MISSING');
    expect(mocks.connectWhatsappAction).not.toHaveBeenCalled();
    // O timer foi cancelado: a janela não pode reescrever o veredito depois.
    signup.advance();
    expect(alertText()).toContain('Código: AUTHORIZATION_MISSING');
  });

  it('D78 ordem 4: FINISH antes do callback sem code → AUTHORIZATION_MISSING', () => {
    vi.useFakeTimers();
    const signup = startSignup();

    postSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data: { waba_id: 'waba-id', phone_number_id: 'phone-id' },
    });
    signup.login({ authResponse: null });

    expect(alertText()).toContain('Código: AUTHORIZATION_MISSING');
    signup.advance();
    expect(alertText()).toContain('Código: AUTHORIZATION_MISSING');
  });

  it('D78 ordem 6: callback sem code e CANCEL depois → CANCELLED, sem virar não-iniciado', () => {
    vi.useFakeTimers();
    const signup = startSignup();

    signup.login({ authResponse: null });
    postSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'CANCEL',
      data: { current_step: 'PHONE_NUMBER_SETUP' },
    });

    expect(alertText()).toContain('Código: CANCELLED');
    signup.advance();
    expect(alertText()).toContain('Código: CANCELLED');
    expect(alertText()).not.toContain('SIGNUP_NOT_STARTED');
  });

  it('D78 ordem 7: CANCEL antes do callback sem code → CANCELLED preservado', () => {
    vi.useFakeTimers();
    const signup = startSignup();

    postSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'CANCEL',
      data: { current_step: 'PHONE_NUMBER_SETUP' },
    });
    signup.login({ authResponse: null });
    signup.advance();

    expect(mocks.connectWhatsappAction).not.toHaveBeenCalled();
    expect(alertText()).toContain('Código: CANCELLED');
  });

  it.each([
    ['CANCEL antes do callback', true],
    ['CANCEL depois do callback', false],
  ])('D78 ordem 8: erro reportado é META_SIGNUP_ERROR (%s)', (_label, eventFirst) => {
    vi.useFakeTimers();
    const signup = startSignup();
    const send = () =>
      postSignupMessage({
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'CANCEL',
        data: {
          error_message: '<img src=x onerror=alert(1)> texto cross-origin da Meta',
          error_code: '  2534<>001  ',
          session_id: 'sessao-privada',
        },
      });

    if (eventFirst) send();
    signup.login({ authResponse: null });
    if (!eventFirst) send();
    signup.advance();

    expect(alertText()).toContain('Código: META_SIGNUP_ERROR');
    expect(alertText()).toContain('Referência da Meta: 2534001');
    // Texto e identificadores cross-origin não são reproduzidos na tela.
    expect(alertText()).not.toContain('onerror');
    expect(alertText()).not.toContain('sessao-privada');
    expect(alertText()).not.toContain('cancelada');
    expect(mocks.connectWhatsappAction).not.toHaveBeenCalled();
  });

  it('D78 ordem 8b: evento ERROR também é falha da Meta, em qualquer ordem', () => {
    vi.useFakeTimers();
    const signup = startSignup();

    // `ERROR` aparece na enum oficial de <FLOW_FINISH_TYPE>; suportado junto
    // com o formato `CANCEL` + error_message de outra página oficial.
    postSignupMessage({ type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR' });
    signup.login({ authResponse: null });
    signup.advance();

    expect(alertText()).toContain('Código: META_SIGNUP_ERROR');
  });

  // --- Single-flight: uma tentativa por vez ---------------------------------
  // O `postMessage` do Embedded Signup NÃO carrega correlação com a tentativa,
  // então a única contenção possível é não deixar duas se sobreporem.

  it('D78 single-flight: clique duplo chama FB.login exatamente uma vez', () => {
    vi.useFakeTimers();
    const signup = startSignup({ autoLaunch: false });

    signup.doubleClickConnect();

    // Guarda programática: os dois handlers rodaram no mesmo `act`, sem
    // re-render entre eles, logo o `disabled` não é o que barrou o segundo.
    expect(signup.attempts()).toBe(1);
  });

  it('D78 single-flight: tentativa em curso desabilita PIN e botão', () => {
    vi.useFakeTimers();
    const signup = startSignup();

    const pin = screen.getByLabelText(/PIN de ativação do WhatsApp/) as HTMLInputElement;
    expect(pin.disabled).toBe(true);
    expect(signup.button().hasAttribute('disabled')).toBe(true);

    // Nova tentativa continua bloqueada mesmo forçando o clique.
    signup.clickConnect();
    expect(signup.attempts()).toBe(1);
  });

  it('D78 single-flight: callback sem code com janela pendente impede relançamento', () => {
    vi.useFakeTimers();
    const signup = startSignup();

    signup.login({ authResponse: null });
    // Ainda sem veredito: a janela de tolerância está contando.
    expect(screen.queryByRole('alert')).toBeNull();

    signup.clickConnect();
    expect(signup.attempts()).toBe(1);

    // Só depois do veredito E da quiescência o fluxo é liberado.
    signup.advance();
    expect(alertText()).toContain('Código: SIGNUP_NOT_STARTED');
    signup.clickConnect();
    expect(signup.attempts()).toBe(2);
  });

  it('D78 single-flight: CANCEL antes do callback trava até o callback + quiescência', () => {
    vi.useFakeTimers();
    const signup = startSignup();

    postSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'CANCEL',
      data: { current_step: 'PHONE_NUMBER_SETUP' },
    });
    expect(alertText()).toContain('Código: CANCELLED');

    // Desfecho conhecido, mas o canal do SDK ainda não ficou quiescente: o
    // pop-up pode continuar aberto e falando.
    signup.advance();
    signup.clickConnect();
    expect(signup.attempts()).toBe(1);

    // Callback retorna: o segundo canal fecha. O motivo original não é
    // sobrescrito pelo callback atrasado.
    signup.login({ authResponse: null });
    expect(alertText()).toContain('Código: CANCELLED');

    // Só com os dois canais quiescentes o fluxo libera.
    signup.advance();
    signup.clickConnect();
    expect(signup.attempts()).toBe(2);
    // Tentativa nova começa limpa: o erro anterior sai da tela.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('D78 single-flight: callback atrasado da tentativa anterior não afeta a próxima', () => {
    vi.useFakeTimers();
    const signup = startSignup();

    // 1ª tentativa termina e libera o fluxo.
    signup.login({ authResponse: null });
    signup.advance();
    expect(alertText()).toContain('Código: SIGNUP_NOT_STARTED');

    // 2ª tentativa começa e recebe um FINISH válido.
    mocks.connectWhatsappAction.mockResolvedValueOnce({ ok: true, data: { connected: true } });
    signup.clickConnect();
    expect(signup.attempts()).toBe(2);
    postSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data: { waba_id: 'waba-2', phone_number_id: 'phone-2' },
    });

    // Callback ATRASADO da 1ª tentativa chega agora: `attempt.id` o descarta.
    signup.loginOfAttempt(0, { authResponse: null });
    expect(mocks.connectWhatsappAction).not.toHaveBeenCalled();

    // A 2ª tentativa segue íntegra com os ids do SEU evento.
    signup.login({ authResponse: { code: 'code-2' } });
    expect(mocks.connectWhatsappAction).toHaveBeenCalledTimes(1);
    expect(mocks.connectWhatsappAction).toHaveBeenCalledWith({
      code: 'code-2',
      mode: 'cloud_api',
      registrationPin: '123456',
      wabaId: 'waba-2',
      phoneNumberId: 'phone-2',
    });
  });

  it('D78 single-flight: postMessage fora da fase ativa é descartado', () => {
    vi.useFakeTimers();
    const signup = startSignup();

    // (a) durante a quiescência, com o desfecho já conhecido.
    signup.login({ authResponse: null });
    signup.advance(2_000); // grace (1,5 s) disparou; quiescência (3 s) ainda não.
    expect(alertText()).toContain('Código: SIGNUP_NOT_STARTED');
    postSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data: { waba_id: 'waba-tardia', phone_number_id: 'phone-tardio' },
    });
    expect(mocks.connectWhatsappAction).not.toHaveBeenCalled();
    expect(alertText()).toContain('Código: SIGNUP_NOT_STARTED');

    // (b) já liberado, mas sem tentativa em curso.
    signup.advance();
    postSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data: { waba_id: 'waba-tardia', phone_number_id: 'phone-tardio' },
    });
    expect(mocks.connectWhatsappAction).not.toHaveBeenCalled();
  });

  /**
   * D78 — deadlock em `closing`. O desfecho chega pelo `postMessage`, a
   * tentativa entra em `closing`, e o callback do `FB.login` NUNCA retorna
   * (janela morta pelo sistema). Como a liberação exige `callbackReturned`, o
   * abandono precisa continuar valendo também nessa fase, senão a tela fica
   * travada até um reload.
   */
  describe('D78 escape de `closing` quando o callback nunca retorna', () => {
    const terminalEvents = [
      [
        'CANCEL',
        'CANCELLED',
        { type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data: { current_step: 'PHONE_SETUP' } },
      ],
      [
        'ERROR',
        'META_SIGNUP_ERROR',
        { type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR', data: { error_code: '2534001' } },
      ],
      [
        'FINISH sem waba_id',
        'SIGNUP_INCOMPLETE',
        { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { phone_number_id: 'phone-1' } },
      ],
    ] as const;

    it.each(terminalEvents)(
      '%s + callback ausente: destrava em 10 min preservando %s',
      (_label, expectedCode, payload) => {
        vi.useFakeTimers();
        const signup = startSignup();

        postSignupMessage(payload);
        expect(alertText()).toContain(`Código: ${expectedCode}`);

        // Sem o escape, aqui a tela ficaria travada para sempre.
        signup.advance(20_000);
        signup.clickConnect();
        expect(signup.attempts()).toBe(1);

        signup.advance(11 * 60_000);

        // O desfecho original NÃO é substituído por SIGNUP_TIMED_OUT.
        expect(alertText()).toContain(`Código: ${expectedCode}`);
        expect(alertText()).not.toContain('SIGNUP_TIMED_OUT');

        // PIN e botão liberados, e o FB.login volta a ser permitido UMA vez.
        const pin = screen.getByLabelText(/PIN de ativação do WhatsApp/) as HTMLInputElement;
        expect(pin.disabled).toBe(false);
        expect(signup.button().hasAttribute('disabled')).toBe(false);
        signup.doubleClickConnect();
        expect(signup.attempts()).toBe(2);

        // Nenhum desses caminhos chega ao servidor.
        expect(mocks.connectWhatsappAction).not.toHaveBeenCalled();
      },
    );

    it('timer da tentativa antiga não destrava nem suja a tentativa seguinte', () => {
      vi.useFakeTimers();
      const signup = startSignup();

      // 1ª tentativa: CANCEL e callback ausente → destrava só pelo abandono.
      postSignupMessage({
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'CANCEL',
        data: { current_step: 'PHONE_SETUP' },
      });
      signup.advance(11 * 60_000);
      signup.clickConnect();
      expect(signup.attempts()).toBe(2);

      // Callback atrasado da 1ª chega agora: não pode escrever nada.
      signup.loginOfAttempt(0, { authResponse: null });
      expect(screen.queryByRole('alert')).toBeNull();

      // A 2ª tentativa segue íntegra e com o seu próprio ciclo de vida.
      mocks.connectWhatsappAction.mockResolvedValueOnce({ ok: true, data: { connected: true } });
      postSignupMessage({
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'FINISH',
        data: { waba_id: 'waba-2', phone_number_id: 'phone-2' },
      });
      signup.login({ authResponse: { code: 'code-2' } });
      expect(mocks.connectWhatsappAction).toHaveBeenCalledTimes(1);
      expect(mocks.connectWhatsappAction).toHaveBeenCalledWith({
        code: 'code-2',
        mode: 'cloud_api',
        registrationPin: '123456',
        wabaId: 'waba-2',
        phoneNumberId: 'phone-2',
      });
    });

    /**
     * O abandono destrava a FASE mesmo com a Server Action em curso — mas o
     * `pending` da transição continua travando PIN e botões. É isso que impede
     * que uma resposta atrasada encontre uma tentativa mais nova: enquanto a
     * action não responde, nenhuma outra tentativa começa, e quando ela
     * responde a transição já terminou.
     */
    it('Server Action em curso impede nova tentativa mesmo após o abandono destravar a fase', async () => {
      vi.useFakeTimers();
      let resolveAction: ((r: { ok: false; code: string; message: string }) => void) | undefined;
      mocks.connectWhatsappAction.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveAction = resolve;
          }),
      );

      const signup = startSignup();
      signup.login({ authResponse: { code: 'code-1' } });
      postSignupMessage({
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'FINISH',
        data: { waba_id: 'waba-1', phone_number_id: 'phone-1' },
      });
      expect(mocks.connectWhatsappAction).toHaveBeenCalledTimes(1);

      // Abandono destrava a fase, sem tocar no estado da conexão em curso.
      signup.advance(11 * 60_000);
      expect(screen.queryByRole('alert')).toBeNull();

      // Ainda assim nenhuma tentativa nova começa: `pending` mantém a trava.
      const pin = screen.getByLabelText(/PIN de ativação do WhatsApp/) as HTMLInputElement;
      expect(pin.disabled).toBe(true);
      expect(signup.button().hasAttribute('disabled')).toBe(true);
      signup.clickConnect();
      signup.doubleClickConnect();
      expect(signup.attempts()).toBe(1);

      // A resposta chega para a MESMA tentativa e é exibida normalmente.
      await act(async () => {
        resolveAction?.({ ok: false, code: 'META_AUTH_FAILED', message: 'recusa da Meta' });
      });
      expect(alertText()).toContain('recusa da Meta');
      expect(mocks.refresh).not.toHaveBeenCalled();

      // Só depois de a transição terminar o fluxo volta a aceitar tentativa.
      signup.clickConnect();
      expect(signup.attempts()).toBe(2);
    });

    it('desmonte durante `closing` não deixa timer vivo', () => {
      vi.useFakeTimers();
      startSignup();
      postSignupMessage({
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'CANCEL',
        data: { current_step: 'PHONE_SETUP' },
      });
      // Quiescência e abandono pendentes; o `afterEach` exige zero após unmount.
      expect(vi.getTimerCount()).toBe(2);
    });
  });

  it('D78 single-flight: abandono libera o fluxo com desfecho próprio', () => {
    vi.useFakeTimers();
    const signup = startSignup();

    // O SDK nunca chama o callback (pop-up morto pelo sistema).
    signup.advance(11 * 60_000);

    expect(alertText()).toContain('Código: SIGNUP_TIMED_OUT');
    signup.clickConnect();
    expect(signup.attempts()).toBe(2);
  });

  it('D78: janela de tolerância pendente não sobrevive ao desmonte', () => {
    vi.useFakeTimers();
    const signup = startSignup();

    signup.login({ authResponse: null });
    // Dois timers vivos: a janela de tolerância e o abandono. São justamente os
    // que não podem vazar.
    expect(vi.getTimerCount()).toBe(2);

    // O `afterEach` desmonta e exige `getTimerCount() === 0`: sem o cleanup do
    // efeito, o timer dispararia `setError` em componente já removido.
  });

  it('D78: FINISH sem waba_id não chama o servidor — falha específica na tela', () => {
    const signup = startSignup();
    signup.login({ authResponse: { code: 'oauth-code' } });
    postSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data: { phone_number_id: 'phone-id' },
    });

    expect(mocks.connectWhatsappAction).not.toHaveBeenCalled();
    expect(alertText()).toContain('Código: SIGNUP_INCOMPLETE');
  });

  it('D78: FINISH_ONLY_WABA conecta com a WABA do evento e sem número', async () => {
    mocks.connectWhatsappAction.mockResolvedValueOnce({ ok: true, data: { connected: true } });
    const signup = startSignup();
    signup.login({ authResponse: { code: 'oauth-code' } });
    postSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH_ONLY_WABA',
      data: { waba_id: 'waba-id' },
    });

    await waitFor(() => expect(mocks.connectWhatsappAction).toHaveBeenCalledTimes(1));
    expect(mocks.connectWhatsappAction).toHaveBeenCalledWith({
      code: 'oauth-code',
      mode: 'cloud_api',
      registrationPin: '123456',
      wabaId: 'waba-id',
      phoneNumberId: undefined,
    });
  });

  it('D78: FINISH envia os ids do evento oficial com os nomes do contrato', async () => {
    mocks.connectWhatsappAction.mockResolvedValueOnce({ ok: true, data: { connected: true } });
    const signup = startSignup();
    signup.login({ authResponse: { code: 'oauth-code' } });
    postSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data: { waba_id: 'waba-id', phone_number_id: 'phone-id' },
    });

    await waitFor(() => expect(mocks.connectWhatsappAction).toHaveBeenCalledTimes(1));
    expect(mocks.connectWhatsappAction).toHaveBeenCalledWith({
      code: 'oauth-code',
      mode: 'cloud_api',
      registrationPin: '123456',
      wabaId: 'waba-id',
      phoneNumberId: 'phone-id',
    });
  });

  it('D78: mensagem de origem não confiável é ignorada', () => {
    vi.useFakeTimers();
    const signup = startSignup();
    const hostile = new MessageEvent('message', {
      data: JSON.stringify({
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'FINISH',
        data: { waba_id: 'waba-do-atacante' },
      }),
    });
    Object.defineProperty(hostile, 'origin', { value: 'https://evil-facebook.com' });
    fireEvent(window, hostile);
    signup.login({ authResponse: { code: 'oauth-code' } });

    expect(mocks.connectWhatsappAction).not.toHaveBeenCalled();
    // Nenhum evento válido chegou: o diagnóstico é "não começou", não "cancelou".
    signup.login({ authResponse: null });
    signup.advance();
    expect(alertText()).toContain('Código: SIGNUP_NOT_STARTED');
  });

  it('associa o PIN à ajuda, aceita apenas dígitos e anuncia o loading da conexão', async () => {
    let loginCallback:
      | ((response: { authResponse?: { code?: string } | null }) => void)
      | undefined;
    let finishConnection: ((result: { ok: true; data: { connected: true } }) => void) | undefined;
    window.FB = {
      init: vi.fn(),
      login: vi.fn((callback) => {
        loginCallback = callback;
      }),
    };
    mocks.connectWhatsappAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishConnection = resolve;
        }),
    );

    render(
      <WhatsappConnect
        status={status}
        appId="app-id"
        configId="config-id"
        graphVersion="v23.0"
        ready={true}
      />,
    );

    const pin = screen.getByLabelText(/PIN de ativação do WhatsApp/) as HTMLInputElement;
    expect(pin.required).toBe(true);
    expect(pin.getAttribute('aria-describedby')).toBe('whatsapp-registration-pin-help');
    expect(document.getElementById('whatsapp-registration-pin-help')?.textContent).toContain(
      'não é salvo pela Qoro',
    );

    fireEvent.change(pin, { target: { value: '12a34b56' } });
    expect(pin.value).toBe('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Conectar WhatsApp' }));
    loginCallback?.({ authResponse: { code: 'oauth-code' } });

    const finishEvent = new MessageEvent('message', {
      data: JSON.stringify({
        type: 'WA_EMBEDDED_SIGNUP',
        event: 'FINISH',
        data: { waba_id: 'waba-id', phone_number_id: 'phone-id' },
      }),
    });
    Object.defineProperty(finishEvent, 'origin', { value: 'https://www.facebook.com' });
    fireEvent(window, finishEvent);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Conectar WhatsApp' }).getAttribute('aria-busy'),
      ).toBe('true');
      expect(screen.getByRole('status').textContent).toContain('Conectando o WhatsApp');
    });

    await act(async () => {
      finishConnection?.({ ok: true, data: { connected: true } });
    });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });

  it('mostra a tela desconectada logo após a action, sem aguardar o refresh da rota', async () => {
    mocks.disconnectWhatsappAction.mockResolvedValueOnce({
      ok: true,
      data: { disconnected: true },
    });

    render(
      <WhatsappConnect
        status={{ ...status, connected: true }}
        appId="app-id"
        configId="config-id"
        graphVersion="v23.0"
        ready={true}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));

    await waitFor(() => {
      expect(screen.getByText('Conecte o WhatsApp da clínica')).toBeTruthy();
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Desconectando…' })).toBeNull();
  });

  it('META-001: canal inoperante NÃO é exibido como ativo nem como nunca conectado', async () => {
    // O achado: WABA sem app inscrito, banco `connected`, tela dizendo "Ativo".
    // A tela precisa dizer que as mensagens não chegam — e continuar mostrando
    // que existe uma conexão, senão o operador só vê um convite para conectar.
    render(
      <WhatsappConnect
        status={{
          ...status,
          connected: false,
          hasActiveNumber: true,
          degraded: true,
          phoneNumberMasked: '+55 ****-1234',
          connectionStatus: 'failed',
          health: {
            verdict: 'broken',
            messages: ['A Meta não está entregando mensagens para o ClinicaOS.'],
          },
        }}
        appId="app-id"
        configId="config-id"
        graphVersion="v23.0"
        ready={true}
      />,
    );

    expect(screen.getByText('WhatsApp com problema')).toBeTruthy();
    expect(screen.getByText('A Meta não está entregando mensagens para o ClinicaOS.')).toBeTruthy();
    expect(screen.queryByText('WhatsApp conectado')).toBeNull();
    expect(screen.queryByText('Conecte o WhatsApp da clínica')).toBeNull();
    // A reconexão continua disponível, e desconectar também.
    expect(screen.getByRole('button', { name: 'Desconectar' })).toBeTruthy();
  });

  it('META-001: sonda indisponível preserva o estado anterior e expõe todos os avisos', () => {
    render(
      <WhatsappConnect
        status={{
          ...status,
          connected: true,
          hasActiveNumber: true,
          connectionStatus: 'connected',
          health: {
            verdict: 'indeterminate',
            messages: [
              'Não foi possível confirmar o estado da conexão com a Meta agora.',
              'A última sonda excedeu o tempo de resposta.',
            ],
          },
        }}
        appId="app-id"
        configId="config-id"
        graphVersion="v23.0"
        ready={true}
      />,
    );

    expect(screen.getByText('WhatsApp conectado')).toBeTruthy();
    expect(screen.getByText('Verificação pendente')).toBeTruthy();
    expect(screen.getByText('A última sonda excedeu o tempo de resposta.')).toBeTruthy();
    expect(screen.getByText(/última verificação bem-sucedida/u)).toBeTruthy();
  });

  it('expõe o estado indisponível sem pedir um PIN que não pode ser usado', () => {
    render(
      <WhatsappConnect
        status={status}
        appId={null}
        configId={null}
        graphVersion="v23.0"
        ready={false}
      />,
    );

    const region = screen.getByRole('region', { name: 'Conecte o WhatsApp da clínica' });
    expect(region.getAttribute('data-whatsapp-state')).toBe('disconnected');
    expect(screen.getByText('Indisponível')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Conexão automática indisponível');
    expect(screen.queryByLabelText(/PIN de ativação do WhatsApp/)).toBeNull();
  });

  it('mantém a falha de health visível quando a reconexão automática está indisponível', () => {
    render(
      <WhatsappConnect
        status={{
          ...status,
          hasActiveNumber: true,
          degraded: true,
          phoneNumberMasked: '+55 ****-1234',
          connectionStatus: 'failed',
          health: {
            verdict: 'broken',
            messages: ['A autorização do WhatsApp expirou ou foi revogada na Meta.'],
          },
        }}
        appId={null}
        configId={null}
        graphVersion="v23.0"
        ready={false}
      />,
    );

    expect(screen.getByText('WhatsApp com problema')).toBeTruthy();
    expect(
      screen.getByText('A autorização do WhatsApp expirou ou foi revogada na Meta.'),
    ).toBeTruthy();
    expect(screen.getByText('Reconexão automática indisponível')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Desconectar' })).toBeTruthy();
    expect(screen.queryByLabelText(/PIN de ativação do WhatsApp/)).toBeNull();
  });

  it('remove o loading e mostra erro quando a action de desconectar falha na rede', async () => {
    mocks.disconnectWhatsappAction.mockRejectedValueOnce(new Error('network unavailable'));

    render(
      <WhatsappConnect
        status={{ ...status, connected: true }}
        appId="app-id"
        configId="config-id"
        graphVersion="v23.0"
        ready={true}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));

    await waitFor(() => {
      expect(
        screen.getByText('Não foi possível desconectar o WhatsApp. Tente novamente.'),
      ).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Desconectar' })).toBeTruthy();
  });

  // ==== Embedded Signup v4 ===================================================

  it('abre o Embedded Signup no formato v4: `extras` só com `setup`', () => {
    // O v2 (`sessionInfoVersion: '3'`) é descontinuado pela Meta em 15/10/2026.
    const login = vi.fn();
    window.FB = { init: vi.fn(), login };
    render(
      <WhatsappConnect
        status={status}
        appId="app-id"
        configId="config-v4"
        graphVersion="v23.0"
        ready={true}
      />,
    );
    fireEvent.change(screen.getByLabelText(/PIN de ativação do WhatsApp/), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Conectar WhatsApp' }));

    expect(login).toHaveBeenCalledTimes(1);
    expect(login.mock.calls[0]?.[1]).toEqual({
      config_id: 'config-v4',
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {} },
    });
  });

  it('não reintroduz estilos inline nem as classes legadas da tela', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/(shell)/configuracoes/whatsapp/whatsapp-connect.tsx'),
      'utf8',
    );

    expect(source).not.toContain('style={{');
    expect(source).not.toMatch(/className="(?:page-head|ph-|panel|badge |btn)/u);
    expect(source).toContain('<PageHeader');
    expect(source).toContain('<Card');
    expect(source).toContain('<Alert');
  });
});

// ==== Coexistência (0107) — conectar o app WhatsApp Business já em uso ========

describe('WhatsappConnect — coexistência', () => {
  function launchBusinessApp() {
    let loginCallback: ((response: FbLoginResult) => void) | undefined;
    const login = vi.fn((callback: (response: FbLoginResult) => void, _opts: unknown) => {
      loginCallback = callback;
    });
    window.FB = { init: vi.fn(), login };
    render(
      <WhatsappConnect
        status={status}
        appId="app-id"
        configId="config-v4"
        graphVersion="v23.0"
        ready={true}
      />,
    );
    // Sem preencher PIN: a coexistência não usa.
    fireEvent.click(screen.getByRole('button', { name: 'Conectar meu WhatsApp Business' }));
    return { login, callback: (r: FbLoginResult) => loginCallback?.(r) };
  }

  it('abre a Meta com o featureType da coexistência e sem exigir PIN', () => {
    const { login } = launchBusinessApp();

    expect(login).toHaveBeenCalledTimes(1);
    expect(login.mock.calls[0]?.[1]).toEqual({
      config_id: 'config-v4',
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding' },
    });
  });

  it('FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING conecta em modo coexistência, sem PIN', async () => {
    mocks.connectWhatsappAction.mockResolvedValueOnce({
      ok: true,
      data: { id: 'num-1', phoneNumberMasked: '+55 ** *****-1234' },
    });
    const signup = launchBusinessApp();

    postSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
      data: { waba_id: 'waba-app' },
    });
    signup.callback({ authResponse: { code: 'oauth-code' } });

    await waitFor(() => expect(mocks.connectWhatsappAction).toHaveBeenCalledTimes(1));
    expect(mocks.connectWhatsappAction).toHaveBeenCalledWith({
      code: 'oauth-code',
      mode: 'coexistence',
      wabaId: 'waba-app',
      phoneNumberId: undefined,
    });
  });

  it('número novo escolhido dentro da janela da coexistência não chama o servidor', () => {
    const signup = launchBusinessApp();

    postSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data: { waba_id: 'waba-id', phone_number_id: 'phone-id' },
    });
    signup.callback({ authResponse: { code: 'oauth-code' } });

    expect(mocks.connectWhatsappAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Código: SIGNUP_MODE_MISMATCH');
  });

  it('o botão de número novo não aceita o fim da coexistência', () => {
    const signup = startSignup();

    postSignupMessage({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
      data: { waba_id: 'waba-app' },
    });
    signup.login({ authResponse: { code: 'oauth-code' } });

    expect(mocks.connectWhatsappAction).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Código: SIGNUP_MODE_MISMATCH');
  });

  it('conectado por coexistência: mostra a forma de conexão e como desligar no app', () => {
    render(
      <WhatsappConnect
        status={{
          ...status,
          connected: true,
          hasActiveNumber: true,
          phoneNumberMasked: '+55 ** *****-1234',
          connectionStatus: 'connected',
          coexistence: true,
        }}
        appId="app-id"
        configId="config-v4"
        graphVersion="v23.0"
        ready={true}
      />,
    );

    expect(screen.getByText('App WhatsApp Business do celular')).toBeTruthy();
    expect(screen.getByText('A recepção continua usando o app')).toBeTruthy();
    expect(screen.getByText(/desconecte também no app WhatsApp Business/)).toBeTruthy();
  });
});
