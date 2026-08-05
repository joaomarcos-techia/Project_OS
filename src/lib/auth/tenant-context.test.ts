/**
 * Porta única de autorização — o arquivo mais importante do sistema, e que até
 * 2026-07-16 era quase intestado (só `require-any-permission.test.ts` o exercitava,
 * de raspão). Este teste trava o contrato do ADR-037.
 *
 * Seam: mockar `tenant-context` não serve — os helpers chamam o `authenticate`
 * local do módulo, não o export. Mockamos as DEPENDÊNCIAS (supabase, impersonação,
 * dbAdmin) e exercitamos a porta única de verdade. `authenticate` é `cache()`-ado,
 * por isso o módulo é reimportado a cada teste.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getClaims, resolveImpersonation, db } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  resolveImpersonation: vi.fn(async () => null),
  db: {
    /**
     * A LINHA autoritativa (estado, não fila). Espelha a memoização de produção:
     * quantas vezes o código leia o profile no mesmo request, a resposta é a mesma.
     * Fila aqui seria frágil e testaria contagem de chamadas, não comportamento.
     */
    profile: [] as unknown[],
    /** Respostas da consulta atômica de permissão. */
    queue: [] as unknown[][],
    execute: vi.fn(),
    profileReads: 0,
  },
}));

vi.mock('@/lib/auth/supabase-server', () => ({
  createServerClient: async () => ({ auth: { getClaims } }),
}));
vi.mock('@/lib/impersonation', () => ({ resolveImpersonation }));

/**
 * Mock do query builder do Drizzle. Discrimina a query pelo SHAPE do `select()`:
 * só a leitura autoritativa do profile pede `claimsVersion`. Assim o teste não
 * depende da ordem das chamadas.
 */
vi.mock('@/lib/db', () => {
  const chain = (fields: Record<string, unknown> | undefined) => {
    const isProfileRead = !!fields && 'claimsVersion' in fields;
    const p: Record<string, unknown> = {};
    for (const m of ['from', 'leftJoin', 'where']) p[m] = () => p;
    p.limit = () => {
      if (isProfileRead) {
        db.profileReads += 1;
        return Promise.resolve(db.profile);
      }
      return Promise.resolve(db.queue.shift() ?? []);
    };
    return p;
  };
  return {
    dbAdmin: {
      select: (fields: Record<string, unknown>) => chain(fields),
      execute: (...args: unknown[]) => {
        db.execute(...args);
        return Promise.resolve(db.queue.shift() ?? []);
      },
    },
  };
});

const USER = '11111111-1111-1111-1111-111111111111';
const CLINIC = '22222222-2222-2222-2222-222222222222';
const OTHER_CLINIC = '33333333-3333-3333-3333-333333333333';

type ClaimOpts = {
  role?: string;
  superAdmin?: boolean;
  aal?: 'aal1' | 'aal2';
  clinicId?: string | null;
  claimsVersion?: number;
  permissions?: string[];
};

function claims(o: ClaimOpts = {}) {
  return {
    data: {
      claims: {
        sub: USER,
        app_role: o.role ?? 'attendant',
        clinic_id: o.clinicId === undefined ? CLINIC : o.clinicId,
        permissions: o.permissions ?? ['view:patient'],
        claims_version: o.claimsVersion ?? 1,
        super_admin: o.superAdmin ?? false,
        aal: o.aal ?? 'aal1',
      },
    },
    error: null,
  };
}

type ProfileOpts = {
  nome?: string;
  clinicName?: string | null;
  role?: string;
  ativo?: boolean;
  deletedAt?: Date | null;
  clinicId?: string | null;
  claimsVersion?: number;
  inviteAcceptedAt?: Date | null;
};

