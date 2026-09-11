/**
 * Tenant context — porta ÚNICA para autorização server-side em C3+.
 *
 * Toda Server Action / Route Handler chama um dos `require*` aqui. Nenhum
 * outro lugar em `src/` lê cookies Supabase, JWT, ou faz checks de role/
 * permission. ESLint enforce via no-restricted-imports.
 *
 * Princípios canônicos (ADR-008 + plano C3 v6):
 *   - P1: banco é fonte de verdade. JWT é cache (P2).
 *   - D20: requireCachedPermission (JWT) vs requireFreshPermission (DB).
 *
 * ===================================================================
 * ADR-037 — SESSÃO SERVER-AUTHORITATIVE POR REQUEST (2026-07-16)
 * ===================================================================
 * Este arquivo deixou de ser só "autorização" e passou a ser também o ponto de
 * ENFORCEMENT da sessão. `authenticate()` relê o profile do banco a CADA request
 * e compara `claims_version` do JWT com o do banco. Divergiu → sessão morta.
 *
 * O que isso substitui: antes a revogação dependia do middleware (throttled 60-75s,
 * cookie `_healed` forjável, e declaradamente "não-enforcement" — ADR-009 D22).
 * Um access token sobrevivia a logout/desativação por até 15min (ADR-009 D12).
 * Agora não sobrevive a um request.
 *
 * ⚠️ INVARIANTE QUE SUSTENTA TUDO: `claims_version` bate ⟹ as claims do JWT são
 * atuais. Isso só é verdade porque TODA entrada de `effective_permissions_v` bumpa
 * a versão: role/clinic_id/ativo (trigger BEFORE UPDATE em profiles), overrides
 * (trigger) e role_permissions (trigger da 0040). Se alguém adicionar uma nova
 * fonte de permissão SEM bumpar `claims_version`, este gate passa a aprovar claims
 * velhas em silêncio. Ao mexer em permissão, mexa no bump.
 *
 * ⚠️ `signOut` NÃO mata o access token. `signOut({scope:'global'})` e
 * `auth.admin.signOut()` revogam REFRESH tokens; o access token JWT continua
 * criptograficamente válido até expirar. Quem mata a sessão em curso é o
 * epoch-check daqui — nada mais. Não remova este check achando que o signOut cobre.
 *
 * Custo: 1 SELECT por PK, memoizado por request (`React.cache`). O
 * `requireFreshPermission` compartilha a MESMA leitura — ele já a fazia.
 *
 * NUNCA usar supabase.auth.getSession() — sempre getClaims()/getUser().
 *
 * O placeholder `auditableAction` foi REMOVIDO em C4. Substituído por:
 *   - idempotentMutation()  → default para Server Actions mutativas (C5+).
 *   - auditedMutation()     → mutação + audit sem idempotency (raro).
 *   - superAdminAction()    → ações cross-tenant do super_admin.
 * ESLint barra reintrodução do nome `auditableAction`.
 */
import 'server-only';

import { cache } from 'react';

import { eq, sql } from 'drizzle-orm';

/* eslint-disable boundaries/element-types -- A leitura autoritativa cruza schemas por PK e mantém a decisão de autorização no único ponto de enforcement. */
import {
  permissions as permissionsTable,
  profiles,
  rolePermissions,
  userPermissionOverrides,
} from '@/contexts/identity/schema';
import { clinics } from '@/contexts/tenancy/schema';
/* eslint-enable boundaries/element-types */
import { dbAdmin } from '@/lib/db';
import { resolveImpersonation } from '@/lib/impersonation';

import { parseClaims } from './claims';
import { ALL_PERMISSIONS, type Permission } from './permissions';
import { type Role } from './roles';
import { metrics } from '@/lib/observability/metrics';

import { createServerClient } from './supabase-server';

export type { Role } from './roles';

/**
 * Motivo canônico de uma negativa de identidade. União ÚNICA com DOIS produtores,
 * de propósito: dá uma taxonomia só para log/Sentry/auditoria sem colapsar as
 * camadas.
 *
 *   - SESSÃO (`authenticate`): quem é você e a sessão vale?
 *   - POLÍTICA (`require*`): você pode ISTO?
 *
 * `MFA_REQUIRED` mora do lado de POLÍTICA e NÃO no `IdentityResult`: `authenticate()`
 * não sabe o que a ação exige — quem sabe é `requireSuperAdmin`. Colocá-lo no
 * resultado da autenticação faria a autenticação conhecer as regras de autorização
 * (inversão de dependência).
 */
