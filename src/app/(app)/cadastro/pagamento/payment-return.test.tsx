// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PaymentReturn } from './payment-return';

const fetchMock = vi.fn<typeof fetch>();
const assignMock = vi.fn<(url: string | URL) => void>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
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

describe('retorno do Checkout do cadastro', () => {
  it('redireciona somente depois da confirmação autoritativa', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { state: 'provisioned' }));

    render(<PaymentReturn result="success" />);

    expect(await screen.findByText('Validando sua assinatura')).toBeTruthy();
    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith('/auth/session-refresh?next=/dashboard'),
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/signup/checkout/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
  });

  it('renova as claims pré-tenant quando outra aba concluiu o provisionamento', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: 'unauthorized' }));

    render(<PaymentReturn result="success" />);

    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith('/auth/session-refresh?next=/dashboard'),
    );
  });

  it('não usa a renovação de sessão para contornar um bloqueio de origem', async () => {
    fetchMock.mockResolvedValueOnce(json(403, { error: 'blocked' }));

    render(<PaymentReturn result="success" />);

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/login'));
  });

  it('cancela com o servidor antes de voltar ao plano', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { state: 'reset' }));
    render(<PaymentReturn result="cancelled" />);

    expect(await screen.findByText('Checkout cancelado')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao plano' }));
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/cadastro/plano'));
    expect(fetchMock).toHaveBeenCalledWith('/api/signup/checkout/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'cancelled' }),
    });
  });

  it('troca para a validação quando uma conclusão venceu o cancelamento', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { state: 'already_completed' }));
    render(<PaymentReturn result="expired" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Voltar ao plano' }));
    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith('/cadastro/pagamento?resultado=success'),
    );
  });
});
