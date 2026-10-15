/**
 * Ciclo de vida de um membro JÁ ACEITO (I-2 da auditoria de identidade). Fecha o
 * gap "sem offboarding/edição pelo produto": até aqui só existia convidar/reenviar/
 * cancelar (members.ts), e desativar/trocar-role/override só via SQL manual.
 *
 * Por que dbAdmin e não SECURITY DEFINER: ADR-008 D31 é sobre SELF-SERVICE (o
 * usuário editando o próprio profile, ex. mark_mfa_enrolled). Isto é operação
 * ADMINISTRATIVA — a autorização já aconteceu no gate (requireFreshPermission +
 * requireClinicId) antes de chegar aqui. O padrão estabelecido para escrita
 * administrativa em profiles é dbAdmin com escopo defensivo por clinic_id (V1.2),
 * na allowlist de eslint.config.mjs + arch-db-check. Ver ADR-039.
 *
 * ⚠️ ENFORCEMENT DA DESATIVAÇÃO (correção ao ADR-032 §4, ver ADR-039): o §4 dizia
 * "ativo=false + signOut". O signOut administrativo de OUTRO usuário nem existe no
 * supabase-js 2.106.2 (admin.signOut exige o JWT do próprio alvo) — e o ADR-037 o
 * tornou REDUNDANTE. `ativo=false` bumpa claims_version (trigger) → o access token
 * vivo morre no próximo request (epoch-check). E qualquer refresh cai no
 * deny-by-default do hook (`ativo IS NOT TRUE`) → emite token SEM claims. O usuário
 * fica trancado para fora sem depender de revogar refresh token. Não fingimos uma
 * chamada de signOut que não existe.
 *
 * O bloqueio "agenda futura/consulta aberta" (ADR-032 §4) NÃO mora aqui: precisa de
 * Scheduling, e Identity é fundacional (Scheduling importa identity/schema — o
 * inverso seria ciclo). A composição acontece na app-layer (equipe/actions.ts), que
 * é o único lugar autorizado a falar com os dois contextos. `forcedOverCommitments`
 * carrega o que a app decidiu para a AUDITORIA registrar o override.
 *
 * Server-only.
 */
import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import type { RequestContext } from '@/lib/audit/types';
import type { Permission } from '@/lib/auth/permissions';
import type { Role } from '@/lib/auth/roles';
import { dbAdmin } from '@/lib/db';

import { MemberNotFoundError, ProtectedRoleError, SelfMutationError } from '../errors';
import { profiles, userPermissionOverrides } from '../schema';
import { assertCanAssignRole } from './role-matrix';

/** Papéis que NÃO podem ser alvo de desativação/troca/override pelo canal tenant. */
function assertTargetMutable(role: Role): void {
  if (role === 'owner' || role === 'super_admin') throw new ProtectedRoleError();
}

