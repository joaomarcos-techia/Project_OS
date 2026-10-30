// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { navigate, submitOnboardingAction } = vi.hoisted(() => ({
  navigate: vi.fn(),
  submitOnboardingAction: vi.fn(),
}));

vi.mock('../_painel/onboarding-actions', () => ({ submitOnboardingAction }));

import { RestartTour } from './restart-tour';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RestartTour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('location', { assign: navigate });
    submitOnboardingAction.mockResolvedValue({ ok: true });
  });

  it('inicia voluntariamente um tour ainda não iniciado', async () => {
    render(<RestartTour state="not_started" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar tour guiado' }));
    });

    expect(submitOnboardingAction).toHaveBeenCalledWith({ action: 'tour_start' });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/dashboard'));
  });

  it('reabre um tour encerrado', async () => {
    render(<RestartTour state="completed" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refazer tour guiado' }));
    });

    expect(submitOnboardingAction).toHaveBeenCalledWith({ action: 'tour_reopen' });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/dashboard'));
  });

  it('não navega quando o servidor recusa iniciar o tour', async () => {
    submitOnboardingAction.mockResolvedValue({ ok: false, reason: 'denied' });
    render(<RestartTour state="not_started" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar tour guiado' }));
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível abrir o tour');
  });

  it('segue o estado vencedor quando outra aba já iniciou o tour', async () => {
    submitOnboardingAction.mockResolvedValue({
      ok: false,
      reason: 'stale',
      progress: { tourState: 'in_progress' },
    });
    render(<RestartTour state="not_started" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar tour guiado' }));
    });

    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('exibe falha de rede sem abrir um tour não confirmado', async () => {
    submitOnboardingAction.mockRejectedValue(new Error('network unavailable'));
    render(<RestartTour state="not_started" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar tour guiado' }));
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível abrir o tour');
  });

  it('não oferece uma segunda ação enquanto o tour está aberto', () => {
    render(<RestartTour state="in_progress" />);
    expect(screen.queryByTestId('restart-tour')).toBeNull();
  });
});
