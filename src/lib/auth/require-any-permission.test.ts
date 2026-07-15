import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * B2 (auditoria de APIs) — `requireCachedAnyPermission`.
 *
 * A auditoria classificou o B2 como cosmético ("duplica lógica de authz"). Não era:
 * o OR montado à mão lia `user.permissions` direto e NÃO tinha o bypass
 * `isSuperAdmin` da porta única. Efeito: um super_admin fora de impersonação era
 * NEGADO em confirmPayment/cancelLancamento e aceito em todas as outras actions
 * financeiras. Estes testes travam o bypass e a não-regressão dos roles de tenant.
 *
 * Seam: mockar `tenant-context` não serve — `requireCachedAnyPermission` chama o
 * `requireUser` local do módulo, não o export. Então mockamos as DEPENDÊNCIAS de
 * `getCurrentUser` (supabase + impersonação) e exercitamos a porta única de verdade.
 * `getCurrentUser` é `cache()`-ado, por isso o módulo é reimportado a cada teste.
 */
const { getClaims, resolveImpersonation } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  resolveImpersonation: vi.fn(async () => null),
}));

vi.mock('@/lib/auth/supabase-server', () => ({
  createServerClient: async () => ({ auth: { getClaims } }),
}));
vi.mock('@/lib/impersonation', () => ({ resolveImpersonation }));
vi.mock('@/lib/db', () => ({ dbAdmin: {} }));

import { PERMISSIONS } from './permissions';

const CAIXA = [PERMISSIONS.OPERATE_CAIXA, PERMISSIONS.MANAGE_FINANCIAL] as const;

/** Claims no formato que o custom_access_token_hook injeta. */
function claims(permissions: string[], opts: { role?: string; superAdmin?: boolean } = {}) {
  return {
    data: {
      claims: {
        sub: '11111111-1111-1111-1111-111111111111',
        app_role: opts.role ?? 'attendant',
        clinic_id: '22222222-2222-2222-2222-222222222222',
        permissions,
        claims_version: 1,
        super_admin: opts.superAdmin ?? false,
        aal: 'aal1',
      },
    },
    error: null,
  };
}

/** Reimporta o módulo para escapar da memoização do `cache()` entre testes. */
async function subject() {
  vi.resetModules();
  const mod = await import('./tenant-context');
  return mod.requireCachedAnyPermission;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveImpersonation.mockResolvedValue(null);
});

describe('passa com QUALQUER uma das permissões', () => {
  it('só a primeira', async () => {
    getClaims.mockResolvedValue(claims([PERMISSIONS.OPERATE_CAIXA]));
    await expect((await subject())(CAIXA)).resolves.toBeUndefined();
  });

  it('só a segunda', async () => {
    getClaims.mockResolvedValue(claims([PERMISSIONS.MANAGE_FINANCIAL]));
    await expect((await subject())(CAIXA)).resolves.toBeUndefined();
  });

  it('as duas', async () => {
    getClaims.mockResolvedValue(claims([PERMISSIONS.OPERATE_CAIXA, PERMISSIONS.MANAGE_FINANCIAL]));
    await expect((await subject())(CAIXA)).resolves.toBeUndefined();
  });
});

describe('barra quem não tem nenhuma', () => {
  it('permissões vazias → AuthError 403', async () => {
    getClaims.mockResolvedValue(claims([]));
    await expect((await subject())(CAIXA)).rejects.toMatchObject({
      name: 'AuthError',
      code: 'forbidden',
      httpStatus: 403,
    });
  });

  it('outra permissão qualquer → 403', async () => {
    getClaims.mockResolvedValue(claims([PERMISSIONS.VIEW_FINANCIAL]));
    await expect((await subject())(CAIXA)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('a mensagem diz o que é EXIGIDO, não o que o usuário tem', async () => {
    getClaims.mockResolvedValue(claims([PERMISSIONS.VIEW_FINANCIAL]));
    await expect((await subject())(CAIXA)).rejects.toThrow(/exige uma de/);
  });
});

describe('bypass de super_admin (P7) — o bug que o B2 fecha', () => {
  it('super_admin SEM nenhuma permissão passa', async () => {
    getClaims.mockResolvedValue(claims([], { role: 'super_admin', superAdmin: true }));
    await expect((await subject())(CAIXA)).resolves.toBeUndefined();
  });

  it('super_admin sem permissão de caixa passa — era aqui que o check à mão divergia', async () => {
    getClaims.mockResolvedValue(
      claims([PERMISSIONS.VIEW_FINANCIAL], { role: 'super_admin', superAdmin: true }),
    );
    await expect((await subject())(CAIXA)).resolves.toBeUndefined();
  });
});

describe('não-regressão dos roles de tenant', () => {
  // O projeto não tem `tenant_admin`; os roles reais são gestor/doctor/attendant/
  // financial/owner/super_admin ([roles.ts]). Quem operava o caixa antes tem de
  // seguir operando — trocar o check à mão pela porta única não pode apertar acesso.
  it.each([
    ['gestor', [PERMISSIONS.MANAGE_FINANCIAL]],
    ['owner', [PERMISSIONS.MANAGE_FINANCIAL, PERMISSIONS.OPERATE_CAIXA]],
    ['financial', [PERMISSIONS.MANAGE_FINANCIAL]],
    ['attendant', [PERMISSIONS.OPERATE_CAIXA]],
  ])('%s com permissão de caixa continua passando', async (role, perms) => {
    getClaims.mockResolvedValue(claims(perms as string[], { role }));
    await expect((await subject())(CAIXA)).resolves.toBeUndefined();
  });

  it('doctor sem permissão de caixa segue barrado', async () => {
    getClaims.mockResolvedValue(claims([PERMISSIONS.EDIT_AGENDA], { role: 'doctor' }));
    await expect((await subject())(CAIXA)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('sessão ausente', () => {
  it('sem claims → AuthError unauthenticated (401), não 403', async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error('no session') });
    await expect((await subject())(CAIXA)).rejects.toMatchObject({
      name: 'AuthError',
      code: 'unauthenticated',
      httpStatus: 401,
    });
  });
});
