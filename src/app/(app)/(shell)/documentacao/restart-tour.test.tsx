// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { refresh, submitOnboardingAction } = vi.hoisted(() => ({
  refresh: vi.fn(),
  submitOnboardingAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('../_painel/onboarding-actions', () => ({ submitOnboardingAction }));

import { RestartTour } from './restart-tour';

afterEach(cleanup);

describe('RestartTour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    submitOnboardingAction.mockResolvedValue({ ok: true });
  });

  it('inicia voluntariamente um tour ainda não iniciado', async () => {
    render(<RestartTour state="not_started" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Iniciar tour guiado' }));
    });

    expect(submitOnboardingAction).toHaveBeenCalledWith({ action: 'tour_start' });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it('reabre um tour encerrado', async () => {
    render(<RestartTour state="completed" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refazer tour guiado' }));
    });

    expect(submitOnboardingAction).toHaveBeenCalledWith({ action: 'tour_reopen' });
  });

  it('não oferece uma segunda ação enquanto o tour está aberto', () => {
    render(<RestartTour state="in_progress" />);
    expect(screen.queryByTestId('restart-tour')).toBeNull();
  });
});
