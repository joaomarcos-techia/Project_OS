// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ resetPasswordAction: vi.fn() }));

vi.mock('./actions', () => ({ resetPasswordAction: mocks.resetPasswordAction }));

import { ResetPasswordForm } from './reset-password-form';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ResetPasswordForm', () => {
  it('mostra e oculta a nova senha, como a tela de login', () => {
    render(<ResetPasswordForm />);

    const input = screen.getByLabelText('Nova senha (mín 8 caracteres)') as HTMLInputElement;
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
});