/** A linha autoritativa do banco (o que `readAuthoritativeProfile` devolve). */
function profile(o: ProfileOpts = {}) {
  return [
    {
      role: o.role ?? 'attendant',
      nome: o.nome ?? 'Ana Silva',
      clinicName: o.clinicName === undefined ? 'Clínica Aurora' : o.clinicName,
      ativo: o.ativo ?? true,
      deletedAt: o.deletedAt ?? null,
      clinicId: o.clinicId === undefined ? CLINIC : o.clinicId,
      claimsVersion: o.claimsVersion ?? 1,
      inviteAcceptedAt: o.inviteAcceptedAt === undefined ? new Date() : o.inviteAcceptedAt,
    },
  ];
}

async function subject() {
  // Antes: `vi.resetModules()` + reimport a cada teste, "para escapar da
  // memoização do cache()". Isso era desnecessário E era a fonte da flakiness:
  // `resetModules` + import() dinâmico corre com o scheduler sob carga de CPU
  // (suíte cheia em paralelo), e os testes de auth piscavam (0–3 falhas por
  // rodada, verde isolado). React.cache() só memoiza dentro de um request scope
  // do React; sob vitest (node puro, sem dispatcher) ele é PASSTHROUGH —
  // `authenticate()` recomputa a cada chamada lendo o mock atual. Logo o módulo
  // pode ser reusado; o estado que muda entre testes é o mock, resetado no
  // beforeEach. Ver o comentário gêmeo em require-any-permission.test.ts.
  return import('./tenant-context');
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveImpersonation.mockResolvedValue(null);
  db.profile = [];
  db.queue = [];
  db.execute.mockReset();
  db.profileReads = 0;
});

// =====================================================================
// ADR-037 — epoch por request (I-4: fim do replay de access-token)
// =====================================================================
describe('epoch: claims_version do JWT × banco', () => {
  it('versões batem → identidade validada', async () => {
    getClaims.mockResolvedValue(claims({ claimsVersion: 7 }));
    db.profile = profile({ claimsVersion: 7 });
    const { authenticate } = await subject();
    await expect(authenticate()).resolves.toMatchObject({ ok: true });
  });

  it('JWT com versão ANTIGA → CLAIMS_OUTDATED (o replay de 15min morre aqui)', async () => {
    getClaims.mockResolvedValue(claims({ claimsVersion: 4 })); // token emitido antes do bump
    db.profile = profile({ claimsVersion: 5 }); // banco já mudou
    const { authenticate } = await subject();
    await expect(authenticate()).resolves.toEqual({ ok: false, reason: 'CLAIMS_OUTDATED' });
  });

  it('requireUser transforma CLAIMS_OUTDATED em 401 COM motivo (não um 401 mudo)', async () => {
    getClaims.mockResolvedValue(claims({ claimsVersion: 1 }));
    db.profile = profile({ claimsVersion: 2 });
    const { requireUser } = await subject();
    await expect(requireUser()).rejects.toMatchObject({
      name: 'AuthError',
      code: 'unauthenticated',
      httpStatus: 401,
      reason: 'CLAIMS_OUTDATED',
    });
  });

  it('getCurrentUser mantém o contrato (null) — nenhum chamador quebrou', async () => {
    getClaims.mockResolvedValue(claims({ claimsVersion: 1 }));
    db.profile = profile({ claimsVersion: 9 });
    const { getCurrentUser } = await subject();
    await expect(getCurrentUser()).resolves.toBeNull();
  });
});

