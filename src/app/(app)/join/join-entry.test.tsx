// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const { bootstrapJoinAction } = vi.hoisted(() => ({ bootstrapJoinAction: vi.fn() }));

vi.mock('./bootstrap', () => ({ bootstrapJoinAction }));
vi.mock('./[token]/join-wizard', () => ({
  JoinWizard: ({ token }: { token: string }) => <div data-testid="join-wizard">{token}</div>,
}));

import { JoinEntry } from './join-entry';

const TOKEN = 'a'.repeat(43);

describe('JoinEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', `/join#invite=${TOKEN}`);
  });

  afterEach(cleanup);

  it('remove o fragmento antes de montar o wizard e mantém o token só em memória', async () => {
    bootstrapJoinAction.mockResolvedValue({
      kind: 'ready',
      initialState: { currentStep: 'clinic', completed: [] },
      suggestedEmail: null,
      suggestedPlanId: null,
      plans: [],
    });

    render(<JoinEntry />);

    expect((await screen.findByTestId('join-wizard')).textContent).toBe(TOKEN);
    expect(window.location.pathname).toBe('/join');
    expect(window.location.hash).toBe('');
    expect(bootstrapJoinAction).toHaveBeenCalledWith(TOKEN);
  });

  it('não chama o servidor quando o fragmento não é canônico', async () => {
    window.history.replaceState({}, '', '/join#invite=short');
    render(<JoinEntry />);

    await waitFor(() => expect(screen.getByText('Convite indisponível')).toBeTruthy());
    expect(window.location.hash).toBe('');
    expect(bootstrapJoinAction).not.toHaveBeenCalled();
  });
});
