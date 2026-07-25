'use server';

/**
 * Server Actions da Equipe — orquestração do convite (spec convite §Fase 1).
 * Guardas na ordem; a escrita mora em Identity (`inviteClinicMember`), nunca aqui.
 * App-layer pode chamar a API pública de outro contexto; nunca JOIN cross-context.
 */
import { headers } from 'next/headers';
import { z } from 'zod';

import { getShellIdentity } from '@/components/painel/shell-identity';
import { billingApiV1 } from '@/contexts/billing/api';
import { requireActiveClinic } from '@/contexts/billing/internal/require-active-clinic';
import {
  cancelClinicInvite,
  inviteClinicMember,
  resendClinicInvite,
} from '@/contexts/identity/internal/members';
import {
  setMemberActive,
  setMemberOverride,
  setMemberRole,
} from '@/contexts/identity/internal/lifecycle';
import { UserQuotaExceededError } from '@/contexts/identity/errors';
import { mapIdentityError } from '@/contexts/identity/internal/map-error';
import { assertCanAssignRole } from '@/contexts/identity/internal/role-matrix';
import { listEmployees } from '@/contexts/identity/queries';
import { schedulingApiV1 } from '@/contexts/scheduling';
import { buildRequestContext } from '@/lib/audit/request-context';
import { isPermission, PERMISSIONS } from '@/lib/auth/permissions';
import { isPractitionerRole } from '@/lib/auth/practitioner';
import { ROLES } from '@/lib/auth/roles';
import { assertInviteAllowed, assertResendInviteAllowed } from '@/lib/auth/rate-limit';
import { requireClinicId, requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';

// M3 — a janela dos dois tetos é de 1 HORA. "Aguarde alguns minutos" mentiria e faria
// o gestor tentar em loop, queimando o resto do orçamento.
const INVITE_RATE_LIMITED =
  'Muitos convites em pouco tempo. Aguarde até uma hora antes de convidar mais.';
const RESEND_RATE_LIMITED =
  'Muitos reenvios em pouco tempo. Aguarde até uma hora, ou copie o link do convite existente.';

const InvitableRole = z.enum(['doctor', 'attendant', 'financial']);

const InviteMemberSchema = z.object({
  role: InvitableRole,
  nome: z.string().trim().min(1, 'Informe o nome.').max(120),
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(254),
  crm: z.string().trim().max(20).optional().default(''),
  crmUf: z.string().trim().max(2).optional().default(''),
  idempotencyKey: z.string().uuid('idempotencyKey inválido.'),
});

export type InviteMemberInput = z.input<typeof InviteMemberSchema>;
export type InviteMemberResult =
  | { ok: true; nome: string }
  | { error: string }
  | { upgrade: true; limit: number };

const FUNCAO_LABEL: Record<z.infer<typeof InvitableRole>, string> = {
  doctor: 'Médico',
  attendant: 'Atendente',
  financial: 'Financeiro',
};

export async function inviteMemberAction(input: InviteMemberInput): Promise<InviteMemberResult> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_EMPLOYEES); // crítica (D20/F-14) — lê do banco
  const clinicId = await requireClinicId();
  await requireActiveClinic(clinicId); // ADR-016 — clínica suspensa não convida

  const parsed = InviteMemberSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  const d = parsed.data;

  // M3: teto DEPOIS da validação barata e ANTES do trabalho caro (quota + recovery
  // link + e-mail). O gate de permissão acima não cobre o gestor
  // autorizado-porém-malicioso. Ordem importa: com o teto antes do Zod, dez typos de
  // e-mail queimavam o orçamento inteiro sem enviar um convite sequer.
  const rl = await assertInviteAllowed(clinicId, user.userId);
  if (!rl.ok) return { error: INVITE_RATE_LIMITED };

  // CRM opcional no convite (spec §Edge cases). Captura de credencial por PAPEL
  // via predicado canônico (ADR-032 §2), não o literal `role === 'doctor'`
  // (arch-test no-doctor-capability-check). Role-only = anti-escalonamento: um
  // CRM avulso não pode elevar um papel não-clínico a practitioner.
  const crm = isPractitionerRole(d.role) && d.crm ? d.crm : null;
  const crmUf = isPractitionerRole(d.role) && d.crmUf ? d.crmUf : null;
  if (crm && !crmUf) return { error: 'Informe a UF do CRM.' };

  try {
    assertCanAssignRole(user.role, d.role); // matriz + anti-escalonamento (server-side)

    // Checagem BARATA (UX rápido) — a AUTORIDADE anti-corrida é o advisory lock
    // dentro de inviteClinicMember (conta+cria na mesma tx serializada por clínica).
    const ativos = (await listEmployees(clinicId)).filter((e) => e.ativo).length;
    const quota = await billingApiV1.assertUserQuota(clinicId, ativos); // ADR-024 — pendente conta
    if (!quota.allowed) return { upgrade: true, limit: quota.limit };

    const identity = await getShellIdentity(); // clínica + nome do convidante (metadata rica)
    const hdrs = await headers();
    const origin = hdrs.get('origin') ?? 'http://localhost:3000';

    await inviteClinicMember({
      clinicId,
      nome: d.nome,
      email: d.email,
      role: d.role,
      crm,
      crmUf,
      clinicName: identity.clinicName,
      inviterNome: identity.userName,
      funcaoLabel: FUNCAO_LABEL[d.role],
      redirectOrigin: origin,
      invitedBy: user.userId,
      requestContext: buildRequestContext(hdrs),
      idempotencyKey: d.idempotencyKey,
      seatLimit: quota.limit,
    });

    return { ok: true, nome: d.nome };
  } catch (err) {
    // Corrida perdeu para outro convite concorrente: o teto estourou dentro da tx.
    if (err instanceof UserQuotaExceededError) return { upgrade: true, limit: err.limit };
    return { error: mapIdentityError(err) };
  }
}

