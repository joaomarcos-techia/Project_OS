import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertMfaAllowed: vi.fn(),
  challengeAndVerify: vi.fn(),
  createServerClient: vi.fn(),
  clearSelector: vi.fn(),
  getClientIp: vi.fn(),
  getUser: vi.fn(),
  listFactors: vi.fn(),
  metricsEmit: vi.fn(),
  redirect: vi.fn(),
  signOut: vi.fn(),
}));

class RedirectSignal extends Error {
  constructor(readonly target: string) {
    super(`redirect:${target}`);
  }
}

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/auth/supabase-server', () => ({
  createServerClient: mocks.createServerClient,
  clearSupabaseSessionSelector: mocks.clearSelector,
}));
vi.mock('@/lib/auth/mfa', () => ({
  challengeAndVerify: mocks.challengeAndVerify,
  getAal: vi.fn(),
  listFactors: mocks.listFactors,
}));
vi.mock('@/lib/auth/policies', () => ({ postLoginRedirect: vi.fn() }));
vi.mock('@/lib/auth/rate-limit', () => ({
  assertMfaAllowed: mocks.assertMfaAllowed,
  getClientIp: mocks.getClientIp,
}));
vi.mock('@/lib/auth/roles', () => ({ isRole: vi.fn() }));
vi.mock('@/lib/auth/tenant-context', () => ({ readAuthoritativeProfile: vi.fn() }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.metricsEmit } }));

import { switchAccountAction, verifyMfaAction } from './actions';

const INITIAL = { error: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createServerClient.mockResolvedValue({
    auth: { getUser: mocks.getUser, signOut: mocks.signOut },
  });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.clearSelector.mockResolvedValue(undefined);
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mocks.getClientIp.mockReturnValue('203.0.113.10');
  mocks.assertMfaAllowed.mockResolvedValue({ ok: true });
  mocks.listFactors.mockResolvedValue([{ id: 'factor-1', status: 'verified' }]);
  mocks.challengeAndVerify.mockResolvedValue(undefined);
  mocks.redirect.mockImplementation((target: string) => {
    throw new RedirectSignal(target);
  });
});

function codeForm(code = '123456'): FormData {
  const data = new FormData();
  data.set('code', code);
  return data;
}

describe('switchAccountAction', () => {
  it('encerra a sessão local antes de redirecionar para o login', async () => {
    await expect(switchAccountAction(INITIAL)).rejects.toMatchObject({ target: '/login' });

    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.clearSelector).toHaveBeenCalledOnce();
    expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.redirect.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(mocks.redirect).toHaveBeenCalledWith('/login');
  });

  it('não confirma a troca quando o seletor não pode ser removido', async () => {
    mocks.clearSelector.mockRejectedValue(new Error('headers committed'));

    await expect(switchAccountAction(INITIAL)).resolves.toEqual({
      error: 'Não foi possível trocar de conta. Tente novamente.',
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('não redireciona quando o Auth devolve erro ao limpar a sessão', async () => {
    mocks.signOut.mockResolvedValue({ error: { message: 'cookie unavailable' } });

    await expect(switchAccountAction(INITIAL)).resolves.toEqual({
      error: 'Não foi possível trocar de conta. Tente novamente.',
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('não redireciona quando a limpeza da sessão lança uma exceção', async () => {
    mocks.signOut.mockRejectedValue(new Error('auth unavailable'));

    await expect(switchAccountAction(INITIAL)).resolves.toEqual({
      error: 'Não foi possível trocar de conta. Tente novamente.',
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe('verifyMfaAction', () => {
  it('não expõe detalhes quando a listagem de fatores falha', async () => {
    mocks.listFactors.mockRejectedValue(new Error('provider internals'));

    await expect(verifyMfaAction(INITIAL, codeForm())).resolves.toEqual({
      error: 'Não foi possível validar o segundo fator. Tente novamente.',
    });
    expect(mocks.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('devolve erro genérico quando o provedor rejeita o código', async () => {
    mocks.challengeAndVerify.mockRejectedValue(new Error('provider secret detail'));

    await expect(verifyMfaAction(INITIAL, codeForm())).resolves.toEqual({
      error: 'Código inválido ou expirado.',
    });
    expect(mocks.metricsEmit).toHaveBeenCalledWith('auth.mfa.failed', { reason: 'Error' });
  });
});
