// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ resetPasswordAction: vi.fn() }));

vi.mock('./actions', () => ({ resetPasswordAction: mocks.resetPasswordAction }));

import { ResetPasswordForm } from './reset-password-form';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function passwordInput(): HTMLInputElement {
  return screen.getByLabelText('Nova senha') as HTMLInputElement;
}

describe('ResetPasswordForm', () => {
  it('mostra e oculta a nova senha, como a tela de login', () => {
    render(<ResetPasswordForm />);

    const input = passwordInput();
    expect(input.type).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(input.type).toBe('text');

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar senha' }));
    expect(input.type).toBe('password');
    expect(mocks.resetPasswordAction).not.toHaveBeenCalled();
  });

  it('o botão do olho não envia o formulário', () => {
    render(<ResetPasswordForm />);

    const toggle = screen.getByRole('button', { name: 'Mostrar senha' });
    expect(toggle.getAttribute('type')).toBe('button');
  });

  it('mostra as regras da senha antes de a pessoa errar', () => {
    render(<ResetPasswordForm />);

    expect(screen.getByText(/letra maiúscula, minúscula e número/u)).toBeTruthy();
  });

  it('diz o que falta na senha e não envia', async () => {
    render(<ResetPasswordForm />);

    fireEvent.change(passwordInput(), { target: { value: 'senhasemnumero' } });
    fireEvent.submit(passwordInput().closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'A senha precisa ter uma letra maiúscula e um número.',
      );
    });
    expect(mocks.resetPasswordAction).not.toHaveBeenCalled();
  });

  it('senha dentro da regra vai para o servidor', async () => {
    mocks.resetPasswordAction.mockResolvedValue({ error: null });
    render(<ResetPasswordForm />);

    fireEvent.change(passwordInput(), { target: { value: 'NovaSenha2026' } });
    fireEvent.submit(passwordInput().closest('form') as HTMLFormElement);

    await waitFor(() => expect(mocks.resetPasswordAction).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('leva o usuário num campo oculto para o gerenciador de senhas atualizar a senha salva', () => {
    const { container } = render(<ResetPasswordForm username="ana@example.test" />);

    const username = container.querySelector('input[autocomplete="username"]') as HTMLInputElement;
    expect(username).toBeTruthy();
    expect(username.value).toBe('ana@example.test');
    expect(username.hidden).toBe(true);
    expect(username.type).toBe('text');
    expect(passwordInput().getAttribute('autocomplete')).toBe('new-password');
  });

  it('sem e-mail conhecido, não inventa campo de usuário', () => {
    const { container } = render(<ResetPasswordForm username={null} />);

    expect(container.querySelector('input[autocomplete="username"]')).toBeNull();
  });
});
