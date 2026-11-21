// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  switchAccountAction: vi.fn(),
  verifyMfaAction: vi.fn(),
}));

vi.mock('./actions', () => ({
  switchAccountAction: mocks.switchAccountAction,
  verifyMfaAction: mocks.verifyMfaAction,
}));

import MfaPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MfaPage', () => {
  it('oferece uma ação secundária acessível para usar outra conta', async () => {
    mocks.switchAccountAction.mockResolvedValue({ error: null });

    render(<MfaPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Verificação em duas etapas' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeTruthy();
    expect(screen.getByLabelText('Código de 6 dígitos')).toBeTruthy();
    const switchButton = screen.getByRole('button', { name: 'Usar outra conta' });
    expect(switchButton.getAttribute('type')).toBe('submit');
    expect(switchButton.closest('form')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Usar outra conta' })).toBeNull();

    fireEvent.submit(switchButton.closest('form') as HTMLFormElement);
    await waitFor(() => expect(mocks.switchAccountAction).toHaveBeenCalledTimes(1));
  });

  it('mostra a falha de saída sem prometer recuperação de MFA', async () => {
    mocks.switchAccountAction.mockResolvedValue({
      error: 'Não foi possível trocar de conta. Tente novamente.',
    });

    render(<MfaPage />);
    const switchButton = screen.getByRole('button', { name: 'Usar outra conta' });
    fireEvent.submit(switchButton.closest('form') as HTMLFormElement);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'Não foi possível trocar de conta. Tente novamente.',
      );
    });
    expect(screen.queryByText(/código de recuperação|recuperar MFA/iu)).toBeNull();
  });
});
