/**
 * Tenant context — porta ÚNICA para autorização server-side em C3+.
 *
 * Toda Server Action / Route Handler chama um dos `require*` aqui. Nenhum
 * outro lugar em `src/` lê cookies Supabase, JWT, ou faz checks de role/
 * permission. ESLint enforce via no-restricted-imports.
 *
 * Princípios canônicos (ADR-008 + plano C3 v6):
 *   - P1: banco é fonte de verdade. JWT é cache (P2).
 *   - P5: claims drift mitigation, não auto-heal.
 *   - D20: requireCachedPermission (JWT) vs requireFreshPermission (DB).
 *   - D22: middleware NÃO é enforcement primário. Toda action revalida AQUI.
 *
 * Helpers:
 *   - getCurrentUser(): user atual ou null (não throw).
 *   - requireUser(): throw 401.
 *   - requireClinicId(): throw 403 se super_admin (precisa contexto explícito).
 *   - requireRole(allowed): throw 403.
 *   - requireCachedPermission(perm): throw 403 (lê JWT — D33).
 *   - requireFreshPermission(perm): throw 403 (revalida no banco — D20).
 *   - requireSuperAdmin(): throw se não super_admin OU se aal !== 'aal2' (D6).
 *
 * NUNCA usar supabase.auth.getSession() — sempre getUser() (validação server-side).
 *
 * O placeholder `auditableAction` foi REMOVIDO em C4. Substituído por:
 *   - idempotentMutation()  → default para Server Actions mutativas (C5+).
 *   - auditedMutation()     → mutação + audit sem idempotency (raro).
 *   - superAdminAction()    → ações cross-tenant do super_admin.
 * ESLint barra reintrodução do nome `auditableAction`.
 */
import 'server-only';

import { and, eq } from 'drizzle-orm';

/* eslint-disable boundaries/element-types -- D35-style: requireFreshPermission revalida no banco; schemas vivem em context (Drizzle FK precisa estar onde a tabela é declarada). Mesma exceção do tenancy.tenantIdRef em outros contexts. */
import {
  permissions as permissionsTable,
  profiles,
  rolePermissions,
  userPermissionOverrides,
} from '@/contexts/identity/schema';
/* eslint-enable boundaries/element-types */
import { dbAdmin } from '@/lib/db';

import { parseClaims } from './claims';
import { type Permission } from './permissions';
import { type Role } from './roles';
import { createServerClient } from './supabase-server';

export type { Role } from './roles';

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: 'unauthenticated' | 'forbidden' | 'config',
    public readonly httpStatus: 401 | 403 | 500,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface CurrentUser {
  userId: string;
  clinicId: string | null;
  role: Role;
  permissions: readonly string[];
  claimsVersion: number;
  isSuperAdmin: boolean;
  aal: 'aal1' | 'aal2' | null;
}

/**
 * Retorna o user atual ou null. NÃO throws. Wrapper sobre supabase.auth.getUser()
 * + parsing das custom claims injetadas pelo Hook (0003).
 *
 * Token sem claims (Hook deny-by-default, D36) → retorna null (chamador trata
 * como sem autorização). Middleware vai redirecionar /login.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createServerClient();
  // F-17: getClaims() é o caminho recomendado pelo Supabase — verifica o JWT
  // (JWKS local para signing keys assimétricas; round-trip ao Auth server para
  // chaves simétricas, como getUser) E retorna o payload decodado, incluindo as
  // custom claims injetadas pelo Hook (app_role/clinic_id/permissions/...).
  // Substitui getUser()+getSession()+decode manual — sem mais eslint-disable de
  // getSession, sem decode base64 caseiro. (auth-js 2.106.2 expõe getClaims.)
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;

  const raw = data.claims as Record<string, unknown>;
  const userId = typeof raw.sub === 'string' ? raw.sub : null;
  if (!userId) return null;

  const claims = parseClaims(raw);
  if (!claims) return null;

  return {
    userId,
    clinicId: claims.clinic_id,
    // JWT claim é 'app_role' (PostgREST reserva 'role'); domain expõe como 'role'.
    role: claims.app_role,
    permissions: claims.permissions,
    claimsVersion: claims.claims_version,
    isSuperAdmin: claims.super_admin === true || claims.app_role === 'super_admin',
    aal: claims.aal ?? null,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthError('Autenticação necessária', 'unauthenticated', 401);
  }
  return user;
}

/**
 * Garante clinic_id presente. super_admin LANÇA — precisa contexto explícito
 * (em C15 impersonation vai popular uma claim adicional).
 */
export async function requireClinicId(): Promise<string> {
  const user = await requireUser();
  if (user.clinicId === null) {
    throw new AuthError(
      'Super_admin precisa selecionar clínica antes desta ação',
      'forbidden',
      403,
    );
  }
  return user.clinicId;
}

