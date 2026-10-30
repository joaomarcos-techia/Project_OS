// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const widget = vi.hoisted(() => ({ token: 'fresh-synthetic-token' }));
vi.mock('@/components/shared/turnstile-widget', () => ({
  CAPTCHA_TOKEN_FIELD: 'captchaToken',
  TurnstileWidget: ({ resetSignal }: { resetSignal: number }) => (
    <input
      data-testid="widget"
      data-reset={resetSignal}
      type="hidden"
      name="captchaToken"
      value={widget.token}
      readOnly
    />
  ),
}));

import { SignupProtectionCheck } from './signup-protection-check';

const fetchMock = vi.fn<typeof fetch>();
const proof = {
  ok: true,
  runId: 'a94567d9-0cbb-4c37-b252-97ade0123400',
  accepted: true,
  replayRejected: true,
  invalidRejected: true,
};

beforeEach(() => {
  widget.token = 'fresh-synthetic-token';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('operator verification flow', () => {
  it('shows PASS only after the server confirms all three checks', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(proof), { status: 200 }));
    render(<SignupProtectionCheck />);
    fireEvent.click(screen.getByRole('button', { name: 'Validar no servidor' }));
    await screen.findByText('Proteção verificada no servidor: 3 de 3 testes aprovados.');
    expect(screen.getByText(/Código da verificação:/).textContent).toContain(proof.runId);
    expect(screen.queryByTestId('widget')).toBeNull();
    expect(screen.queryByText(/fresh-synthetic-token/)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/signup/verificacao',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin', cache: 'no-store' }),
    );
  });

  it('does not send missing or expired client tokens', async () => {
    widget.token = '';
    render(<SignupProtectionCheck />);
    fireEvent.click(screen.getByRole('button', { name: 'Validar no servidor' }));
    await screen.findByText('Aguarde a verificação do navegador e tente novamente.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { ...proof, replayRejected: false },
    { ...proof, invalidRejected: false },
    { ...proof, accepted: false },
    { ...proof, runId: '<sensitive-value>' },
  ])('does not trust partial or malformed proof: %j', async (body) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    render(<SignupProtectionCheck />);
    fireEvent.click(screen.getByRole('button', { name: 'Validar no servidor' }));
    await screen.findByText('Não foi possível confirmar a proteção. O cadastro continua fechado.');
    expect(screen.queryByText(/3 de 3/)).toBeNull();
    expect(screen.getByTestId('widget').getAttribute('data-reset')).toBe('1');
  });

  it('handles rate limiting and does not render raw provider errors', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"secret-not-for-ui"}', { status: 429 }));
    render(<SignupProtectionCheck />);
    fireEvent.click(screen.getByRole('button', { name: 'Validar no servidor' }));
    await screen.findByText('Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.');
    expect(screen.queryByText('secret-not-for-ui')).toBeNull();
  });

  it('handles connection failures without false success', async () => {
    fetchMock.mockRejectedValue(new Error('secret-not-for-ui'));
    render(<SignupProtectionCheck />);
    fireEvent.click(screen.getByRole('button', { name: 'Validar no servidor' }));
    await screen.findByText('Falha na conexão. Tente novamente em instantes.');
    expect(screen.queryByText(/3 de 3/)).toBeNull();
  });

  it('prevents concurrent submissions consuming the same token', async () => {
    let finish: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const { container } = render(<SignupProtectionCheck />);
    const form = container.querySelector('form');
    if (!form) throw new Error('form missing');
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (!finish) throw new Error('pending response missing');
    finish(new Response(JSON.stringify(proof), { status: 200 }));
    await waitFor(() => expect(screen.getByText(/3 de 3/)).toBeTruthy());
  });
});
