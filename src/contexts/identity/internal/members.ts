/**
 * Escrita de convite de funcionário (spec convite §Fase 1). **Dono** da criação do
 * auth user + profile. Espelha `createOwnerUser`/`provisionTenantFromInviteTx` da saga
 * de onboarding, MAS sem senha (o convidado define a dele no aceite).
 *
 * Por que dbAdmin: `profiles` não tem INSERT policy para `authenticated` (D31); a
 * escrita roteia por `dbAdmin` (BYPASSRLS) com colunas fixas e clinic_id do request
 * — mesma exceção da saga (allowlist em eslint.config.mjs + scripts/arch-db-check.ts).
 *
 * inviteUserByEmail é EXTERNO à tx (chamada HTTP ao Auth). Se a tx falhar depois,
 * o auth user fica órfão → compensa com deleteUser (best-effort; débito de
 * reconciliação auth↔profile registrado, review #6).
 *
 * Server-only.
 */
import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import type { RequestContext } from '@/lib/audit/types';
import type { Role } from '@/lib/auth/roles';
import { createAdminClient } from '@/lib/auth/supabase-admin';
import { dbAdmin } from '@/lib/db';
import { idempotencyKeys } from '@/lib/db/schema/infra/idempotency';
import { payloadHash } from '@/lib/idempotency/hash';
import { isUniqueViolation } from '@/lib/outbox/errors';

import { CrmConflictError, EmailAlreadyMemberError } from '../errors';
import { profiles } from '../schema';
import { normalizeCrm, normalizeCrmUf } from './normalize-crm';

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
  /** Origin do request (headers) para o redirect do link de convite → /convite. */
  redirectOrigin: string;
  invitedBy: string;
  requestContext: RequestContext;
  idempotencyKey: string;
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

  // 1. Cria o auth user + dispara o convite (EXTERNO à tx). `data` popula o e-mail
  //    (condicionais do template) e a tela de aceite; redirectTo → /convite.
  const { data, error } = await admin.auth.admin.inviteUserByEmail(args.email, {
    data: {
      nome: args.nome,
      clinica: args.clinicName,
      funcao: args.funcaoLabel,
      convidado_por: args.inviterNome,
    },
    redirectTo: `${args.redirectOrigin}/convite`,
  });
  if (error || !data?.user) {
    if (isEmailExists(error)) throw new EmailAlreadyMemberError();
    throw new Error(`Falha ao enviar convite: ${error?.message ?? 'desconhecido'}`);
  }
  const userId = data.user.id;
  const result: InviteClinicMemberResult = { userId, role: args.role };

  // 2. Profile + auditoria + finalização da chave numa micro-tx (dbAdmin).
  try {
    await dbAdmin.transaction(async (tx) => {
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
    // (best-effort — débito de reconciliação auth↔profile, review #6).
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    if (isUniqueViolation(err)) throw new CrmConflictError();
    throw err;
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