export async function requireRole(allowed: readonly Role[]): Promise<Role> {
  const user = await requireUser();
  if (!allowed.includes(user.role)) {
    throw new AuthError(
      `Role '${user.role}' não autorizada. Esperado uma de: ${allowed.join(', ')}`,
      'forbidden',
      403,
    );
  }
  return user.role;
}

/**
 * Lê permission do JWT cache (snapshot eventualmente consistente — P2/D13).
 * Stale window: até 60s (middleware throttle) + access_token_ttl (15min D12).
 *
 * Para ações destrutivas/irreversíveis use requireFreshPermission (D20).
 */
export async function requireCachedPermission(perm: Permission): Promise<void> {
  const user = await requireUser();
  if (user.isSuperAdmin) return; // P7 — platform role bypassa RBAC
  if (!user.permissions.includes(perm)) {
    throw new AuthError(
      `Permissão '${perm}' negada (cached). Verifique role/overrides.`,
      'forbidden',
      403,
    );
  }
}

/**
 * Revalida permission lendo profile + role_permissions + overrides do banco.
 * Garantia forte (D20): nenhuma janela stale. Custo ~5ms (3 queries indexadas).
 *
 * USO OBRIGATÓRIO em CRITICAL_ACTIONS (lista em policies/critical-actions.ts).
 * Vitest arch test em F8 falha CI se Server Action listada NÃO chamar este.
 */
export async function requireFreshPermission(perm: Permission): Promise<void> {
  const user = await requireUser();
  if (user.isSuperAdmin) return;

  // Pega role atual do banco (não confia no JWT).
  const profileRow = await dbAdmin
    .select({ role: profiles.role, ativo: profiles.ativo, deletedAt: profiles.deletedAt })
    .from(profiles)
    .where(eq(profiles.id, user.userId))
    .limit(1);
  const profile = profileRow[0];
  if (!profile || !profile.ativo || profile.deletedAt !== null) {
    throw new AuthError('Profile inativo ou inexistente', 'forbidden', 403);
  }

  // Override negando? → bloqueia mesmo se role tem.
  const denyRow = await dbAdmin
    .select({ id: userPermissionOverrides.id })
    .from(userPermissionOverrides)
    .where(
      and(
        eq(userPermissionOverrides.userId, user.userId),
        eq(userPermissionOverrides.permissionCode, perm),
        eq(userPermissionOverrides.granted, false),
      ),
    )
    .limit(1);
  if (denyRow.length > 0) {
    throw new AuthError(
      `Permissão '${perm}' negada por override (fresh check).`,
      'forbidden',
      403,
    );
  }

  // Override concedendo? → permite mesmo se role não tem.
  const grantRow = await dbAdmin
    .select({ id: userPermissionOverrides.id })
    .from(userPermissionOverrides)
    .where(
      and(
        eq(userPermissionOverrides.userId, user.userId),
        eq(userPermissionOverrides.permissionCode, perm),
        eq(userPermissionOverrides.granted, true),
      ),
    )
    .limit(1);
  if (grantRow.length > 0) return;

  // Permissão via role bundle?
  const rolePermRow = await dbAdmin
    .select({ role: rolePermissions.role })
    .from(rolePermissions)
    .where(
      and(
        eq(rolePermissions.role, profile.role),
        eq(rolePermissions.permissionCode, perm),
      ),
    )
    .limit(1);
  if (rolePermRow.length === 0) {
    throw new AuthError(
      `Permissão '${perm}' negada (fresh check). Role '${profile.role}' não tem bundle e não há override granted.`,
      'forbidden',
      403,
    );
  }

  // Confirma que a permission ainda existe no catálogo (defesa paranóica
  // contra DELETE em permissions sem CASCADE rebuild — improvável mas barato).
  const catalogRow = await dbAdmin
    .select({ code: permissionsTable.code })
    .from(permissionsTable)
    .where(eq(permissionsTable.code, perm))
    .limit(1);
  if (catalogRow.length === 0) {
    throw new AuthError(
      `Permissão '${perm}' não existe no catálogo (defesa fresh).`,
      'forbidden',
      403,
    );
  }
}

/**
 * Super_admin EXIGE AAL2 (D6). Bloqueia se MFA não foi verificado.
 */
export async function requireSuperAdmin(): Promise<void> {
  const user = await requireUser();
  if (!user.isSuperAdmin) {
    throw new AuthError('Requer super_admin', 'forbidden', 403);
  }
  if (user.aal !== 'aal2') {
    throw new AuthError(
      'super_admin precisa de MFA (AAL2). Reautentique com TOTP.',
      'forbidden',
      403,
    );
  }
}

// auditableAction REMOVIDO em C4. Use idempotentMutation / auditedMutation / superAdminAction.
