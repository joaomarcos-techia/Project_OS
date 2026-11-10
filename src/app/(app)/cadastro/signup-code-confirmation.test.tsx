// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SignupCodeConfirmation } from './signup-code-confirmation';

const fetchMock = vi.fn<typeof fetch>();
const assign = vi.fn();
const updated = vi.fn();
const reconcile = vi.fn();
const gone = vi.fn();
const email = 'synthetic@example.test';
function mount(address: string | undefined = email) {
  render(
    <SignupCodeConfirmation
      email={address}
      rowVersion={5}
      onUpdated={updated}
      onReconcile={reconcile}
      onGone={gone}
    />,
  );
}
const reply = (status: number, body: object) => Response.json(body, { status });
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(window.location, 'assign').mockImplementation(assign);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('same-screen verification UI', () => {
  it.each(['failed', 'delayed'] as const)(
    'shows %s delivery feedback without claiming inbox placement',
    (deliveryStatus) => {
      render(
        <SignupCodeConfirmation
          email={email}
          rowVersion={5}
          deliveryStatus={deliveryStatus}
          onUpdated={updated}
          onReconcile={reconcile}
          onGone={gone}
        />,
      );
      expect(
        screen.getByText(
          deliveryStatus === 'failed'
            ? 'Não conseguimos entregar o código'
            : 'A entrega está demorando',
        ),
      ).toBeTruthy();
      expect(screen.getByLabelText('Código de confirmação')).toBeTruthy();
      expect(document.querySelector('input[type="password"]')).toBeNull();
    },
  );
  it('corrects only the destination and never automatically sends, renames or verifies an account', async () => {
    const corrected = vi.fn();
    render(
      <SignupCodeConfirmation
        email={email}
        rowVersion={5}
        onEmailCorrected={corrected}
        onUpdated={updated}
        onReconcile={reconcile}
        onGone={gone}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Corrigir endereço de e-mail' }));
    fireEvent.change(screen.getByLabelText('Novo e-mail'), {
      target: { value: 'corrected@example.test' },
    });
    fetchMock.mockResolvedValue(reply(200, { rowVersion: 6 }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar endereço corrigido' }));
    await waitFor(() => expect(corrected).toHaveBeenCalledWith(6, 'corrected@example.test'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/signup/sessions/email');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      rowVersion: 5,
      currentEmail: email,
      email: 'corrected@example.test',
    });
    expect(assign).not.toHaveBeenCalled();
  });
  it('does not retry a correction after a conflict', async () => {
    render(
      <SignupCodeConfirmation
        email={email}
        rowVersion={5}
        onEmailCorrected={vi.fn()}
        onUpdated={updated}
        onReconcile={reconcile}
        onGone={gone}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Corrigir endereço de e-mail' }));
    fireEvent.change(screen.getByLabelText('Novo e-mail'), {
      target: { value: 'corrected@example.test' },
    });
    fetchMock.mockResolvedValue(reply(409, { error: 'conflict' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar endereço corrigido' }));
    await waitFor(() => expect(reconcile).toHaveBeenCalledWith('conflict'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('waits for the original address before enabling confirmation after reload', async () => {
    let resolve: (response: Response) => void = () => {
      throw new Error('not initialized');
    };
    fetchMock.mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    render(
      <SignupCodeConfirmation
        rowVersion={5}
        onUpdated={updated}
        onReconcile={reconcile}
        onGone={gone}
      />,
    );
    expect(screen.getByRole('button', { name: 'Confirmar e-mail' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.queryByLabelText('E-mail usado no cadastro')).toBeNull();
    await act(async () => {
      resolve(reply(200, { email }));
    });
    await screen.findByText(email);
    expect(screen.getByRole('button', { name: 'Confirmar e-mail' })).toHaveProperty(
      'disabled',
      false,
    );
  });
  it('shows destination and a single accessible numeric code input, without a second password', () => {
    mount();
    expect(screen.getByText(email)).toBeTruthy();
    const field = screen.getByLabelText('Código de confirmação');
    expect(field.getAttribute('autocomplete')).toBe('one-time-code');
    expect(field.getAttribute('inputmode')).toBe('numeric');
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Retomar cadastro com segurança' }).getAttribute('href'),
    ).toBe('/cadastro/retomar');
  });

  it('does not promise delivery, since an existing account receives nothing', () => {
    mount();
    const lead = screen.getByRole('heading', { name: 'Confirme seu e-mail aqui' }).parentElement;
    expect(lead?.textContent).toContain('Se houver uma etapa de confirmação para');
    expect(lead?.textContent).toContain('Se já tem conta, entre para continuar.');
    expect(lead?.textContent).not.toContain('mensagem enviada');
  });
  it('accepts a full pasted code and continues without asking identity or password', async () => {
    mount();
    fetchMock.mockResolvedValue(reply(200, { next: '/cadastro/plano' }));
    fireEvent.paste(screen.getByLabelText('Código de confirmação'), {
      clipboardData: { getData: () => '1234 5678' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e-mail' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/cadastro/plano'));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      email,
      code: '12345678',
    });
  });
  it.each([
    ['invalid', 422, 'O código não confere.'],
    ['expired', 422, 'O código expirou.'],
    ['locked', 429, 'O limite de tentativas'],
    ['unavailable', 503, 'Não foi possível concluir'],
  ])('explains %s without navigating or discarding data', async (error, status, message) => {
    mount();
    fetchMock.mockResolvedValue(reply(status, { error }));
    fireEvent.change(screen.getByLabelText('Código de confirmação'), {
      target: { value: '12345678' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e-mail' }));
    await screen.findByText(new RegExp(message));
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Código de confirmação')).toHaveProperty('value', '12345678');
  });
  it('blocks incomplete code before making a request', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('Código de confirmação'), { target: { value: '1234' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Confirmar e-mail' }).closest('form')!);
    await screen.findByText(/Digite os 8 números/u);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('serializes repeated clicks on confirmation and resend', async () => {
    let settle: (value: Response) => void = () => {
      throw new Error('request not started');
    };
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    mount();
    fireEvent.change(screen.getByLabelText('Código de confirmação'), {
      target: { value: '12345678' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e-mail' }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmar e-mail/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar código' }));
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => {
      settle(reply(200, { next: '/cadastro/plano' }));
    });
    expect(assign).toHaveBeenCalledOnce();
  });
  it('resend rotates version and clears only the old code', async () => {
    mount();
    fetchMock.mockResolvedValue(reply(200, { rowVersion: 7 }));
    fireEvent.change(screen.getByLabelText('Código de confirmação'), {
      target: { value: '12345678' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar código' }));
    await waitFor(() => expect(updated).toHaveBeenCalledWith(7));
    expect(screen.getByLabelText('Código de confirmação')).toHaveProperty('value', '');
    expect(screen.getByText(email)).toBeTruthy();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      email,
      rowVersion: 5,
    });
  });
  it('retrieves only its server-bound destination after reload', async () => {
    fetchMock.mockResolvedValue(reply(200, { email }));
    render(
      <SignupCodeConfirmation
        rowVersion={5}
        onUpdated={updated}
        onReconcile={reconcile}
        onGone={gone}
      />,
    );
    await screen.findByText(email);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/signup/sessions/destination');
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
  it('falls back to the original email on destination failure without repeating other data', async () => {
    fetchMock.mockResolvedValue(reply(503, { error: 'unavailable' }));
    render(
      <SignupCodeConfirmation
        rowVersion={5}
        onUpdated={updated}
        onReconcile={reconcile}
        onGone={gone}
      />,
    );
    await screen.findByText(/Não conseguimos recuperar o endereço/u);
    expect(screen.getByLabelText('E-mail usado no cadastro')).toBeTruthy();
    expect(screen.queryByLabelText('Seu nome')).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
  it('never follows a next URL supplied outside the allowed signup pages', async () => {
    mount();
    fetchMock.mockResolvedValue(reply(200, { next: 'https://evil.example' }));
    fireEvent.change(screen.getByLabelText('Código de confirmação'), {
      target: { value: '12345678' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e-mail' }));
    await waitFor(() => expect(reconcile).toHaveBeenCalledWith('uncertain'));
    expect(assign).not.toHaveBeenCalled();
  });
  it.each(['/cadastro/continuar', '/cadastro/pagamento?resultado=pending'])(
    'resumes the real next step %s',
    async (next) => {
      mount();
      fetchMock.mockResolvedValue(reply(200, { next }));
      fireEvent.change(screen.getByLabelText('Código de confirmação'), {
        target: { value: '12345678' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar e-mail' }));
      await waitFor(() => expect(assign).toHaveBeenCalledWith(next));
    },
  );
});