export type AuthDenialReason =
  // --- sessão (produzido por authenticate) ---
  /** Sem JWT, JWT inválido, ou JWT válido cujas claims o Hook recusou por inconsistência. */
  | 'TOKEN_INVALID'
  /** JWT válido, mas não existe profile para o `sub`. */
  | 'NO_PROFILE'
  /** JWT desatualizado: claims_version do token ≠ do banco. É o fim do replay de 15min. */
  | 'CLAIMS_OUTDATED'
  | 'USER_DISABLED'
  | 'USER_DELETED'
  /** Convite ainda não aceito (invite_accepted_at IS NULL) — a sessão só define a senha (I-3). */
  | 'INVITE_PENDING'
  // --- política (produzido pelos require*) ---
  | 'MFA_REQUIRED'
  | 'ROLE_DENIED'
  | 'PERMISSION_DENIED'
  | 'CLINIC_CONTEXT_REQUIRED';

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: 'unauthenticated' | 'forbidden' | 'config',
    public readonly httpStatus: 401 | 403 | 500,
    /** Motivo estruturado — o log diz `403 CLAIMS_OUTDATED`, não um 401 mudo. */
    public readonly reason: AuthDenialReason,
  ) {
    super(message);
    this.name = 'AuthError';
    // SEC-050 (auditoria adversarial 2026-09-11) — negativa de autorização é
    // EVENTO, não só uma resposta HTTP.
    //
    // Sem isto, sondagem de IDOR/escopo/escalada é indistinguível de silêncio:
    // um atacante podia iterar recursos por meses e a única coisa produzida
    // seria uma sequência de 403 que ninguém conta. O emissor fica no
    // construtor de propósito — é o ponto de estrangulamento pelo qual TODA
    // negativa passa hoje e passará amanhã, e não há decorator para alguém
    // esquecer de aplicar numa rota nova.
    //
    // `metrics.emit` é síncrono, barato e passa por `sanitizeFields`. Só campos
    // estruturais entram: nada de mensagem livre, id de paciente ou payload.
    if (code !== 'config') {
      metrics.emit('authz.denied', { code, reason, httpStatus });
    }
  }
}

export interface CurrentUser {
  userId: string;
  name?: string;
  clinicName?: string | null;
  clinicId: string | null;
  role: Role;
  permissions: readonly string[];
  granularPermissionsEnabled: boolean;
  claimsVersion: number;
  isSuperAdmin: boolean;
  aal: 'aal1' | 'aal2' | null;
  /**
   * C15 — estado de impersonate ENCAPSULADO. NUNCA vira um "role lógico" nem
   * flags soltas em CurrentUser (review #1). Presente só quando um super_admin
   * AAL2 tem uma sessão de impersonate válida (cookie + linha autoritativa).
   * `clinicId` (real) continua `null` para super_admin; o escopo efetivo é
   * resolvido por `requireClinicId()`.
   */
  session?: {
    impersonation?: {
      impersonationId: string;
      clinicId: string;
      /** ISO. */
      startedAt: string;
    };
  };
  /**
   * ISO — quando esta identidade foi revalidada contra o banco (ADR-037). É sempre
   * "neste request": não existe identidade não-validada depois de `authenticate()`.
   * Serve para debug/telemetria responder "de quando é esta decisão?" sem adivinhar.
   */
  validatedAt: string;
}

/** Resultado da autenticação: ou uma identidade validada, ou o MOTIVO da recusa. */
export type IdentityResult =
  | { ok: true; identity: CurrentUser }
  | { ok: false; reason: AuthDenialReason };

/**
 * Leitura AUTORITATIVA do profile — a fonte de verdade (P1) contra a qual o JWT
 * (cache, P2) é conferido.
 *
 * `cache()` por request: `authenticate()` e `requireFreshPermission` compartilham
 * esta leitura. O fresh-check já fazia exatamente este SELECT, então o
 * epoch-check por request NÃO adicionou query nenhuma às ações críticas — só às
 * demais, e uma só (PK indexada, memoizada).
 */
