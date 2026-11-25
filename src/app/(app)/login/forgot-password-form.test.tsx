// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ forgotPasswordAction: vi.fn() }));

vi.mock('./actions', () => ({ forgotPasswordAction: mocks.forgotPasswordAction }));

import { ForgotPasswordForm } from './forgot-password-form';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ForgotPasswordForm', () => {
  it('anuncia a resposta genérica de envio e permite voltar ao login', async () => {
    mocks.forgotPasswordAction.mockResolvedValue({ error: null, sent: true });
    const onBack = vi.fn();
    render(<ForgotPasswordForm onBack={onBack} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Redefinir a senha' })).toBeTruthy();
    const email = screen.getByLabelText('E-mail');
    fireEvent.change(email, { target: { value: 'pessoa@example.test' } });
    fireEvent.submit(email.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Se houver uma conta');
    });
    expect(mocks.forgotPasswordAction).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para o login' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('mantém o campo disponível quando a action devolve erro de sintaxe', async () => {
    mocks.forgotPasswordAction.mockResolvedValue({
      error: 'Informe um e-mail válido.',
      sent: false,
    });
    render(<ForgotPasswordForm onBack={vi.fn()} />);

    const email = screen.getByLabelText('E-mail');
    fireEvent.submit(email.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Informe um e-mail válido.');
    });
    expect(email.hasAttribute('disabled')).toBe(false);
  });
});