describe('estado do profile manda sobre o token', () => {
  it('ativo=false → USER_DISABLED, mesmo com JWT válido e versão batendo', async () => {
    getClaims.mockResolvedValue(claims());
    db.profile = profile({ ativo: false });
    const { authenticate } = await subject();
    await expect(authenticate()).resolves.toEqual({ ok: false, reason: 'USER_DISABLED' });
  });

  it('deleted_at → USER_DELETED (precede o check de ativo)', async () => {
    getClaims.mockResolvedValue(claims());
    db.profile = profile({ deletedAt: new Date(), ativo: false });
    const { authenticate } = await subject();
    await expect(authenticate()).resolves.toEqual({ ok: false, reason: 'USER_DELETED' });
  });

  it('profile sumiu → NO_PROFILE', async () => {
    getClaims.mockResolvedValue(claims());
    db.profile = [];
    const { authenticate } = await subject();
    await expect(authenticate()).resolves.toEqual({ ok: false, reason: 'NO_PROFILE' });
  });

  it('sem sessão → TOKEN_INVALID', async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error('no session') });
    const { authenticate } = await subject();
    await expect(authenticate()).resolves.toEqual({ ok: false, reason: 'TOKEN_INVALID' });
  });
});

describe('I-3: convite pendente', () => {
  it('hook nega claims (sem app_role) + profile pendente → INVITE_PENDING, não TOKEN_INVALID', async () => {
    // O hook devolveu o token SEM as claims da app (deny-by-default por
    // invite_accepted_at IS NULL). getClaims traz só o `sub`; parseClaims falha; o
    // authenticate consulta o banco para dar o motivo REAL.
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    db.profile = profile({ inviteAcceptedAt: null });
    const { authenticate } = await subject();
    await expect(authenticate()).resolves.toEqual({ ok: false, reason: 'INVITE_PENDING' });
  });

  it('profile aceito mas hook não injetou claims (inconsistência) → TOKEN_INVALID', async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    db.profile = profile({ inviteAcceptedAt: new Date() });
    const { authenticate } = await subject();
    await expect(authenticate()).resolves.toEqual({ ok: false, reason: 'TOKEN_INVALID' });
  });
});

describe('invariante do epoch: bump perdido é fail-closed', () => {
  it('versão bate mas o role divergiu → CLAIMS_OUTDATED (não autoriza pela claim velha)', async () => {
    getClaims.mockResolvedValue(claims({ role: 'attendant', claimsVersion: 3 }));
    db.profile = profile({ role: 'owner', claimsVersion: 3 }); // trigger falhou
    const { authenticate } = await subject();
    await expect(authenticate()).resolves.toEqual({ ok: false, reason: 'CLAIMS_OUTDATED' });
  });

  it('versão bate mas o clinic_id divergiu → CLAIMS_OUTDATED', async () => {
    getClaims.mockResolvedValue(claims({ clinicId: CLINIC, claimsVersion: 3 }));
    db.profile = profile({ clinicId: OTHER_CLINIC, claimsVersion: 3 });
    const { authenticate } = await subject();
    await expect(authenticate()).resolves.toEqual({ ok: false, reason: 'CLAIMS_OUTDATED' });
  });
});

