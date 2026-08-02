/**
 * Identity read-side (C-UI — tela Equipe & Permissões).
 *
 * Tenant-scoped via `withTenant` (RLS `profiles_tenant_select` /
 * `user_permission_overrides_tenant_access` resolvem por `app.current_clinic`).
 * Read-only: a EDIÇÃO de role/permissão é deliberadamente fora daqui — `profiles`
 * não tem UPDATE policy para `authenticated` (D31) e mudar role bumpa
 * `claims_version` (trigger). Mutação exige função SECURITY DEFINER dedicada com
 * guard-rails (último owner, não rebaixar a si mesmo) — próximo passo.
 *
 * Server-only.
 */
import 'server-only';

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';
import { isPermission, type Permission } from '@/lib/auth/permissions';

import { profiles, userPermissionOverrides } from './schema';
import type { Role } from './types';

export type EmployeeSummary = {
  id: string;
  nome: string;
  role: Role;
  especialidade: string | null;
  crm: string | null;
  crmUf: string | null;
  ativo: boolean;
  /** Convite ainda não aceito (invite_accepted_at IS NULL) — estado FACTUAL (ADR-032 Fase 2). */
  pending: boolean;
  mfaEnrolled: boolean;
  /** Quantos grants/denies granulares este usuário tem (user_permission_overrides). */
  overridesCount: number;
  overrides: Array<{ permission: Permission; granted: boolean }>;
};

export type ProfessionalProfile = {
  crm: string | null;
  crmUf: string | null;
  especialidade: string | null;
};

/** Credencial do próprio profissional para a tela de configurações. */
export async function getProfessionalProfile(
  clinicId: string,
  userId: string,
): Promise<ProfessionalProfile | null> {
  return withTenant(clinicId, async (tx) => {
    const [profile] = await tx
      .select({
        crm: profiles.crm,
        crmUf: profiles.crmUf,
        especialidade: profiles.especialidade,
      })
      .from(profiles)
      .where(
        and(eq(profiles.id, userId), eq(profiles.clinicId, clinicId), isNull(profiles.deletedAt)),
      )
      .limit(1);
    return profile ?? null;
  });
}

/** Lista os funcionários (profiles não-deletados) da clínica, ordenados por nome. */
export async function listEmployees(clinicId: string): Promise<EmployeeSummary[]> {
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select({
        id: profiles.id,
        nome: profiles.nome,
        role: profiles.role,
        especialidade: profiles.especialidade,
        crm: profiles.crm,
        crmUf: profiles.crmUf,
        ativo: profiles.ativo,
        inviteAcceptedAt: profiles.inviteAcceptedAt,
        mfaEnrolledAt: profiles.mfaEnrolledAt,
      })
      .from(profiles)
      .where(and(eq(profiles.clinicId, clinicId), isNull(profiles.deletedAt)))
      .orderBy(asc(profiles.nome));

    const ovr = await tx
      .select({
        userId: userPermissionOverrides.userId,
        permissionCode: userPermissionOverrides.permissionCode,
        granted: userPermissionOverrides.granted,
      })
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.clinicId, clinicId));

    const countById = new Map<string, number>();
    const overridesById = new Map<string, Array<{ permission: Permission; granted: boolean }>>();
    for (const o of ovr) {
      countById.set(o.userId, (countById.get(o.userId) ?? 0) + 1);
      if (!isPermission(o.permissionCode)) continue;
      const list = overridesById.get(o.userId) ?? [];
      list.push({ permission: o.permissionCode, granted: o.granted });
      overridesById.set(o.userId, list);
    }

    return rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      role: r.role as Role,
      especialidade: r.especialidade,
      crm: r.crm,
      crmUf: r.crmUf,
      ativo: r.ativo,
      pending: r.inviteAcceptedAt == null,
      mfaEnrolled: r.mfaEnrolledAt != null,
      overridesCount: countById.get(r.id) ?? 0,
      overrides: overridesById.get(r.id) ?? [],
    }));
  });
}

/**
 * Resolve nomes de funcionários por id (para enriquecer feeds que só têm
 * user_id, ex.: atividade recente do dashboard). RLS restringe à própria clínica.
 */
export async function getProfileNames(
  clinicId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return new Map();
  return withTenant(clinicId, async (tx) => {
    const rows = await tx
      .select({ id: profiles.id, nome: profiles.nome })
      .from(profiles)
      .where(inArray(profiles.id, uniq));
    return new Map(rows.map((r) => [r.id, r.nome]));
  });
}
