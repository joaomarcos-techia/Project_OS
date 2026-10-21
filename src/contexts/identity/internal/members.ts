/**
 * Escrita de convite de funcionário (spec convite §Fase 1). **Dono** da criação do
 * auth user + profile. Espelha `createOwnerUser`/`provisionTenantFromInviteTx` da saga
 * de onboarding, MAS sem senha (o convidado define a dele no aceite).
 *
 * Por que dbAdmin: `profiles` não tem INSERT policy para `authenticated` (D31); a
 * escrita roteia por `dbAdmin` (BYPASSRLS) com colunas fixas e clinic_id do request
 * — mesma exceção da saga (allowlist em eslint.config.mjs + scripts/arch-db-check.ts).
 *
 * createUser/generateLink/Resend são EXTERNOS à tx. Se a tx falhar depois,
 * o auth user fica órfão → compensa com deleteUser (best-effort; débito de
 * reconciliação auth↔profile registrado, review #6).
 *
 * Server-only.
 */
import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import type { RequestContext } from '@/lib/audit/types';
import type { Role } from '@/lib/auth/roles';
import { createAdminClient } from '@/lib/auth/supabase-admin';
import { dbAdmin } from '@/lib/db';
import { idempotencyKeys } from '@/lib/db/schema/infra/idempotency';
import { payloadHash } from '@/lib/idempotency/hash';
import { logger } from '@/lib/observability/logger';
import { isUniqueViolation } from '@/lib/outbox/errors';

import {
  CrmConflictError,
  EmailAlreadyMemberError,
  InviteAlreadyAcceptedError,
  InviteHasLinkedRecordsError,
  MemberNotFoundError,
  UserQuotaExceededError,
} from '../errors';
import { profiles } from '../schema';
import { normalizeCrm, normalizeCrmUf } from './normalize-crm';
import { assertCanAssignRole } from './role-matrix';
import { seatLimitErrorFrom } from './seat-limit-error';
import { deliverTeamInviteEmail } from './team-invite-email';

export interface InviteClinicMemberArgs {
  clinicId: string;
  nome: string;
  email: string;
  role: Role;
  crm?: string | null;
  crmUf?: string | null;
  /** Metadata rica: popula o template do e-mail E a tela de aceite (review #10). */
  clinicName: string;
  inviterNome: string;
  funcaoLabel: string;
  invitedBy: string;
  requestContext: RequestContext;
  idempotencyKey: string;
  /**
   * Teto TOTAL de usuários da tabela antiga (do action, via billingApiV1). O
   * VALOR não corre (plano é estável); o que precisa ser atômico é a CONTAGEM vs
   * o teto — feita aqui dentro da tx sob advisory lock. `Number.MAX_SAFE_INTEGER`
   * = sem teto total: sem plano, ou plano cobrado por profissional, cujos tetos
   * por categoria a trigger de `profiles` aplica no insert (ADR-067).
   */
  seatLimit: number;
}

export interface InviteClinicMemberResult {
  userId: string;
  role: Role;
}

/** Chave idempotente no formato do CHECK de idempotency_keys: `entity:action:<hex>`. */
function inviteIdemKey(clientKey: string): string {
  const hex = clientKey.replace(/-/g, '').toLowerCase();
  if (!/^[a-f0-9]{8,}$/.test(hex)) throw new Error('idempotencyKey deve ser um UUID');
  return `identity:invite_member:${hex}`;
}

function isEmailExists(
  error: { code?: string | undefined; message?: string | undefined } | null,
): boolean {
  if (!error) return false;
  return (
    error.code === 'email_exists' ||
    /already.*(registered|exists)|already been registered/i.test(error.message ?? '')
  );
}

const MEMBER_ROLE_LABEL: Partial<Record<Role, string>> = {
  gestor: 'Gestor',
  doctor: 'Médico',
  attendant: 'Atendente',
  financial: 'Financeiro',
};