const TargetSchema = z.object({ userId: z.string().uuid('Convite inválido.') });

export type ResendInviteResult = { ok: true; link: string } | { error: string };
export type CancelInviteResult = { ok: true } | { error: string };

/**
 * Reenvia o convite de um funcionário pendente (spec convite §Fase 2 · ADR-034).
 * Retorna o `link` para a UI copiar — não dependemos de auto-send de e-mail.
 * A validação (pendente + anti-escalonamento) mora no serviço (uma query só).
 */
export async function resendInviteAction(input: { userId: string }): Promise<ResendInviteResult> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_EMPLOYEES); // crítica (D20/F-14) — lê do banco
  const clinicId = await requireClinicId();
  await requireActiveClinic(clinicId); // ADR-016

  const parsed = TargetSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };

  // M3: orçamento PRÓPRIO, apertado — o resend gera um recovery link REAL a cada
  // chamada e não tem quota de plano por trás (dá para reenviar ao mesmo endereço
  // infinitas vezes). Separado do convite para não travar o onboarding legítimo.
  const rl = await assertResendInviteAllowed(clinicId, user.userId);
  if (!rl.ok) return { error: RESEND_RATE_LIMITED };

  try {
    const hdrs = await headers();
    const origin = hdrs.get('origin') ?? 'http://localhost:3000';
    const { link } = await resendClinicInvite({
      clinicId,
      userId: parsed.data.userId,
      inviterRole: user.role,
      redirectOrigin: origin,
      invitedBy: user.userId,
      requestContext: buildRequestContext(hdrs),
    });
    return { ok: true, link };
  } catch (err) {
    return { error: mapIdentityError(err) };
  }
}

/**
 * Cancela um convite pendente (spec convite §Fase 2, gap #12). Hard delete via
 * serviço: libera a vaga e o e-mail. Só atinge PENDENTE (aceito = desativar, 2b).
 */
export async function cancelInviteAction(input: { userId: string }): Promise<CancelInviteResult> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_EMPLOYEES); // crítica (D20/F-14) — lê do banco
  const clinicId = await requireClinicId();
  await requireActiveClinic(clinicId); // ADR-016

  const parsed = TargetSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };

  try {
    const hdrs = await headers();
    await cancelClinicInvite({
      clinicId,
      userId: parsed.data.userId,
      inviterRole: user.role,
      invitedBy: user.userId,
      requestContext: buildRequestContext(hdrs),
    });
    return { ok: true };
  } catch (err) {
    return { error: mapIdentityError(err) };
  }
}

// =====================================================================
// Ciclo de vida de membro ACEITO (I-2) — desativar/reativar, trocar role, override.
// Toda a escrita mora em Identity (internal/lifecycle); a orquestração
// cross-context (bloqueio de agenda futura) mora AQUI, o único lugar que pode falar
// com Identity e Scheduling ao mesmo tempo.
// =====================================================================

const SetActiveSchema = z.object({
  userId: z.string().uuid('Membro inválido.'),
  active: z.boolean(),
  /** Desativar APESAR de agenda futura/consulta aberta (ADR-032 §4). Auditado. */
  force: z.boolean().optional().default(false),
});

export type SetMemberActiveResult =
  | { ok: true; active: boolean }
  | { error: string }
  | { blocked: true; futureCount: number; openCount: number; nextAt: string | null };