/** Lê o alvo dentro da clínica (escopo defensivo V1.2), não-deletado. */
async function loadTarget(clinicId: string, targetUserId: string) {
  const [row] = await dbAdmin
    .select({ role: profiles.role, ativo: profiles.ativo })
    .from(profiles)
    .where(
      and(
        eq(profiles.id, targetUserId),
        eq(profiles.clinicId, clinicId),
        isNull(profiles.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface SetMemberActiveArgs {
  clinicId: string;
  actorUserId: string;
  targetUserId: string;
  active: boolean;
  requestContext: RequestContext;
  /**
   * Preenchido pela app-layer quando desativa APESAR de agenda futura/consulta
   * aberta (ADR-032 §4 — override consciente). Só para a auditoria; o bloqueio em
   * si acontece na action (cross-context).
   */
  forcedOverCommitments?: { futureCount: number; openCount: number } | null;
}

/**
 * Desativa/reativa um membro. Idempotente: se já está no estado pedido, no-op.
 * Retorna o role do alvo (para a UI). O bump de claims_version é do trigger.
 */
export async function setMemberActive(args: SetMemberActiveArgs): Promise<{ role: Role }> {
  if (args.actorUserId === args.targetUserId) throw new SelfMutationError();

  const target = await loadTarget(args.clinicId, args.targetUserId);
  if (!target) throw new MemberNotFoundError();
  assertTargetMutable(target.role);

  if (target.ativo === args.active) return { role: target.role }; // no-op idempotente

  await dbAdmin.transaction(async (tx) => {
    await tx
      .update(profiles)
      .set({ ativo: args.active })
      .where(and(eq(profiles.id, args.targetUserId), eq(profiles.clinicId, args.clinicId)));

    await logAudit(tx, {
      clinicId: args.clinicId,
      userId: args.actorUserId,
      action: args.active ? 'internal.user.reactivated' : 'internal.user.deactivated',
      resourceType: 'profile',
      resourceId: args.targetUserId,
      before: { ativo: target.ativo },
      after: {
        ativo: args.active,
        // Deixa a decisão de override RASTREÁVEL: quem, quando, sobre o que.
        forcedOverCommitments: args.active ? null : (args.forcedOverCommitments ?? null),
      },
      requestContext: args.requestContext,
    });
  });

  return { role: target.role };
}

export interface SetMemberRoleArgs {
  clinicId: string;
  actorUserId: string;
  actorRole: Role;
  targetUserId: string;
  newRole: Role;
  requestContext: RequestContext;
}

/**
 * Troca o role de um membro. Reusa `assertCanAssignRole` (anti-escalonamento —
 * ninguém cria owner/super_admin, e o ator só atribui o que seu papel permite).
 */
export async function setMemberRole(args: SetMemberRoleArgs): Promise<void> {
  if (args.actorUserId === args.targetUserId) throw new SelfMutationError();

  const target = await loadTarget(args.clinicId, args.targetUserId);
  if (!target) throw new MemberNotFoundError();
  assertTargetMutable(target.role); // não rebaixa owner/super_admin
  assertCanAssignRole(args.actorRole, args.newRole); // e não PROMOVE a owner/super_admin

  if (target.role === args.newRole) return; // no-op

  await dbAdmin.transaction(async (tx) => {
    await tx
      .update(profiles)
      .set({ role: args.newRole })
      .where(and(eq(profiles.id, args.targetUserId), eq(profiles.clinicId, args.clinicId)));

    await logAudit(tx, {
      clinicId: args.clinicId,
      userId: args.actorUserId,
      action: 'internal.user.role_changed',
      resourceType: 'profile',
      resourceId: args.targetUserId,
      before: { role: target.role },
      after: { role: args.newRole },
      requestContext: args.requestContext,
    });
  });
}

export interface SetMemberOverrideArgs {
  clinicId: string;
  actorUserId: string;
  targetUserId: string;
  permissionCode: Permission;
  /** true = concede · false = nega · null = remove o override (volta ao bundle da role). */
  granted: boolean | null;
  requestContext: RequestContext;
}

export interface SetMemberOverridesArgs {
  clinicId: string;
  actorUserId: string;
  targetUserId: string;
  changes: Array<{ permissionCode: Permission; granted: boolean | null }>;
  requestContext: RequestContext;
}

/** Salva vários ajustes em uma transação: ou todos valem, ou nenhum vale. */
export async function setMemberOverrides(args: SetMemberOverridesArgs): Promise<void> {
  if (args.actorUserId === args.targetUserId) throw new SelfMutationError();
  if (args.changes.length === 0) return;
  const target = await loadTarget(args.clinicId, args.targetUserId);
  if (!target) throw new MemberNotFoundError();
  assertTargetMutable(target.role);

  await dbAdmin.transaction(async (tx) => {
    for (const change of args.changes) {
      const [before] = await tx
        .select({ granted: userPermissionOverrides.granted })
        .from(userPermissionOverrides)
        .where(
          and(
            eq(userPermissionOverrides.userId, args.targetUserId),
            eq(userPermissionOverrides.permissionCode, change.permissionCode),
            eq(userPermissionOverrides.clinicId, args.clinicId),
          ),
        )
        .limit(1);

      if (change.granted === null) {
        await tx
          .delete(userPermissionOverrides)
          .where(
            and(
              eq(userPermissionOverrides.userId, args.targetUserId),
              eq(userPermissionOverrides.permissionCode, change.permissionCode),
              eq(userPermissionOverrides.clinicId, args.clinicId),
            ),
          );
      } else {
        await tx
          .insert(userPermissionOverrides)
          .values({
            userId: args.targetUserId,
            clinicId: args.clinicId,
            permissionCode: change.permissionCode,
            granted: change.granted,
            grantedBy: args.actorUserId,
          })
          .onConflictDoUpdate({
            target: [userPermissionOverrides.userId, userPermissionOverrides.permissionCode],
            set: { granted: change.granted, grantedBy: args.actorUserId },
          });
      }

      await logAudit(tx, {
        clinicId: args.clinicId,
        userId: args.actorUserId,
        action: 'internal.user.override_changed',
        resourceType: 'profile',
        resourceId: args.targetUserId,
        before: { permission: change.permissionCode, granted: before?.granted ?? null },
        after: { permission: change.permissionCode, granted: change.granted },
        requestContext: args.requestContext,
      });
    }
  });
}

/**
 * Concede/nega/remove um override granular. Este é o caminho de escrita que o I-13
 * trancou no nível de RLS: agora só existe aqui, atrás do gate (dbAdmin/BYPASSRLS),
 * com o ator provado e auditado. O trigger bumpa claims_version do alvo.
 */
export async function setMemberOverride(args: SetMemberOverrideArgs): Promise<void> {
  return setMemberOverrides({
    clinicId: args.clinicId,
    actorUserId: args.actorUserId,
    targetUserId: args.targetUserId,
    changes: [{ permissionCode: args.permissionCode, granted: args.granted }],
    requestContext: args.requestContext,
  });
}
