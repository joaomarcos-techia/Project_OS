// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('./actions', () => ({
  connectPaymentAccountAction: mocks.connect,
  disconnectPaymentAccountAction: mocks.disconnect,
}));

import { PaymentAccountPanel } from './payment-account-panel';

const STATUS = {
  provider: 'asaas' as const,
  hasApiKey: true,
  acceptNewCharges: true,
  webhookConfigured: false,
  accountName: 'Clínica Exemplo',
  keyVersion: 2,
  connectedAt: '2026-08-26T04:31:06.084Z',
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('PaymentAccountPanel', () => {
  it('explica a etapa que falhou mesmo antes de uma nova tentativa', () => {
    render(<PaymentAccountPanel status={STATUS} />);

    expect(screen.getByText('Webhook de pagamento não configurado')).toBeTruthy();
    expect(screen.getByText(/entre o Qoro e o Asaas/u)).toBeTruthy();
    expect(screen.getByText(/POST \/webhooks/u)).toBeTruthy();
  });

  it('mostra local, motivo e código seguro devolvidos pela nova tentativa', async () => {
    mocks.connect.mockResolvedValue({
      ok: true,
      data: {
        ...STATUS,
        webhookConfigurationIssue: {
          code: 'asaas_webhook_rejected',
          location: 'API do Asaas, durante POST /webhooks',
          message:
            'O Asaas recusou o registro do webhook (HTTP 400; código(s): invalid_webhook_url).',
        },
      },
    });
    render(<PaymentAccountPanel status={STATUS} />);

    fireEvent.change(screen.getByLabelText('Trocar a chave de API'), {
      target: { value: '$aact_segundo_valor' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Conectar ou retomar' }));

    await waitFor(() =>
      expect(screen.getByText(/API do Asaas, durante POST \/webhooks/u)).toBeTruthy(),
    );
    expect(screen.getByText(/invalid_webhook_url/u)).toBeTruthy();
    expect(screen.getByText('asaas_webhook_rejected')).toBeTruthy();
    expect(screen.queryByDisplayValue('$aact_segundo_valor')).toBeNull();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('identifica conta pausada sem afirmar que a chave foi apagada', () => {
    render(<PaymentAccountPanel status={{ ...STATUS, acceptNewCharges: false }} />);
    expect(screen.getByText('Novas cobranças pausadas')).toBeTruthy();
    expect(screen.getByText('Pausada')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar desconexão' })).toBeTruthy();
  });
});
