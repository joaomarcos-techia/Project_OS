// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { submitOnboardingAction, fetchOnboardingProgress } = vi.hoisted(() => ({
  submitOnboardingAction: vi.fn(),
  fetchOnboardingProgress: vi.fn(),
}));

vi.mock('./onboarding-actions', () => ({ submitOnboardingAction, fetchOnboardingProgress }));

import { TOUR_LAST_STEP, TOUR_STEPS, type OnboardingProgressState } from '@/contexts/onboarding';

import { ProductTour } from './product-tour';

function state(over: Partial<OnboardingProgressState> = {}): OnboardingProgressState {
  const base: OnboardingProgressState = {
    tourState: 'not_started',
    tourStep: 0,
    tourFinishedAt: null,
    docsVisitedAt: null,
    checklistDismissedAt: null,
    rowVersion: 1,
    shouldAutoOpenTour: true,
  };
  const merged = { ...base, ...over };
  // Mantém a regra do servidor coerente no fixture: quem é terminal não reabre.
  merged.shouldAutoOpenTour =
    over.shouldAutoOpenTour ?? (merged.tourState !== 'completed' && merged.tourState !== 'skipped');
  return merged;
}

afterEach(cleanup);

describe('ProductTour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    submitOnboardingAction.mockResolvedValue({ ok: true, progress: state(), changed: true });
  });

  it('abre na primeira visita mostrando o primeiro passo', () => {
    render(<ProductTour steps={TOUR_STEPS} initial={state()} />);
    expect(screen.getByTestId('product-tour')).toBeTruthy();
    expect(screen.getByText(TOUR_STEPS[0]!.title)).toBeTruthy();
    expect(screen.getByText(`Passo 1 de ${TOUR_STEPS.length}`)).toBeTruthy();
  });

  it('não abre para quem já concluiu', () => {
    render(
      <ProductTour
        steps={TOUR_STEPS}
        initial={state({ tourState: 'completed', tourStep: TOUR_LAST_STEP })}
      />,
    );
    expect(screen.queryByTestId('product-tour')).toBeNull();
  });

  it('não abre para quem pulou — e é isso que faz fechar ter efeito', () => {
    render(
      <ProductTour steps={TOUR_STEPS} initial={state({ tourState: 'skipped', tourStep: 2 })} />,
    );
    expect(screen.queryByTestId('product-tour')).toBeNull();
  });

  it('a primeira ação é começar, não avançar', async () => {
    render(<ProductTour steps={TOUR_STEPS} initial={state()} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('tour-next'));
    });
    // Avançar exigiria `in_progress` no servidor; mandar `tour_next` aqui
    // gastaria um round-trip que não casaria com nenhuma pré-condição.
    expect(submitOnboardingAction).toHaveBeenCalledWith({ action: 'tour_start' });
  });

  it('avança mandando o passo de onde o cliente pensa estar', async () => {
    submitOnboardingAction.mockResolvedValue({
      ok: true,
      progress: state({ tourState: 'in_progress', tourStep: 2, rowVersion: 5 }),
      changed: true,
    });
    render(
      <ProductTour steps={TOUR_STEPS} initial={state({ tourState: 'in_progress', tourStep: 1 })} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('tour-next'));
    });
    expect(submitOnboardingAction).toHaveBeenCalledWith({ action: 'tour_next', fromStep: 1 });
    await waitFor(() => expect(screen.getByText(TOUR_STEPS[2]!.title)).toBeTruthy());
  });

  it('fechar pelo X grava `tour_skip` — fechar É pular', async () => {
    submitOnboardingAction.mockResolvedValue({
      ok: true,
      progress: state({ tourState: 'skipped', tourStep: 1 }),
      changed: true,
    });
    render(
      <ProductTour steps={TOUR_STEPS} initial={state({ tourState: 'in_progress', tourStep: 1 })} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Fechar'));
    });
    expect(submitOnboardingAction).toHaveBeenCalledWith({ action: 'tour_skip' });
    await waitFor(() => expect(screen.queryByTestId('product-tour')).toBeNull());
  });

  it('adota o estado autoritativo quando o servidor responde `stale`', async () => {
    // Outra aba já avançou para o passo 4 enquanto esta achava estar no 1.
    submitOnboardingAction.mockResolvedValue({
      ok: false,
      reason: 'stale',
      progress: state({ tourState: 'in_progress', tourStep: 4, rowVersion: 9 }),
    });
    render(
      <ProductTour steps={TOUR_STEPS} initial={state({ tourState: 'in_progress', tourStep: 1 })} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('tour-next'));
    });
    // O cliente NÃO insiste no palpite local: a tela passa a mostrar o passo real.
    await waitFor(() => expect(screen.getByText(TOUR_STEPS[4]!.title)).toBeTruthy());
    expect(screen.queryByText(TOUR_STEPS[1]!.title)).toBeNull();
  });

  it('relê do servidor quando a recusa vem sem estado', async () => {
    submitOnboardingAction.mockResolvedValue({ ok: false, reason: 'invalid' });
    fetchOnboardingProgress.mockResolvedValue(
      state({ tourState: 'in_progress', tourStep: 3, rowVersion: 7 }),
    );
    render(
      <ProductTour steps={TOUR_STEPS} initial={state({ tourState: 'in_progress', tourStep: 1 })} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('tour-next'));
    });
    await waitFor(() => expect(fetchOnboardingProgress).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(TOUR_STEPS[3]!.title)).toBeTruthy());
  });

  it('reabre quando o servidor entrega um estado novo por props', async () => {
    const { rerender } = render(
      <ProductTour
        steps={TOUR_STEPS}
        initial={state({ tourState: 'skipped', tourStep: 2, rowVersion: 4 })}
      />,
    );
    expect(screen.queryByTestId('product-tour')).toBeNull();

    // É o que acontece depois de "Refazer o tour" + router.refresh(): o layout
    // re-renderiza e entrega o novo estado ao componente já montado.
    rerender(
      <ProductTour
        steps={TOUR_STEPS}
        initial={state({ tourState: 'in_progress', tourStep: 2, rowVersion: 5 })}
      />,
    );
    expect(screen.getByTestId('product-tour')).toBeTruthy();
    expect(screen.getByText(TOUR_STEPS[2]!.title)).toBeTruthy();
  });

  it('no último passo oferece concluir, não avançar', async () => {
    submitOnboardingAction.mockResolvedValue({
      ok: true,
      progress: state({ tourState: 'completed', tourStep: TOUR_LAST_STEP }),
      changed: true,
    });
    render(
      <ProductTour
        steps={TOUR_STEPS}
        initial={state({ tourState: 'in_progress', tourStep: TOUR_LAST_STEP })}
      />,
    );
    expect(screen.queryByTestId('tour-next')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId('tour-complete'));
    });
    expect(submitOnboardingAction).toHaveBeenCalledWith({ action: 'tour_complete' });
    await waitFor(() => expect(screen.queryByTestId('product-tour')).toBeNull());
  });

  it('não deixa voltar no primeiro passo', () => {
    render(
      <ProductTour steps={TOUR_STEPS} initial={state({ tourState: 'in_progress', tourStep: 0 })} />,
    );
    expect(screen.getByTestId('tour-previous').hasAttribute('disabled')).toBe(true);
  });
});
