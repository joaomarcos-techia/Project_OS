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
  it('expõe o disclosure nativo e anuncia a resposta genérica de envio', async () => {
    mocks.forgotPasswordAction.mockResolvedValue({ error: null, sent: true });
    render(<ForgotPasswordForm />);

    const summary = screen.getByText('Esqueci a senha');
    const details = summary.closest('details');
    expect(details?.open).toBe(false);
    fireEvent.click(summary);
    expect(details?.open).toBe(true);

    const email = screen.getByLabelText('E-mail');
    fireEvent.change(email, { target: { value: 'pessoa@example.test' } });
    fireEvent.submit(email.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Se houver uma conta');
    });
    expect(mocks.forgotPasswordAction).toHaveBeenCalledTimes(1);
  });

  it('mantém o campo disponível quando a action devolve erro de sintaxe', async () => {
    mocks.forgotPasswordAction.mockResolvedValue({
      error: 'Informe um e-mail válido.',
      sent: false,
    });
    render(<ForgotPasswordForm />);

    const email = screen.getByLabelText('E-mail');
    fireEvent.submit(email.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Informe um e-mail válido.');
    });
    expect(email.hasAttribute('disabled')).toBe(false);
  });
});
