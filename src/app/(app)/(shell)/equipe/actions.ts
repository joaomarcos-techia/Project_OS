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
  CrmConflictError,
  EmailAlreadyMemberError,
  InviteAlreadyAcceptedError,
  MemberNotFoundError,
  RoleAssignmentError,
} from '@/contexts/identity/errors';
import {
  cancelClinicInvite,
  inviteClinicMember,
  resendClinicInvite,
} from '@/contexts/identity/internal/members';
import { assertCanAssignRole } from '@/contexts/identity/internal/role-matrix';
import { listEmployees } from '@/contexts/identity/queries';
import { buildRequestContext } from '@/lib/audit/request-context';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { isPractitionerRole } from '@/lib/auth/practitioner';
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

// TODO(identity): extrair um mapIdentityError() quando esta lista passar de ~5 tipos (review #6).
function messageFrom(err: unknown): string {
  if (
    err instanceof RoleAssignmentError ||
    err instanceof EmailAlreadyMemberError ||
    err instanceof CrmConflictError ||
    err instanceof MemberNotFoundError ||
    err instanceof InviteAlreadyAcceptedError
  ) {
    return err.message;
  }
  return 'Não foi possível concluir a ação. Tente novamente.';
}

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
    });

    return { ok: true, nome: d.nome };
  } catch (err) {
    return { error: messageFrom(err) };
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
    return { error: messageFrom(err) };
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
    return { error: messageFrom(err) };
  }
}