/**
 * Desativa/reativa um membro. Ao DESATIVAR, consulta o Scheduling: se houver agenda
 * futura ou consulta aberta e não vier `force`, devolve `blocked` (a UI mostra o que
 * remanejar + oferece "desativar mesmo assim"). Com `force`, a desativação é
 * registrada como override na auditoria (ADR-032 §4 emendado por ADR-039).
 *
 * Enforcement do bloqueio de acesso: `ativo=false` bumpa claims_version → o token
 * vivo morre no próximo request (epoch, ADR-037) e o refresh cai no deny do hook.
 */
export async function setMemberActiveAction(
  input: z.input<typeof SetActiveSchema>,
): Promise<SetMemberActiveResult> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_EMPLOYEES);
  const clinicId = await requireClinicId();
  await requireActiveClinic(clinicId);

  const parsed = SetActiveSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  const { userId, active, force } = parsed.data;

  try {
    let forcedOverCommitments: { futureCount: number; openCount: number } | null = null;

    // Bloqueio ADR-032 §4 — só ao desativar. Um não-médico nunca é doctorId de
    // appointment, então a query devolve zero naturalmente (sem special-casing).
    if (!active) {
      const c = await schedulingApiV1.doctorActiveCommitments(clinicId, userId);
      if (c.futureCount + c.openCount > 0) {
        if (!force) {
          return {
            blocked: true,
            futureCount: c.futureCount,
            openCount: c.openCount,
            nextAt: c.nextAt,
          };
        }
        forcedOverCommitments = { futureCount: c.futureCount, openCount: c.openCount };
      }
    }

    const hdrs = await headers();
    await setMemberActive({
      clinicId,
      actorUserId: user.userId,
      targetUserId: userId,
      active,
      forcedOverCommitments,
      requestContext: buildRequestContext(hdrs),
    });
    return { ok: true, active };
  } catch (err) {
    return { error: mapIdentityError(err) };
  }
}

const SetRoleSchema = z.object({
  userId: z.string().uuid('Membro inválido.'),
  role: z.enum(ROLES as [string, ...string[]]),
});

export type SetMemberRoleResult = { ok: true } | { error: string };

/** Troca o role de um membro aceito (anti-escalonamento em assertCanAssignRole). */
export async function setMemberRoleAction(
  input: z.input<typeof SetRoleSchema>,
): Promise<SetMemberRoleResult> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_EMPLOYEES);
  const clinicId = await requireClinicId();
  await requireActiveClinic(clinicId);

  const parsed = SetRoleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };

  try {
    const hdrs = await headers();
    await setMemberRole({
      clinicId,
      actorUserId: user.userId,
      actorRole: user.role,
      targetUserId: parsed.data.userId,
      newRole: parsed.data.role as (typeof ROLES)[number],
      requestContext: buildRequestContext(hdrs),
    });
    return { ok: true };
  } catch (err) {
    return { error: mapIdentityError(err) };
  }
}

const SetOverrideSchema = z.object({
  userId: z.string().uuid('Membro inválido.'),
  permission: z.string().refine(isPermission, 'Permissão inválida.'),
  // true = concede · false = nega · null = remove (volta ao bundle da role).
  granted: z.union([z.boolean(), z.null()]),
});

export type SetMemberOverrideResult = { ok: true } | { error: string };

/**
 * Concede/nega/remove um override granular. Este é o ÚNICO caminho de escrita em
 * user_permission_overrides desde o I-13 (o RLS trancou o acesso direto). Requer
 * manage:permissions + o alvo ser mutável; o trigger bumpa claims_version.
 */
export async function setMemberOverrideAction(
  input: z.input<typeof SetOverrideSchema>,
): Promise<SetMemberOverrideResult> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_PERMISSIONS);
  const clinicId = await requireClinicId();
  await requireActiveClinic(clinicId);

  // Overrides por usuário são um recurso comercial dos planos Clínica e Pro.
  // O gate fica no servidor para não depender da visibilidade da UI.
  if (!(await billingApiV1.hasGranularPermissions(clinicId))) {
    return { error: 'Permissões granulares estão disponíveis nos planos Clínica e Pro.' };
  }

  const parsed = SetOverrideSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  if (!isPermission(parsed.data.permission)) return { error: 'Permissão inválida.' };

  try {
    const hdrs = await headers();
    await setMemberOverride({
      clinicId,
      actorUserId: user.userId,
      targetUserId: parsed.data.userId,
      permissionCode: parsed.data.permission,
      granted: parsed.data.granted,
      requestContext: buildRequestContext(hdrs),
    });
    return { ok: true };
  } catch (err) {
    return { error: mapIdentityError(err) };
  }
}
