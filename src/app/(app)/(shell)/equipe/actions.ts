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
import { CrmConflictError, EmailAlreadyMemberError, RoleAssignmentError } from '@/contexts/identity/errors';
import { inviteClinicMember } from '@/contexts/identity/internal/members';
import { assertCanAssignRole } from '@/contexts/identity/internal/role-matrix';
import { listEmployees } from '@/contexts/identity/queries';
import { buildRequestContext } from '@/lib/audit/request-context';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';

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

function messageFrom(err: unknown): string {
  if (
    err instanceof RoleAssignmentError ||
    err instanceof EmailAlreadyMemberError ||
    err instanceof CrmConflictError
  ) {
    return err.message;
  }
  return 'Não foi possível enviar o convite. Tente novamente.';
}

export async function inviteMemberAction(input: InviteMemberInput): Promise<InviteMemberResult> {
  const user = await requireUser();
  await requireFreshPermission(PERMISSIONS.MANAGE_EMPLOYEES); // crítica (D20/F-14) — lê do banco
  const clinicId = await requireClinicId();
  await requireActiveClinic(clinicId); // ADR-016 — clínica suspensa não convida

  const parsed = InviteMemberSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  const d = parsed.data;

  // CRM opcional no convite (spec §Edge cases). Só médico tem credencial.
  const crm = d.role === 'doctor' && d.crm ? d.crm : null;
  const crmUf = d.role === 'doctor' && d.crmUf ? d.crmUf : null;
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
