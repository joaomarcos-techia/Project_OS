// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

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
    expect(screen.getByRole('button', { name: 'Conectar WhatsApp' })).toBeTruthy();
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

  it('META-001: sonda indisponível preserva o estado anterior e avisa que não verificou', () => {
    render(
      <WhatsappConnect
        status={{
          ...status,
          connected: true,
          hasActiveNumber: true,
          connectionStatus: 'connected',
          health: {
            verdict: 'indeterminate',
            messages: ['Não foi possível confirmar o estado da conexão com a Meta agora.'],
          },
        }}
        appId="app-id"
        configId="config-id"
        graphVersion="v23.0"
        ready={true}
      />,
    );

    expect(screen.getByText('WhatsApp conectado')).toBeTruthy();
    expect(screen.getByText(/última verificação bem-sucedida/u)).toBeTruthy();
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
});