export const readAuthoritativeProfile = cache(async (userId: string) => {
  // O Transaction Pooler pode reutilizar uma conexão administrativa que ficou
  // no papel `authenticator`. Esta é uma leitura cross-tenant estritamente por
  // PK, depois de o JWT já ter fornecido o `sub`; restaura o principal somente
  // dentro da transação curta para a decisão server-authoritative não falhar
  // intermitentemente com `permission denied for table profiles`.
  const rows = await dbAdmin.transaction(async (tx) => {
    await tx.execute(sql`RESET ROLE`);
    return tx
      .select({
        role: profiles.role,
        nome: profiles.nome,
        clinicName: clinics.nome,
        ativo: profiles.ativo,
        mfaEnrolledAt: profiles.mfaEnrolledAt,
        deletedAt: profiles.deletedAt,
        clinicId: profiles.clinicId,
        claimsVersion: profiles.claimsVersion,
        inviteAcceptedAt: profiles.inviteAcceptedAt,
      })
      .from(profiles)
      .leftJoin(clinics, eq(clinics.id, profiles.clinicId))
      .where(eq(profiles.id, userId))
      .limit(1);
  });
  return rows[0] ?? null;
});

/**
 * Persiste o estado MFA sem depender da Data API/PostgREST.
 *
 * Mantém o contrato D31 existente: a mutação continua passando pela função
 * SECURITY DEFINER `mark_mfa_enrolled`, executada como `authenticated`, e
 * `auth.uid()` continua sendo a autoridade sobre a linha que pode ser alterada.
 * O request JWT é reproduzido somente dentro desta transação server-side e os
 * GUCs são descartados no commit/rollback.
 */