async function deleteCreatedAuthUser(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  event: string,
): Promise<void> {
  try {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) logger.error(event, { userId, code: deleted.error.code ?? 'unknown' });
  } catch (error) {
    logger.error(event, {
      userId,
      code: error instanceof Error ? error.name : 'unknown',
    });
  }
}

export async function inviteClinicMember(
  args: InviteClinicMemberArgs,
): Promise<InviteClinicMemberResult> {
  const admin = createAdminClient();
  const key = inviteIdemKey(args.idempotencyKey);
  const crm = normalizeCrm(args.crm);
  const crmUf = normalizeCrmUf(args.crmUf);

  // 0. Idempotência (D14): dupla-submissão já concluída → retorna sem reconvidar.
  const [cached] = await dbAdmin
    .select({ response: idempotencyKeys.response })
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, key))
    .limit(1);
  if (cached?.response) return cached.response as InviteClinicMemberResult;

  // 1. Cria a conta passwordless, pede somente o token ao GoTrue e entrega o
  //    template versionado pelo Resend. `inviteUserByEmail` não serve aqui: o
  //    link padrão consome o OTP em /auth/v1/verify antes de /auth/confirm e o
  //    convite termina no login sem grant de aceite.
  const { data, error } = await admin.auth.admin.createUser({
    email: args.email,
    email_confirm: false,
    user_metadata: {
      nome: args.nome,
      clinica: args.clinicName,
      funcao: args.funcaoLabel,
      convidado_por: args.inviterNome,
    },
  });
  if (error || !data?.user) {
    if (isEmailExists(error)) throw new EmailAlreadyMemberError();
    throw new Error(`Falha ao enviar convite: ${error?.message ?? 'desconhecido'}`);
  }
  const userId = data.user.id;
  const result: InviteClinicMemberResult = { userId, role: args.role };

  try {
    const generated = await admin.auth.admin.generateLink({ type: 'recovery', email: args.email });
    const linkedUserId = generated.data?.user?.id;
    const tokenHash = generated.data?.properties?.hashed_token;
    if (
      generated.error ||
      linkedUserId !== userId ||
      typeof tokenHash !== 'string' ||
      tokenHash.length === 0
    ) {
      throw new Error('team invite link generation failed');
    }
    await deliverTeamInviteEmail({
      email: args.email,
      tokenHash,
      stage: 'initial',
      inviteeName: args.nome,
      clinicName: args.clinicName,
      roleLabel: args.funcaoLabel,
      inviterName: args.inviterNome,
    });
  } catch {
    await deleteCreatedAuthUser(admin, userId, 'identity.invite_delivery.delete_user_failed');
    throw new Error('Falha ao enviar convite. Tente novamente.');
  }

  // 2. Profile + auditoria + finalização da chave numa micro-tx (dbAdmin).
  try {
    await dbAdmin.transaction(async (tx) => {
      // QUOTA ATÔMICA: serializa por clínica (advisory lock xact-scoped) e conta
      // os ativos DENTRO da tx. Sem isto, dois convites concorrentes leem 9/10 e
      // ambos passam a checagem barata do action → 11 usuários. `id <> userId`
      // exclui o próprio upsert (re-convite não conta duas vezes). Se não há teto
      // (MAX_SAFE_INTEGER), pula.
      if (args.seatLimit < Number.MAX_SAFE_INTEGER) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${args.clinicId}))`);
        const rows = (await tx.execute(
          sql`SELECT count(*)::int AS n FROM profiles
              WHERE clinic_id = ${args.clinicId}::uuid AND ativo = true
                AND deleted_at IS NULL AND id <> ${userId}::uuid`,
        )) as unknown as Array<{ n: number }>;
        if ((rows[0]?.n ?? 0) >= args.seatLimit) {
          throw new UserQuotaExceededError(args.seatLimit);
        }
      }

      await tx
        .insert(profiles)
        .values({
          id: userId,
          clinicId: args.clinicId,
          nome: args.nome,
          role: args.role,
          crm,
          crmUf,
          ativo: true,
          inviteAcceptedAt: null, // pendente até o aceite (review #1)
        })
        .onConflictDoUpdate({
          target: profiles.id,
          set: { clinicId: args.clinicId, nome: args.nome, role: args.role, crm, crmUf },
        });

      await logAudit(tx, {
        clinicId: args.clinicId,
        userId: args.invitedBy,
        action: 'internal.user.created',
        resourceType: 'profile',
        resourceId: userId,
        before: null,
        after: { userId, role: args.role, invitedBy: args.invitedBy },
        requestContext: args.requestContext,
      });

      await tx
        .insert(idempotencyKeys)
        .values({
          key,
          clinicId: args.clinicId,
          userId: args.invitedBy,
          payloadHash: payloadHash({ email: args.email, role: args.role, clinicId: args.clinicId }),
          response: result as never,
          statusCode: 200,
        })
        .onConflictDoNothing();
    });
    return result;
  } catch (err) {
    // Compensação: o convite já criou o auth user; a tx falhou → deleta o órfão
    // (best-effort COM visibilidade — débito de reconciliação auth↔profile, review #6).
    await deleteCreatedAuthUser(admin, userId, 'identity.invite_compensation.delete_user_failed');
    if (isUniqueViolation(err)) throw new CrmConflictError();
    throw seatLimitErrorFrom(err) ?? err;
  }
}

/**
 * Marca o convite como aceito (invite_accepted_at = now) — transição pendente→ativo.
 * Chamado no aceite (o convidado define a senha). dbAdmin porque profiles não tem
 * UPDATE p/ authenticated (D31). O caller autentica o próprio usuário antes.
 */
export async function markInviteAccepted(userId: string): Promise<void> {
  await dbAdmin
    .update(profiles)
    .set({ inviteAcceptedAt: new Date() })
    .where(and(eq(profiles.id, userId), isNull(profiles.inviteAcceptedAt)));
}

export interface ResendClinicInviteArgs {
  clinicId: string;
  userId: string;
  inviterRole: Role;
  invitedBy: string;
  clinicName: string;
  inviterNome: string;
  requestContext: RequestContext;
}

/**
 * Reenvia o convite de um funcionário PENDENTE gerando um link novo (spec convite
 * §Fase 2 · ADR-034). Mesmo profile, mesmo id (#3) — só o link muda.
 *
 * ⚠️ tipo `recovery`, não `invite`: o alvo é um user que JÁ existe (o pendente).
 * `inviteUserByEmail`/`generateLink({type:'invite'})` erram em user existente, e
 * magiclink tem semântica de LOGIN. `recovery` = "definir senha", alinhado ao aceite
 * em /convite. O Resend entrega o template versionado e a UI também copia o link
 * como fallback operacional.
 */
export async function resendClinicInvite(args: ResendClinicInviteArgs): Promise<{ link: string }> {
  const admin = createAdminClient();

  // 1. Re-valida: pertence à clínica + ainda pendente (autoridade server-side; a UI
  //    só oferece a ação em linhas pendentes, mas não confiamos no cliente).
  const [p] = await dbAdmin
    .select({
      nome: profiles.nome,
      role: profiles.role,
      inviteAcceptedAt: profiles.inviteAcceptedAt,
    })
    .from(profiles)
    .where(
      and(
        eq(profiles.id, args.userId),
        eq(profiles.clinicId, args.clinicId),
        isNull(profiles.deletedAt),
      ),
    )
    .limit(1);
  if (!p) throw new MemberNotFoundError();
  if (p.inviteAcceptedAt != null) throw new InviteAlreadyAcceptedError();

  // 2. Anti-escalonamento: quem opera precisa poder gerir o papel do alvo.
  assertCanAssignRole(args.inviterRole, p.role);

  // 3. E-mail vive no auth.users (profiles não guarda e-mail — D7).
  const { data: u, error: uErr } = await admin.auth.admin.getUserById(args.userId);
  if (uErr || !u?.user?.email) {
    throw new Error(`Falha ao localizar o convite: ${uErr?.message ?? 'usuário sem e-mail'}`);
  }

  const roleLabel = MEMBER_ROLE_LABEL[p.role];
  if (!roleLabel) throw new Error('Função do convite inválida.');

  // 4. Link novo (recovery — ver docstring), entregue pelo Resend e também
  // devolvido para o fallback de clipboard da UI.
  const { data: link, error: lErr } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: u.user.email,
  });
  if (lErr || !link?.properties?.hashed_token) {
    throw new Error(`Não foi possível gerar um novo convite: ${lErr?.message ?? 'desconhecido'}`);
  }

  const delivered = await deliverTeamInviteEmail({
    email: u.user.email,
    tokenHash: link.properties.hashed_token,
    stage: 'resend',
    inviteeName: p.nome,
    clinicName: args.clinicName,
    roleLabel,
    inviterName: args.inviterNome,
  });

  // 5. Auditoria (matriz gap 13).
  await dbAdmin.transaction((tx) =>
    logAudit(tx, {
      clinicId: args.clinicId,
      userId: args.invitedBy,
      action: 'internal.user.invite_resent',
      resourceType: 'profile',
      resourceId: args.userId,
      before: null,
      after: { userId: args.userId },
      requestContext: args.requestContext,
    }),
  );

  return delivered;
}

export interface CancelClinicInviteArgs {
  clinicId: string;
  userId: string;
  inviterRole: Role;
  invitedBy: string;
  requestContext: RequestContext;
}

/**
 * Cancela um convite PENDENTE (spec convite §Fase 2, gap #12). Hard delete: o
 * profile pendente não tem histórico clínico → remove-se a linha + o auth user.
 * Libera a vaga (cota do plano) e o e-mail (para reconvidar).
 *
 * O delete do profile + a auditoria vão na MESMA tx ("no audit, no op"). O
 * `deleteUser` (auth) é EXTERNO e best-effort — órfão residual = débito #6, mas
 * LOGADO (review #2), nunca silencioso.
 */
export async function cancelClinicInvite(args: CancelClinicInviteArgs): Promise<void> {
  const admin = createAdminClient();

  await dbAdmin.transaction(async (tx) => {
    // Delete condicionado a PENDENTE + clínica, atômico. RETURNING dá o role para o
    // guard + auditoria; se o guard barrar, a tx faz rollback (delete desfeito).
    let deleted: { role: Role } | undefined;
    try {
      [deleted] = await tx
        .delete(profiles)
        .where(
          and(
            eq(profiles.id, args.userId),
            eq(profiles.clinicId, args.clinicId),
            isNull(profiles.inviteAcceptedAt),
            isNull(profiles.deletedAt),
          ),
        )
        .returning({ role: profiles.role });
    } catch (err) {
      // 23503: o profile (pendente) tem registros dependentes — tipicamente um
      // agendamento criado com ele por engano (bug do filtro de médico, já
      // corrigido). Mensagem clara em vez do genérico "tente novamente".
      if ((err as { code?: string }).code === '23503') throw new InviteHasLinkedRecordsError();
      throw err;
    }
    if (!deleted) throw new InviteAlreadyAcceptedError(); // não é pendente / não é da clínica

    assertCanAssignRole(args.inviterRole, deleted.role); // rollback se barrar

    await logAudit(tx, {
      clinicId: args.clinicId,
      userId: args.invitedBy,
      action: 'internal.user.invite_cancelled',
      resourceType: 'profile',
      resourceId: args.userId,
      before: { role: deleted.role },
      after: null,
      requestContext: args.requestContext,
    });
  });

  // Remove o auth user órfão (o profile já saiu pela tx). Best-effort COM
  // visibilidade — se falhar, sobra órfão até a reconciliação (débito #6).
  await admin.auth.admin.deleteUser(args.userId).catch((e: unknown) =>
    logger.error('identity.invite_cancel.delete_user_failed', {
      userId: args.userId,
      err: String(e),
    }),
  );
}
