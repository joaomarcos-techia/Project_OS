import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authorizeAction, listOpenHandoffs } = vi.hoisted(() => ({
  authorizeAction: vi.fn(),
  listOpenHandoffs: vi.fn(),
}));

vi.mock('@/lib/auth/action-guard', () => ({ authorizeAction }));
vi.mock('@/contexts/ai-agent/queries', () => ({ listOpenHandoffs }));

import { fetchOpenHandoffs } from './handoff-actions';

describe('fetchOpenHandoffs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sessão sem profile vira negativa controlada, sem exceção nem consulta tenant', async () => {
    authorizeAction.mockResolvedValue({
      ok: false,
      message: 'Sua sessão expirou. Entre novamente para continuar.',
    });

    await expect(fetchOpenHandoffs()).resolves.toEqual({
      ok: false,
      error: 'Sua sessão expirou. Entre novamente para continuar.',
    });
    expect(listOpenHandoffs).not.toHaveBeenCalled();
  });

  it('nega sem permissão antes de consultar a fila', async () => {
    authorizeAction.mockResolvedValue({
      ok: false,
      message: 'Você não tem permissão para esta ação.',
    });

    await expect(fetchOpenHandoffs()).resolves.toEqual({
      ok: false,
      error: 'Você não tem permissão para esta ação.',
    });
    expect(listOpenHandoffs).not.toHaveBeenCalled();
  });

  it('consulta a clínica efetiva quando a sessão está autorizada', async () => {
    const pending = [{ conversationId: 'conversation-1' }];
    authorizeAction.mockResolvedValue({
      ok: true,
      clinicId: 'clinic-1',
    });
    listOpenHandoffs.mockResolvedValue(pending);

    await expect(fetchOpenHandoffs()).resolves.toEqual({ ok: true, data: pending });
    expect(listOpenHandoffs).toHaveBeenCalledWith('clinic-1');
    expect(authorizeAction).toHaveBeenCalledWith('view:conversations', 'cached');
  });
});