export async function markMfaEnrolledForUser(userId: string, enrolled: boolean): Promise<void> {
  const jwtClaims = JSON.stringify({ sub: userId, role: 'authenticated' });

  await dbAdmin.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE authenticated`);
    await tx.execute(sql`SELECT set_config('request.jwt.claim.sub', ${userId}, true)`);
    await tx.execute(sql`SELECT set_config('request.jwt.claims', ${jwtClaims}, true)`);
    await tx.execute(sql`SELECT public.mark_mfa_enrolled(${enrolled})`);
  });
}

/**
 * AUTENTICAÇÃO — parse do JWT → validação → leitura autoritativa → epoch → overlay.
 * Devolve a identidade OU o motivo da recusa. Não throws.
 *
 * Memoizado por request (React.cache): os `require*` chamam isto N vezes por
 * render/action — sem cache, cada chamada refaria getClaims() + o SELECT +
 * resolveImpersonation(). Em páginas tenant isso virava 20+ round-trips
 * sequenciais (12–27s contra banco remoto). O cache é request-scoped: uma
 * revogação vale a partir do PRÓXIMO request, nunca depois de 15min (ADR-037).
 */
export const authenticate = cache(async (): Promise<IdentityResult> => {
  const supabase = await createServerClient();
  // F-17: getClaims() é o caminho recomendado pelo Supabase — verifica o JWT
  // (JWKS local para signing keys assimétricas; round-trip ao Auth server para
  // chaves simétricas, como getUser) E retorna o payload decodado, incluindo as
  // custom claims injetadas pelo Hook (app_role/clinic_id/permissions/...).
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return { ok: false, reason: 'TOKEN_INVALID' };

  const raw = data.claims as Record<string, unknown>;
  const userId = typeof raw.sub === 'string' ? raw.sub : null;
  if (!userId) return { ok: false, reason: 'TOKEN_INVALID' };

  const claims = parseClaims(raw);

  // O Hook é deny-by-default (D36): quando o profile está inativo/deletado/
  // inconsistente ele devolve o token SEM as claims da app. Antes isso virava um
  // `null` mudo e o usuário via "login" sem saber por quê. Como o JWT é válido e
  // temos o `sub`, damos um motivo de verdade — a autoridade continua no banco.
  if (!claims) return { ok: false, reason: await explainMissingClaims(userId) };

  const profile = await readAuthoritativeProfile(userId);
  if (!profile) return { ok: false, reason: 'NO_PROFILE' };
  if (profile.deletedAt !== null) return { ok: false, reason: 'USER_DELETED' };
  if (!profile.ativo) return { ok: false, reason: 'USER_DISABLED' };

  // ADR-037 — O EPOCH-CHECK. Fim do replay de access-token (I-4) e do drift
  // global de role_permissions (I-11b, com o trigger da 0040).
  if (profile.claimsVersion !== claims.claims_version) {
    // A1 (sítio corrigido): a auditoria de monitoramento pedia
    // `auth.claims.drift_logout` no MIDDLEWARE, mas o ADR-037 DELETOU o
    // drift-check de lá — o enforcement mora aqui agora. Sem este sinal, um
    // deploy que derruba as sessões de uma clínica inteira aparece só como
    // "fui deslogado" no suporte, sem como confirmar a hipótese nem medir o
    // alcance. `reason` separa epoch de divergência de claim (abaixo).
    metrics.emit('auth.session.revoked', { reason: 'epoch_mismatch' });
    return { ok: false, reason: 'CLAIMS_OUTDATED' };
  }

  // Defesa em profundidade contra o invariante quebrar em silêncio: se a versão
  // bate mas role/clinic_id divergem, algum bump foi PERDIDO (trigger novo sem
  // bump, escrita fora do caminho). Fail-closed: melhor deslogar do que autorizar
  // por uma claim que ninguém garante mais. Comparado contra as CLAIMS, não contra
  // o `clinicId` efetivo — que o overlay de impersonate reescreve logo abaixo.
  const claimClinicId = claims.clinic_id;
  if (profile.role !== claims.app_role || (profile.clinicId ?? null) !== claimClinicId) {
    // Distinto do epoch acima DE PROPÓSITO: este ramo significa BUMP PERDIDO —
    // a versão bateu mas a claim divergiu. É anomalia de invariante, não
    // rotação normal de sessão, e merece investigação própria.
    metrics.emit('auth.session.revoked', { reason: 'claim_divergence' });
    return { ok: false, reason: 'CLAIMS_OUTDATED' };
  }

  const identity: CurrentUser = {
    userId,
    name: profile.nome,
    clinicName: profile.clinicName ?? null,
    clinicId: claims.clinic_id,
    // JWT claim é 'app_role' (PostgREST reserva 'role'); domain expõe como 'role'.
    role: claims.app_role,
    permissions: claims.permissions,
    granularPermissionsEnabled: claims.granular_permissions_enabled ?? true,
    claimsVersion: claims.claims_version,
    isSuperAdmin: claims.super_admin === true || claims.app_role === 'super_admin',
    aal: claims.aal ?? null,
    validatedAt: new Date().toISOString(),
  };

  // C15 — overlay de impersonate. Só consulta a sessão (1 PK lookup) quando há
  // cookie E o user é super_admin AAL2; usuários normais não pagam nada.
  // Toda a lógica de cookie/HMAC/sessão vive em @/lib/impersonation (review #2).
  //
  // ADR-037 — semântica sob epoch (não-óbvia, testada): o epoch confere o profile
  // do PRÓPRIO super_admin. Mudar o role do owner alvo NÃO derruba a impersonação
  // — e está certo: a sessão está atada a super_admin+clínica, não ao alvo.
  // Desativar o super_admin, esse sim, mata tudo acima (ativo=false).
  const imp = await resolveImpersonation(identity);
  if (imp) {
    identity.session = { impersonation: imp };
    // Identidade EFETIVA durante o impersonate: o fundador opera a clínica como
    // operador pleno. clinic_id efetivo + permissões plenas — o super_admin já
    // bypassa RBAC no servidor (requireCachedPermission/requireFreshPermission/
    // requireRole retornam cedo p/ isSuperAdmin); isto faz a UI tenant (que lê
    // user.clinicId / user.permissions direto) renderizar corretamente.
    // `role`/`isSuperAdmin` PERMANECEM: RLS usa is_super_admin() do JWT e a
    // auditoria atribui ao super_admin. O estado fica explícito em session.
    identity.clinicId = imp.clinicId;
    identity.permissions = ALL_PERMISSIONS;
  }
  return { ok: true, identity };
});

/** Por que o Hook não injetou claims? A resposta está no banco, não no token. */
async function explainMissingClaims(userId: string): Promise<AuthDenialReason> {
  const profile = await readAuthoritativeProfile(userId);
  if (!profile) return 'NO_PROFILE';
  if (profile.deletedAt !== null) return 'USER_DELETED';
  if (!profile.ativo) return 'USER_DISABLED';
  // I-3: convite ainda não aceito. O usuário TEM sessão (magic-link) mas o hook nega
  // claims — a sessão só serve para /convite definir a senha. Motivo explícito para
  // telemetria e para a UX não dizer "sessão inválida" a quem acabou de clicar o link.
  if (profile.inviteAcceptedAt === null) return 'INVITE_PENDING';
  // Profile são e mesmo assim sem claims = inconsistência que o D36 recusou
  // (ex.: role×clinic_id incoerentes). Não inventamos um motivo bonito para isso.
  return 'TOKEN_INVALID';
}

/**
 * User atual ou null. NÃO throws. Contrato PRESERVADO (ADR-037 não quebrou
 * chamador nenhum): quem só quer saber "tem alguém logado?" continua aqui;
 * quem precisa do MOTIVO chama `authenticate()`.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const result = await authenticate();
  return result.ok ? result.identity : null;
}

/** Motivos de sessão → 401 (não é "proibido", é "não é mais você"). */
const AUTH_ERROR_MESSAGE: Record<string, string> = {
  TOKEN_INVALID: 'Autenticação necessária',
  NO_PROFILE: 'Profile inexistente. Contate o administrador.',
  CLAIMS_OUTDATED: 'Sua sessão está desatualizada. Entre novamente.',
  USER_DISABLED: 'Acesso desativado. Contate o administrador da clínica.',
  USER_DELETED: 'Conta removida.',
  INVITE_PENDING: 'Defina sua senha para concluir o convite.',
};

export async function requireUser(): Promise<CurrentUser> {
  const result = await authenticate();
  if (!result.ok) {
    throw new AuthError(
      AUTH_ERROR_MESSAGE[result.reason] ?? 'Autenticação necessária',
      'unauthenticated',
      401,
      result.reason,
    );
  }
  return result.identity;
}

/**
 * I-1 — super_admin bypassa RBAC (P7), mas o bypass agora EXIGE AAL2.
 *
 * Antes, os early-returns `if (user.isSuperAdmin) return` não olhavam `aal`, e a
 * segurança repousava num invariante implícito e não testado ("toda ação alcançável
 * por super_admin também chama requireClinicId ou requireSuperAdmin"). Invariante
 * implícito é uma regressão esperando alguém escrever a próxima action. Agora o
 * bypass é fail-closed no próprio ponto de bypass.
 *
 * Super_admin em AAL1 (pós-senha, pré-TOTP) continua alcançando /login/mfa e
 * /account/security — essas rotas usam `requireUser`, não os gates de RBAC.
 */
function assertPlatformStepUp(user: CurrentUser): void {
  if (user.aal !== 'aal2') {
    throw new AuthError(
      'super_admin precisa de MFA (AAL2) para usar o bypass de RBAC. Reautentique com TOTP.',
      'forbidden',
      403,
      'MFA_REQUIRED',
    );
  }
}

/**
 * Garante clinic_id presente. Resolve o escopo EFETIVO: durante impersonate o
 * super_admin opera como a clínica impersonada (C15). Fora disso, super_admin
 * sem clínica LANÇA — precisa contexto explícito (D27/P7).
 *
 * Ordem (OR-I7): impersonation.clinicId tem prioridade sobre clinicId real.
 * Quando a sessão expira/é revogada, `session.impersonation` some e voltamos a
 * lançar para super_admin (OR-I10).
 */
export async function requireClinicId(): Promise<string> {
  const user = await requireUser();
  const effective = user.session?.impersonation?.clinicId ?? user.clinicId;
  if (effective === null) {
    throw new AuthError(
      'Super_admin precisa selecionar clínica antes desta ação',
      'forbidden',
      403,
      'CLINIC_CONTEXT_REQUIRED',
    );
  }
  return effective;
}

export async function requireRole(allowed: readonly Role[]): Promise<Role> {
  const user = await requireUser();
  // P7: super_admin bypassa RBAC (consistente com requireCachedPermission/
  // requireFreshPermission). Durante impersonate isto permite operar telas tenant
  // gateadas por role; fora dele, super_admin não tem clínica e cai em requireClinicId.
  if (user.isSuperAdmin) {
    assertPlatformStepUp(user); // I-1
    return user.role;
  }
  if (!allowed.includes(user.role)) {
    throw new AuthError(
      `Role '${user.role}' não autorizada. Esperado uma de: ${allowed.join(', ')}`,
      'forbidden',
      403,
      'ROLE_DENIED',
    );
  }
  return user.role;
}

/**
 * Lê permission do JWT (P2/D13).
 *
 * ADR-037 mudou o que "cached" significa: NÃO existe mais janela stale. O JWT só
 * chega aqui depois de `authenticate()` conferir `claims_version` contra o banco
 * NESTE request — ou seja, as permissões do token são comprovadamente atuais.
 * A diferença para `requireFreshPermission` deixou de ser frescor e passou a ser
 * defesa em profundidade (D20): o fresh reconfere overrides/bundle linha a linha,
 * cobrindo até um bump perdido.
 */
export async function requireCachedPermission(perm: Permission): Promise<void> {
  const user = await requireUser();
  if (user.isSuperAdmin) {
    assertPlatformStepUp(user); // I-1
    return; // P7 — platform role bypassa RBAC
  }
  if (!user.permissions.includes(perm)) {
    throw new AuthError(
      `Permissão '${perm}' negada (cached). Verifique role/overrides.`,
      'forbidden',
      403,
      'PERMISSION_DENIED',
    );
  }
}

/**
 * Como `requireCachedPermission`, mas passa se o usuário tiver QUALQUER UMA das
 * permissões (OR). Existe porque o caixa aceita dois papéis para a mesma operação
 * (`OPERATE_CAIXA` OU `MANAGE_FINANCIAL` — decisão de RBAC do founder).
 *
 * B2 (auditoria de APIs): esse OR era montado à mão dentro das actions financeiras,
 * lendo `user.permissions` direto. Parecia equivalente e NÃO era: faltava o bypass
 * `isSuperAdmin` acima, então um super_admin fora de impersonação era negado nessas
 * duas actions e aceito em todas as outras. Authz fora da porta única não é só
 * duplicação — é divergência silenciosa.
 */
export async function requireCachedAnyPermission(perms: readonly Permission[]): Promise<void> {
  const user = await requireUser();
  if (user.isSuperAdmin) {
    assertPlatformStepUp(user); // I-1
    return; // P7 — platform role bypassa RBAC
  }
  if (!perms.some((p) => user.permissions.includes(p))) {
    throw new AuthError(
      `Permissão negada (cached): exige uma de [${perms.join(', ')}].`,
      'forbidden',
      403,
      'PERMISSION_DENIED',
    );
  }
}

/**
 * Revalida permission lendo profile + role_permissions + overrides do banco.
 * Garantia forte (D20): nenhuma janela stale. Custo: uma consulta indexada.
 *
 * USO OBRIGATÓRIO em CRITICAL_ACTIONS (lista em policies/critical-actions.ts).
 * Vitest arch test em F8 falha CI se Server Action listada NÃO chamar este.
 */
export async function requireFreshPermission(perm: Permission): Promise<void> {
  const user = await requireUser();
  if (user.isSuperAdmin) {
    assertPlatformStepUp(user); // I-1
    return;
  }

  // MESMA leitura autoritativa que `authenticate()` já fez neste request
  // (memoizada) — então o epoch-check do ADR-037 saiu DE GRAÇA para as ações
  // críticas, que já pagavam este SELECT.
  //
  // O que este bloco NÃO refaz mais, e por quê: `ativo`, `deleted_at` e a
  // comparação de `clinic_id` (o fix V7 / achado I-6, 2026-07-14) eram feitos
  // AQUI. Agora `authenticate()` os faz — contra a mesma linha, no mesmo request,
  // ANTES de qualquer autorização. Repetir a comparação seria código inalcançável
  // se fingindo de camada de defesa. E o resultado é ESTRITAMENTE mais forte que
  // antes: o V7 só protegia as CRITICAL_ACTIONS; agora vale para TODO request.
  // O contrato está travado em `tenant-context.test.ts`.
  const profile = await readAuthoritativeProfile(user.userId);
  if (!profile) {
    // Narrowing de tipo. Se isto disparar, `authenticate()` foi contornado —
    // ele já teria devolvido NO_PROFILE e o requireUser acima teria lançado.
    throw new AuthError('Profile inexistente', 'forbidden', 403, 'NO_PROFILE');
  }

  // O que o fresh AINDA acrescenta (D20): relê overrides e bundle linha a linha,
  // em vez de confiar no array `permissions` do JWT. Cobre o caso de um bump de
  // claims_version PERDIDO no caminho das permissões — o único furo que o
  // epoch-check não veria, porque a versão bateria.

  // Overrides individuais só entram na decisão quando o plano habilita o
  // recurso. Em downgrade, a view do hook já remove os overrides das novas
  // claims; este check protege também as ações críticas que fazem revalidação
  // direta no banco.
  const [decision] = await dbAdmin.execute<{
    denied_override: boolean;
    granted_override: boolean;
    has_role_permission: boolean;
    in_catalog: boolean;
  }>(sql`
    SELECT
      (${user.granularPermissionsEnabled} AND EXISTS(
        SELECT 1
          FROM ${userPermissionOverrides}
         WHERE ${userPermissionOverrides.userId} = ${user.userId}
           AND ${userPermissionOverrides.permissionCode} = ${perm}
           AND ${userPermissionOverrides.granted} = false
      )) AS denied_override,
      (${user.granularPermissionsEnabled} AND EXISTS(
        SELECT 1
          FROM ${userPermissionOverrides}
         WHERE ${userPermissionOverrides.userId} = ${user.userId}
           AND ${userPermissionOverrides.permissionCode} = ${perm}
           AND ${userPermissionOverrides.granted} = true
      )) AS granted_override,
      EXISTS(
        SELECT 1
          FROM ${rolePermissions}
         WHERE ${rolePermissions.role} = ${profile.role}
           AND ${rolePermissions.permissionCode} = ${perm}
      ) AS has_role_permission,
      EXISTS(
        SELECT 1
          FROM ${permissionsTable}
         WHERE ${permissionsTable.code} = ${perm}
      ) AS in_catalog
  `);

  // Override negando tem precedência sobre todo o resto da decisão.
  if (decision?.denied_override) {
    throw new AuthError(
      `Permissão '${perm}' negada por override (fresh check).`,
      'forbidden',
      403,
      'PERMISSION_DENIED',
    );
  }

  // Override concedendo permite mesmo se a role não tem bundle.
  if (decision?.granted_override) return;

  if (!decision?.has_role_permission) {
    throw new AuthError(
      `Permissão '${perm}' negada (fresh check). Role '${profile.role}' não tem bundle e não há override granted.`,
      'forbidden',
      403,
      'PERMISSION_DENIED',
    );
  }

  // Confirma que a permission ainda existe no catálogo (defesa paranóica
  // contra DELETE em permissions sem CASCADE rebuild — improvável mas barato).
  if (!decision.in_catalog) {
    throw new AuthError(
      `Permissão '${perm}' não existe no catálogo (defesa fresh).`,
      'forbidden',
      403,
      'PERMISSION_DENIED',
    );
  }
}

/**
 * Super_admin EXIGE AAL2 (ADR-038 — a política de MFA, antes citada como um
 * "ADR-008 D6" que nunca existiu como decisão escrita).
 */
export async function requireSuperAdmin(): Promise<void> {
  const user = await requireUser();
  if (!user.isSuperAdmin) {
    throw new AuthError('Requer super_admin', 'forbidden', 403, 'ROLE_DENIED');
  }
  assertPlatformStepUp(user);
}

// auditableAction REMOVIDO em C4. Use idempotentMutation / auditedMutation / superAdminAction.
