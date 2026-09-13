import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
  requireSuperAdmin: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));

// Dentro de `vi.hoisted`: `vi.mock` é içado acima das declarações do módulo, e
// uma `class` no corpo do arquivo ainda não existe quando a fábrica roda.
const { AuthError } = vi.hoisted(() => ({
  AuthError: class AuthError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly httpStatus: number,
      public readonly reason: string,
    ) {
      super(message);
      this.name = 'AuthError';
    }
  },
}));

vi.mock('@/lib/auth/tenant-context', () => ({
  AuthError,
  requireSuperAdmin: mocks.requireSuperAdmin,
}));

import { guardAdminAccess } from './guard';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('guarda do Platform Admin', () => {
  it('deixa passar super_admin com AAL2', async () => {
    mocks.requireSuperAdmin.mockResolvedValue(undefined);

    await expect(guardAdminAccess()).resolves.toBeUndefined();
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('404 para quem NÃO é super_admin — não vaza que o painel existe', async () => {
    mocks.requireSuperAdmin.mockRejectedValue(
      new AuthError('Requer super_admin', 'forbidden', 403, 'ROLE_DENIED'),
    );

    await expect(guardAdminAccess()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('super_admin em AAL1 vai para o step-up, NÃO para 404', async () => {
    // O impasse de 14/09: 404 aqui trancava um super_admin recém-criado fora do
    // produto inteiro — ele precisava de AAL2 para alcançar a única tela que
    // concede AAL2. Quem chega aqui já provou a role; esconder o painel dele não
    // protege nada.
    mocks.requireSuperAdmin.mockRejectedValue(
      new AuthError('precisa de MFA', 'forbidden', 403, 'MFA_REQUIRED'),
    );

    await expect(guardAdminAccess()).rejects.toThrow('NEXT_REDIRECT:/account/security?force=1');
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it('erro que não é AuthError continua em 404 — fail-closed', async () => {
    // Falha inesperada (banco fora, bug) não pode virar redirect: na dúvida, o
    // painel não existe.
    mocks.requireSuperAdmin.mockRejectedValue(new Error('conexão caiu'));

    await expect(guardAdminAccess()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('AuthError de sessão ausente também é 404', async () => {
    mocks.requireSuperAdmin.mockRejectedValue(
      new AuthError('sem sessão', 'unauthenticated', 401, 'NO_SESSION'),
    );

    await expect(guardAdminAccess()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
