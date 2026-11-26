import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ authenticate: vi.fn(), redirect: vi.fn() }));
vi.mock('@/lib/auth/tenant-context', () => ({ authenticate: m.authenticate }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    m.redirect(to);
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { redirectToLogin } from './session-lock-redirect';

beforeEach(() => vi.clearAllMocks());

describe('redirectToLogin (S2)', () => {
  it('sessão bloqueada por inatividade: login com o aviso próprio', async () => {
    m.authenticate.mockResolvedValue({ ok: false, reason: 'SESSION_LOCKED' });
    await expect(redirectToLogin()).rejects.toThrow('REDIRECT:/login?reason=inactivity');
  });

  it('qualquer outro motivo: o login de sempre', async () => {
    for (const reason of ['TOKEN_INVALID', 'CLAIMS_OUTDATED', 'USER_DISABLED']) {
      m.authenticate.mockResolvedValueOnce({ ok: false, reason });
      await expect(redirectToLogin()).rejects.toThrow('REDIRECT:/login');
    }
    expect(m.redirect).not.toHaveBeenCalledWith('/login?reason=inactivity');
  });
});
