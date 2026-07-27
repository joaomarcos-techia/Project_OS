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
  phoneNumberMasked: null,
  connectionStatus: null,
  verifiedAt: null,
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
