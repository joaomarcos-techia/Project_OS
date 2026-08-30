// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  update: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/contexts/ai-agent/config-actions', () => ({ updateAgentConfig: mocks.update }));
vi.mock('@/components/ui/use-toast', () => ({
  toast: { success: mocks.success, error: mocks.error },
}));

import { AgentConfigForm } from './agent-config-form';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AgentConfigForm — convênios aceitos', () => {
  it('mostra a configuração atual e envia a lista normalizada', async () => {
    mocks.update.mockResolvedValue({
      ok: true,
      data: {
        canScheduleAnonymous: false,
        maxDaysAhead: 30,
        canDisclosePaymentsViaAgent: false,
        especialidades: ['Cardiologia'],
        convenios: ['Unimed', 'Bradesco Saúde'],
        updatedAt: '2026-08-30T12:00:00.000Z',
      },
    });

    render(
      <AgentConfigForm
        initial={{
          canScheduleAnonymous: false,
          maxDaysAhead: 30,
          canDisclosePaymentsViaAgent: false,
          especialidades: ['Cardiologia'],
          convenios: ['Unimed'],
          updatedAt: null,
        }}
      />,
    );

    const input = screen.getByLabelText('Convênios aceitos');
    expect((input as HTMLInputElement).value).toBe('Unimed');
    expect(screen.getByText(/O agente informa somente os convênios desta lista/)).toBeTruthy();

    fireEvent.change(input, { target: { value: ' Unimed,  Bradesco Saúde, SulAmérica ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          convenios: ['Unimed', 'Bradesco Saúde', 'SulAmérica'],
        }),
      ),
    );
    expect(mocks.success).toHaveBeenCalledWith('Configuração do agente salva.');
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