// =====================================================================
// I-1 — o bypass de super_admin exige AAL2
// =====================================================================
describe('I-1: super_admin em AAL1 não bypassa RBAC', () => {
  const superAal = (aal: 'aal1' | 'aal2') =>
    claims({ role: 'super_admin', superAdmin: true, aal, clinicId: null, permissions: [] });
  const superProfile = () => profile({ role: 'super_admin', clinicId: null });

  it.each([
    'requireRole',
    'requireCachedPermission',
    'requireCachedAnyPermission',
    'requireFreshPermission',
  ] as const)('%s: AAL1 → 403 MFA_REQUIRED', async (helper) => {
    getClaims.mockResolvedValue(superAal('aal1'));
    db.profile = superProfile();
    const mod = await subject();
    const call: Record<string, () => Promise<unknown>> = {
      requireRole: () => mod.requireRole(['owner']),
      requireCachedPermission: () => mod.requireCachedPermission('view:patient'),
      requireCachedAnyPermission: () => mod.requireCachedAnyPermission(['view:patient']),
      requireFreshPermission: () => mod.requireFreshPermission('view:patient'),
    };
    await expect(call[helper]!()).rejects.toMatchObject({
      code: 'forbidden',
      httpStatus: 403,
      reason: 'MFA_REQUIRED',
    });
  });

  it.each([
    'requireRole',
    'requireCachedPermission',
    'requireCachedAnyPermission',
    'requireFreshPermission',
  ] as const)(
    '%s: AAL2 → bypass funciona (P7 preservado, não apertamos acesso legítimo)',
    async (helper) => {
      getClaims.mockResolvedValue(superAal('aal2'));
      db.profile = superProfile();
      const mod = await subject();
      const call: Record<string, () => Promise<unknown>> = {
        requireRole: () => mod.requireRole(['owner']),
        requireCachedPermission: () => mod.requireCachedPermission('view:patient'),
        requireCachedAnyPermission: () => mod.requireCachedAnyPermission(['view:patient']),
        requireFreshPermission: () => mod.requireFreshPermission('view:patient'),
      };
      await expect(call[helper]!()).resolves.not.toThrow();
    },
  );

  it('requireSuperAdmin: não-super_admin → ROLE_DENIED (e não MFA_REQUIRED)', async () => {
    getClaims.mockResolvedValue(claims({ aal: 'aal2' }));
    db.profile = profile();
    const { requireSuperAdmin } = await subject();
    await expect(requireSuperAdmin()).rejects.toMatchObject({ reason: 'ROLE_DENIED' });
  });

  it('super_admin AAL1 ainda é autenticado — /login/mfa e /account/security usam requireUser', async () => {
    getClaims.mockResolvedValue(superAal('aal1'));
    db.profile = superProfile();
    const { requireUser } = await subject();
    await expect(requireUser()).resolves.toMatchObject({ isSuperAdmin: true, aal: 'aal1' });
  });
});

// =====================================================================
// requireClinicId / impersonação
// =====================================================================
describe('requireClinicId', () => {
  it('tenant devolve a própria clínica', async () => {
    getClaims.mockResolvedValue(claims());
    db.profile = profile();
    const { requireClinicId } = await subject();
    await expect(requireClinicId()).resolves.toBe(CLINIC);
  });

  it('super_admin sem impersonate → CLINIC_CONTEXT_REQUIRED', async () => {
    getClaims.mockResolvedValue(
      claims({ role: 'super_admin', superAdmin: true, aal: 'aal2', clinicId: null }),
    );
    db.profile = profile({ role: 'super_admin', clinicId: null });
    const { requireClinicId } = await subject();
    await expect(requireClinicId()).rejects.toMatchObject({ reason: 'CLINIC_CONTEXT_REQUIRED' });
  });

  it('impersonate tem precedência sobre o clinicId real (OR-I7)', async () => {
    getClaims.mockResolvedValue(
      claims({ role: 'super_admin', superAdmin: true, aal: 'aal2', clinicId: null }),
    );
    db.profile = profile({ role: 'super_admin', clinicId: null });
    resolveImpersonation.mockResolvedValue({
      impersonationId: 'imp-1',
      clinicId: OTHER_CLINIC,
      startedAt: new Date().toISOString(),
    } as never);
    const { requireClinicId } = await subject();
    await expect(requireClinicId()).resolves.toBe(OTHER_CLINIC);
  });
});

