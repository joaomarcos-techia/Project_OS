// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  close: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('./actions', () => ({
  connectPaymentAccountAction: mocks.connect,
  disconnectPaymentAccountAction: mocks.disconnect,
  closePaymentAccountAction: mocks.close,
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
  openLinks: 0,
  closure: null,
};
const PAUSED = { ...STATUS, acceptNewCharges: false, webhookConfigured: true };
const CLOSURE = {
  blockers: { openLinks: 0, pendingRefunds: 0, openDisputes: 0 },
  canClose: false,
  lastActivityAt: '2026-10-07T13:00:00.000Z',
  autoCloseAt: '2027-04-05T13:00:00.000Z',
  noticeSentAt: null,
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
    render(<PaymentAccountPanel status={{ ...PAUSED, closure: { ...CLOSURE, canClose: true } }} />);
    expect(screen.getByText('Novas cobranças pausadas')).toBeTruthy();
    expect(screen.getByText('Pausada')).toBeTruthy();
    // "Tentar desconexão" não fazia nada com histórico; o caminho agora é encerrar.
    expect(screen.queryByRole('button', { name: 'Tentar desconexão' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pausar ou desconectar' })).toBeNull();
  });

  it('antes de pausar, avisa quantos links seguem pagáveis', () => {
    render(<PaymentAccountPanel status={{ ...STATUS, webhookConfigured: true, openLinks: 2 }} />);
    expect(
      screen.getByText(
        /Há 2 links de pagamento abertos\. Se você pausar, eles continuam pagáveis/u,
      ),
    ).toBeTruthy();
  });

  it('na conta pausada, mostra os links ainda pagáveis', () => {
    render(<PaymentAccountPanel status={{ ...PAUSED, openLinks: 1, closure: CLOSURE }} />);
    expect(
      screen.getByText(/1 link de pagamento aberto antes da pausa ainda pode ser pago/u),
    ).toBeTruthy();
  });

  it('encerra a conta pausada só depois da confirmação', async () => {
    mocks.close.mockResolvedValue({ ok: true, data: { ...STATUS, hasApiKey: false } });
    render(<PaymentAccountPanel status={{ ...PAUSED, closure: { ...CLOSURE, canClose: true } }} />);
    expect(screen.getByText(/encerrada automaticamente em 05\/04\/2027/u)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Encerrar definitivamente' }));
    expect(mocks.close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar encerramento' }));

    await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText(/Conta encerrada\./u)).toBeTruthy());
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('com pendência, explica o que impede e não oferece o encerramento', () => {
    render(
      <PaymentAccountPanel
        status={{
          ...PAUSED,
          openLinks: 2,
          closure: {
            ...CLOSURE,
            blockers: { openLinks: 2, pendingRefunds: 1, openDisputes: 0 },
            noticeSentAt: '2027-03-06T13:00:00.000Z',
          },
        }}
      />,
    );
    expect(
      screen.getByText(
        'Para encerrar, resolva antes: 2 links de pagamento abertos, 1 devolução sem confirmação.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Encerrar definitivamente' })).toBeNull();
    expect(screen.getByText(/Aviso enviado em 06\/03\/2027\./u)).toBeTruthy();
  });

  it('mostra a recusa do servidor sem fingir que encerrou', async () => {
    mocks.close.mockResolvedValue({
      ok: false,
      code: 'payment_validation',
      message: 'Ainda há 1 link de pagamento aberto. Resolva antes de encerrar a conta.',
    });
    render(<PaymentAccountPanel status={{ ...PAUSED, closure: { ...CLOSURE, canClose: true } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar definitivamente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar encerramento' }));
    await waitFor(() =>
      expect(screen.getByText(/Ainda há 1 link de pagamento aberto/u)).toBeTruthy(),
    );
    expect(screen.queryByText(/Conta encerrada\./u)).toBeNull();
  });
});
