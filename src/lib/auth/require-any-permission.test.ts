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
const { getClaims, resolveImpersonation, db } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  resolveImpersonation: vi.fn(async () => null),
  db: { profile: [] as unknown[] },
}));

vi.mock('@/lib/auth/supabase-server', () => ({
  createServerClient: async () => ({ auth: { getClaims } }),
}));
vi.mock('@/lib/impersonation', () => ({ resolveImpersonation }));

/**
 * ADR-037: o gate passou a reler o profile do banco a cada request (epoch-check),
 * então `dbAdmin: {}` deixou de bastar. O mock devolve a linha autoritativa que
 * `claims()` deriva — assim estes testes continuam sendo sobre PERMISSÃO, e não
 * viram testes de epoch por acidente. O epoch tem casa própria:
 * `tenant-context.test.ts`.
 */
vi.mock('@/lib/db', () => {
  const chain = (fields: Record<string, unknown> | undefined) => {
    const isProfileRead = !!fields && 'claimsVersion' in fields;
    const p: Record<string, unknown> = {};
    for (const m of ['from', 'leftJoin', 'where']) p[m] = () => p;
    p.limit = () => Promise.resolve(isProfileRead ? db.profile : []);
    return p;
  };
  return {
    dbAdmin: {
      select: (fields: Record<string, unknown>) => chain(fields),
      transaction: (
        fn: (tx: { execute: () => Promise<unknown>; select: typeof chain }) => Promise<unknown>,
      ) => fn({ execute: async () => [], select: chain }),
    },
  };
});

import { PERMISSIONS } from './permissions';

const CAIXA = [PERMISSIONS.OPERATE_CAIXA, PERMISSIONS.MANAGE_FINANCIAL] as const;

/** Claims no formato que o custom_access_token_hook injeta. */
function claims(
  permissions: string[],
  opts: { role?: string; superAdmin?: boolean; aal?: 'aal1' | 'aal2' } = {},
) {
  const c = {
    sub: '11111111-1111-1111-8111-111111111111',
    app_role: opts.role ?? 'attendant',
    clinic_id: '22222222-2222-2222-8222-222222222222',
    permissions,
    claims_version: 1,
    super_admin: opts.superAdmin ?? false,
    aal: opts.aal ?? 'aal1',
  };
  // A linha do banco espelha as claims: o epoch bate e o teste segue focado no OR.
  db.profile = [
    {
      role: c.app_role,
      nome: 'Ana Silva',
      clinicName: 'Clínica Aurora',
      ativo: true,
      deletedAt: null,
      clinicId: c.clinic_id,
      claimsVersion: c.claims_version,
    },
  ];
  return { data: { claims: c }, error: null };
}

/**
 * React.cache() é PASSTHROUGH sob vitest (node puro, sem request scope do React):
 * `requireCachedAnyPermission` recomputa a cada chamada lendo o mock atual. O
 * `vi.resetModules()` + reimport que estava aqui "para escapar da memoização"
 * era desnecessário E era a fonte de flakiness — sob carga de CPU (suíte cheia
 * em paralelo) o resetModules corria com o import() dinâmico e este teste
 * piscava (verde isolado, falho na suíte). O estado que muda entre testes é o
 * mock (resetado no beforeEach), não o módulo.
 */
async function subject() {
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
  // I-1 (2026-07-16): o bypass passou a exigir AAL2. Os dois casos abaixo usavam
  // AAL1 e passavam — hoje isso é a vulnerabilidade, não o comportamento esperado.
  // O bypass em si (P7) continua intacto, agora com o 2º fator provado.
  it('super_admin AAL2 SEM nenhuma permissão passa', async () => {
    getClaims.mockResolvedValue(claims([], { role: 'super_admin', superAdmin: true, aal: 'aal2' }));
    await expect((await subject())(CAIXA)).resolves.toBeUndefined();
  });

  it('super_admin AAL2 sem permissão de caixa passa — era aqui que o check à mão divergia', async () => {
    getClaims.mockResolvedValue(
      claims([PERMISSIONS.VIEW_FINANCIAL], { role: 'super_admin', superAdmin: true, aal: 'aal2' }),
    );
    await expect((await subject())(CAIXA)).resolves.toBeUndefined();
  });

  it('I-1: super_admin em AAL1 NÃO bypassa (antes bypassava)', async () => {
    getClaims.mockResolvedValue(claims([], { role: 'super_admin', superAdmin: true, aal: 'aal1' }));
    await expect((await subject())(CAIXA)).rejects.toMatchObject({ reason: 'MFA_REQUIRED' });
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
