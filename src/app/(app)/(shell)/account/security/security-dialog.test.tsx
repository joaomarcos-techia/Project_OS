// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const startEnrollAction = vi.hoisted(() => vi.fn());
vi.mock('./actions', () => ({
  startEnrollAction,
  verifyEnrollAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { TotpSetupDialog } from './security-dialog';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ENROLLED = {
  step: 'verifying' as const,
  factorId: '0f6a3a2e-1111-2222-3333-444455556666',
  qrSvg: 'data:image/svg+xml;utf8,<svg/>',
  secret: 'JBSWY3DPEHPK3PXP',
  error: null,
};

describe('TotpSetupDialog', () => {
  it('não cria fator nenhum antes do clique', () => {
    render(<TotpSetupDialog />);

    expect(screen.getByRole('button', { name: 'Ativar TOTP' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(startEnrollAction).not.toHaveBeenCalled();
  });

  it('abre o diálogo com QR, secret e o campo de confirmação', async () => {
    startEnrollAction.mockResolvedValue(ENROLLED);
    render(<TotpSetupDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Ativar TOTP' }));

    const dialog = await screen.findByRole('dialog');
    expect(startEnrollAction).toHaveBeenCalledTimes(1);
    expect(dialog.querySelector('img')?.getAttribute('alt')).toBe('QR Code TOTP');
    expect(dialog.textContent).toContain(ENROLLED.secret);
    // O e2e de produção lê o fator por este input; ele é contrato, não detalhe.
    expect(dialog.querySelector('input[name="factorId"]')?.getAttribute('value')).toBe(
      ENROLLED.factorId,
    );
    expect(screen.getByLabelText('Código de 6 dígitos')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirmar e ativar' })).toBeTruthy();
  });

  it('mostra a recusa do servidor em vez de um diálogo vazio', async () => {
    startEnrollAction.mockResolvedValue({
      step: 'idle',
      factorId: null,
      qrSvg: null,
      secret: null,
      error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    });
    render(<TotpSetupDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Ativar TOTP' }));

    await waitFor(() => expect(screen.getByText(/Muitas tentativas/u)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Confirmar e ativar' })).toBeNull();
  });
});
