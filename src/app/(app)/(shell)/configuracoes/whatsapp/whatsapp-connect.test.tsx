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
  health: { verdict: 'indeterminate', messages: [] },
};

afterEach(() => {
  cleanup();
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
