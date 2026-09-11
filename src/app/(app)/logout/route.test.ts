import { beforeEach, describe, expect, it, vi } from 'vitest';

const { bump, signOut, currentUser, redirect, logError } = vi.hoisted(() => ({
  bump: vi.fn(),
  signOut: vi.fn(),
  currentUser: vi.fn(),
  redirect: vi.fn((url: string): never => {
    throw new Error(`redirect:${url}`);
  }),
  logError: vi.fn(),
}));
vi.mock('@/lib/auth/session-epoch', () => ({ bumpSessionEpoch: bump }));
vi.mock('@/lib/auth/supabase-server', () => ({
  createServerClient: async () => ({ auth: { signOut } }),
}));
vi.mock('@/lib/auth/tenant-context', () => ({ getCurrentUser: currentUser }));
vi.mock('@/lib/observability/logger', () => ({ logger: { error: logError } }));
vi.mock('next/navigation', () => ({ redirect }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.mockResolvedValue({ userId: 'local-user' });
  bump.mockResolvedValue(true);
  signOut.mockResolvedValue({ error: null });
});

describe('logout global só confirma as duas revogações', () => {
  it('revoga access antes de refresh e só então redireciona', async () => {
    await expect(POST()).rejects.toThrow('redirect:/login');
    expect(bump).toHaveBeenCalledWith('local-user', 'logout');
    expect(signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(bump.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0]!);
  });
  it('falha retornada pelo Auth não confirma logout nem vaza a mensagem do SDK', async () => {
    signOut.mockResolvedValue({
      error: { code: 'unexpected_failure', message: 'sensitive provider data' },
    });
    const response = await POST();
    expect(response.status).toBe(503);
    expect(redirect).not.toHaveBeenCalled();
    expect(JSON.stringify(logError.mock.calls)).not.toContain('sensitive provider data');
  });
  it.each([false, new Error('database unavailable')])(
    'epoch não confirmado impede revogação parcial: %s',
    async (failure) => {
      if (failure instanceof Error) bump.mockRejectedValue(failure);
      else bump.mockResolvedValue(failure);
      expect((await POST()).status).toBe(503);
      expect(signOut).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    },
  );
  it('sem sessão limpa os cookies sem alterar um profile', async () => {
    currentUser.mockResolvedValue(null);
    await expect(POST()).rejects.toThrow('redirect:/login');
    expect(bump).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledWith({ scope: 'global' });
  });
});
