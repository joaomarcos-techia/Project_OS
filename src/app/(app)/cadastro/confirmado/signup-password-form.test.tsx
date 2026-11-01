// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SignupPasswordForm } from './signup-password-form';

const fetchMock = vi.fn();
const assign = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('location', { ...window.location, assign });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fillAndSubmit(password = 'UniquePassword7!') {
  fireEvent.change(screen.getByLabelText('Crie sua senha'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Criar senha e escolher plano' }));
}
describe('senha após confirmação', () => {
  it('explica a reconciliação sem sugerir criar outra senha', () => {
    render(<SignupPasswordForm reconcile />);
    expect(screen.getByLabelText('Sua senha').getAttribute('autocomplete')).toBe(
      'current-password',
    );
    expect(screen.getByText(/Digite a mesma senha/u)).toBeTruthy();
    expect(screen.queryByLabelText('Crie sua senha')).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirmar senha e continuar' })).toBeTruthy();
  });
  it('pede somente senha, permite conferi-la e não persiste credenciais no navegador', () => {
    render(<SignupPasswordForm />);
    const input = screen.getByLabelText('Crie sua senha');
    expect(input.getAttribute('type')).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('new-password');
    expect(document.querySelector('input[name="email"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(input.getAttribute('type')).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar senha' }));
    expect(input.getAttribute('type')).toBe('password');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
  it('recusa senha inválida antes da rede e posiciona o foco', () => {
    render(<SignupPasswordForm />);
    fillAndSubmit('short');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByLabelText('Crie sua senha'));
  });
  it('envia só a senha, evita clique duplicado e continua explicitamente no plano', async () => {
    let resolveResponse: (response: Response) => void = () => {
      throw new Error('not initialized');
    };
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }),
    );
    render(<SignupPasswordForm />);
    fillAndSubmit();
    fireEvent.submit(document.querySelector('form')!);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/signup/password');
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body)).toEqual({
      password: 'UniquePassword7!',
    });
    resolveResponse(Response.json({ ok: true }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/cadastro/plano'));
    expect(screen.getByLabelText('Crie sua senha')).toHaveProperty('value', '');
  });
  it('limpa uma senha recusada sem pedir novamente e-mail ou código', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'weak_password' }, { status: 422 }));
    render(<SignupPasswordForm />);
    fillAndSubmit();
    await screen.findByText(/Essa senha não pode ser usada/u);
    expect(screen.getByLabelText('Crie sua senha')).toHaveProperty('value', '');
    expect(assign).not.toHaveBeenCalled();
  });
  it('oferece reinício quando o cadastro expirou', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'gone' }, { status: 410 }));
    render(<SignupPasswordForm />);
    fillAndSubmit();
    expect(
      (await screen.findByRole('link', { name: 'Iniciar novo cadastro' })).getAttribute('href'),
    ).toBe('/cadastro');
    expect(assign).not.toHaveBeenCalled();
  });
  it.each([401, 403, 409, 429, 503])(
    'preserva uma falha HTTP %i sem declarar sucesso',
    async (status) => {
      fetchMock.mockResolvedValue(Response.json({ error: 'test' }, { status }));
      render(<SignupPasswordForm />);
      fillAndSubmit();
      await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
      expect(assign).not.toHaveBeenCalled();
    },
  );
  it('resposta perdida oferece reconciliação com a mesma senha', async () => {
    fetchMock.mockRejectedValue(new Error('synthetic network failure'));
    render(<SignupPasswordForm />);
    fillAndSubmit();
    await screen.findByText(/mesma senha/u);
    expect(screen.getByLabelText('Crie sua senha')).toHaveProperty('value', 'UniquePassword7!');
    expect(assign).not.toHaveBeenCalled();
  });
  it('não aceita um HTTP 200 sem o resultado esperado', async () => {
    fetchMock.mockResolvedValue(Response.json({ unrelated: true }));
    render(<SignupPasswordForm />);
    fillAndSubmit();
    await screen.findByText(/Não foi possível concluir/u);
    expect(assign).not.toHaveBeenCalled();
  });
});