// =====================================================================
// I-6 / V7 — o clinic_id é revalidado contra o banco
// =====================================================================
describe('I-6: divergência de clinic_id (V7, 2026-07-14) — agora em TODO request', () => {
  it('o check saiu do fresh e subiu para o authenticate — cobertura AUMENTOU', async () => {
    // O fix V7 original comparava clinic_id (banco × JWT) dentro do
    // requireFreshPermission, ou seja, só nas CRITICAL_ACTIONS. Agora o
    // authenticate() faz a comparação em TODO request, contra a mesma linha
    // memoizada — então repetir no fresh seria código inalcançável. O teste que
    // prova o comportamento é o de `invariante do epoch` acima; este aqui existe
    // para explicar por que o check NÃO está mais no fresh, e falhar se alguém
    // reintroduzir a divergência sem cobrir.
    getClaims.mockResolvedValue(claims({ clinicId: CLINIC, claimsVersion: 3 }));
    db.profile = profile({ clinicId: OTHER_CLINIC, claimsVersion: 3 });
    const mod = await subject();
    // Uma ação NÃO-crítica (que nunca passou pelo fresh) já é barrada:
    await expect(mod.requireCachedPermission('view:patient')).rejects.toMatchObject({
      reason: 'CLAIMS_OUTDATED',
    });
  });

  it('deny-override barra mesmo com a role tendo a permissão', async () => {
    getClaims.mockResolvedValue(claims());
    db.profile = profile();
    db.queue = [
      [
        {
          denied_override: true,
          granted_override: false,
          has_role_permission: true,
          in_catalog: true,
        },
      ],
    ];
    const { requireFreshPermission } = await subject();
    await expect(requireFreshPermission('view:patient')).rejects.toMatchObject({
      reason: 'PERMISSION_DENIED',
    });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('grant-override permite mesmo sem bundle da role', async () => {
    getClaims.mockResolvedValue(claims());
    db.profile = profile();
    db.queue = [
      [
        {
          denied_override: false,
          granted_override: true,
          has_role_permission: false,
          in_catalog: true,
        },
      ],
    ];
    const { requireFreshPermission } = await subject();
    await expect(requireFreshPermission('delete:patient')).resolves.toBeUndefined();
  });

  it('sem override e sem bundle → PERMISSION_DENIED', async () => {
    getClaims.mockResolvedValue(claims());
    db.profile = profile();
    db.queue = [
      [
        {
          denied_override: false,
          granted_override: false,
          has_role_permission: false,
          in_catalog: true,
        },
      ],
    ];
    const { requireFreshPermission } = await subject();
    await expect(requireFreshPermission('delete:patient')).rejects.toMatchObject({
      reason: 'PERMISSION_DENIED',
    });
  });
});

// =====================================================================
// Concorrência — onde o modelo server-authoritative é mais exigido
// =====================================================================
describe('concorrência', () => {
  /**
   * ⚠️ O QUE ESTE ARQUIVO **NÃO** CONSEGUE PROVAR: que `authenticate()` faz 1
   * leitura por request. `React.cache()` só memoiza dentro de um request scope do
   * React; sob vitest (node puro) ele é passthrough. Contar leituras aqui mediria o
   * ambiente de teste, não o comportamento de produção — seria um teste que
   * *parece* cobrir e não cobre. A memoização é verificada onde ela existe: no app
   * de verdade (ver "Prova por quebra" no ADR-037).
   *
   * O que dá para provar aqui, e importa mais: chamadas concorrentes são
   * CONSISTENTES, e a decisão é sempre do banco — nunca herdada.
   */
  it('chamadas concorrentes no mesmo request decidem igual', async () => {
    getClaims.mockResolvedValue(claims());
    db.profile = profile();
    const { authenticate } = await subject();
    const [a, b] = await Promise.all([authenticate(), authenticate()]);
    // Compara a DECISÃO, não o `validatedAt` (wall-clock): sob React.cache real as
    // duas chamadas partilham 1 resultado; sob vitest (passthrough) cada uma gera
    // seu próprio timestamp — asserir toEqual incluindo validatedAt seria confiar
    // numa memoização que o ambiente de teste não tem (ver o aviso deste describe).
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.identity.userId).toBe(b.identity.userId);
      expect(a.identity.role).toBe(b.identity.role);
      expect(a.identity.claimsVersion).toBe(b.identity.claimsVersion);
    }
  });

  it('duas chamadas concorrentes com o banco já negando: NENHUMA passa', async () => {
    getClaims.mockResolvedValue(claims());
    db.profile = profile({ ativo: false });
    const { authenticate } = await subject();
    const results = await Promise.all([authenticate(), authenticate(), authenticate()]);
    expect(results.every((r) => !r.ok)).toBe(true);
  });

  it('desativação no meio: o request seguinte NÃO herda a autorização do anterior', async () => {
    // Request 1 — usuário ativo, passa.
    getClaims.mockResolvedValue(claims());
    db.profile = profile();
    const first = await subject();
    await expect(first.requireUser()).resolves.toMatchObject({ userId: USER });

    // Request 2 (módulo reimportado = novo request scope) — desativado no meio.
    // O JWT em mãos é o MESMO e continua válido; o banco é que mudou.
    db.profile = profile({ ativo: false });
    const second = await subject();
    await expect(second.requireUser()).rejects.toMatchObject({ reason: 'USER_DISABLED' });
  });

  it('refresh concorrente: JWT antigo é negado enquanto o novo passa', async () => {
    // O bump levou o banco para v2. O token antigo (v1) ainda não expirou.
    getClaims.mockResolvedValue(claims({ claimsVersion: 1 }));
    db.profile = profile({ claimsVersion: 2 });
    const stale = await subject();
    await expect(stale.authenticate()).resolves.toEqual({ ok: false, reason: 'CLAIMS_OUTDATED' });

    // O refresh emitiu um token v2 — mesma sessão, request novo.
    getClaims.mockResolvedValue(claims({ claimsVersion: 2 }));
    db.profile = profile({ claimsVersion: 2 });
    const fresh = await subject();
    await expect(fresh.authenticate()).resolves.toMatchObject({ ok: true });
  });

  it('impersonate sob epoch: mudar o role do ALVO não derruba a sessão do super_admin', async () => {
    // Semântica não-óbvia e deliberada (ADR-037): o epoch confere o profile de QUEM
    // está logado — o super_admin. A sessão de impersonate está atada a
    // super_admin+clínica, não ao usuário-alvo. O alvo mudar de role é irrelevante.
    getClaims.mockResolvedValue(
      claims({
        role: 'super_admin',
        superAdmin: true,
        aal: 'aal2',
        clinicId: null,
        claimsVersion: 5,
      }),
    );
    db.profile = profile({ role: 'super_admin', clinicId: null, claimsVersion: 5 });
    resolveImpersonation.mockResolvedValue({
      impersonationId: 'imp-1',
      clinicId: CLINIC,
      startedAt: new Date().toISOString(),
    } as never);
    const mod = await subject();
    const res = await mod.authenticate();
    expect(res).toMatchObject({ ok: true, identity: { clinicId: CLINIC } });
  });

  it('contraprova: desativar o PRÓPRIO super_admin mata a impersonação na hora', async () => {
    getClaims.mockResolvedValue(
      claims({ role: 'super_admin', superAdmin: true, aal: 'aal2', clinicId: null }),
    );
    db.profile = profile({ role: 'super_admin', clinicId: null, ativo: false });
    resolveImpersonation.mockResolvedValue({
      impersonationId: 'imp-1',
      clinicId: CLINIC,
      startedAt: new Date().toISOString(),
    } as never);
    const mod = await subject();
    await expect(mod.authenticate()).resolves.toEqual({ ok: false, reason: 'USER_DISABLED' });
    // E nem chegou a consultar a sessão de impersonate: o profile já barrou.
    expect(resolveImpersonation).not.toHaveBeenCalled();
  });
});

describe('identidade validada carrega a prova (validatedAt)', () => {
  it('validatedAt é preenchido e claimsVersion reflete o token conferido', async () => {
    getClaims.mockResolvedValue(claims({ claimsVersion: 3 }));
    db.profile = profile({ claimsVersion: 3 });
    const { requireUser } = await subject();
    const user = await requireUser();
    expect(user.name).toBe('Ana Silva');
    expect(user.claimsVersion).toBe(3);
    expect(Date.parse(user.validatedAt)).not.toBeNaN();
  });
});
