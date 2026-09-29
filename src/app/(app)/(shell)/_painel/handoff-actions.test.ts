import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCurrentUser, listOpenHandoffs } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  listOpenHandoffs: vi.fn(),
}));

vi.mock('@/lib/auth/tenant-context', () => ({ getCurrentUser }));
vi.mock('@/contexts/ai-agent/queries', () => ({ listOpenHandoffs }));

import { fetchOpenHandoffs } from './handoff-actions';

describe('fetchOpenHandoffs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sessão sem profile vira fila vazia, sem exceção nem consulta tenant', async () => {
    getCurrentUser.mockResolvedValue(null);

    await expect(fetchOpenHandoffs()).resolves.toEqual([]);
    expect(listOpenHandoffs).not.toHaveBeenCalled();
  });

  it('nega sem permissão antes de consultar a fila', async () => {
    getCurrentUser.mockResolvedValue({
      clinicId: 'clinic-1',
      permissions: [],
    });

    await expect(fetchOpenHandoffs()).resolves.toEqual([]);
    expect(listOpenHandoffs).not.toHaveBeenCalled();
  });

  it('consulta a clínica efetiva quando a sessão está autorizada', async () => {
    const pending = [{ conversationId: 'conversation-1' }];
    getCurrentUser.mockResolvedValue({
      clinicId: 'clinic-1',
      permissions: ['view:conversations'],
    });
    listOpenHandoffs.mockResolvedValue(pending);

    await expect(fetchOpenHandoffs()).resolves.toBe(pending);
    expect(listOpenHandoffs).toHaveBeenCalledWith('clinic-1');
  });
});
