/**
 * Atualização da credencial profissional do próprio membro. `profiles` não tem
 * política ampla de UPDATE para authenticated (D31), portanto este é o comando
 * estreito e auditado para CRM/UF/especialidade — não uma exceção genérica de
 * self-service.
 */
import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { logAudit } from '@/lib/audit/log';
import type { RequestContext } from '@/lib/audit/types';
import { withTenant } from '@/lib/db/tenant';

import { CrmConflictError, MemberNotFoundError, ProfessionalCredentialError } from '../errors';
import { profiles } from '../schema';
import { normalizeCrm, normalizeCrmUf } from './normalize-crm';

const CREDENTIAL_ROLES = new Set(['owner', 'gestor', 'doctor']);

export interface UpdateOwnProfessionalCredentialArgs {
  clinicId: string;
  userId: string;
  crm: string;
  crmUf: string;
  especialidade?: string | null;
  requestContext: RequestContext;
}

/** Atualiza CRM/UF/especialidade do próprio profissional e deixa trilha de auditoria. */
export async function updateOwnProfessionalCredential(
  args: UpdateOwnProfessionalCredentialArgs,
): Promise<void> {
  const crm = normalizeCrm(args.crm);
  const crmUf = normalizeCrmUf(args.crmUf);
  const especialidade = args.especialidade?.trim() || null;
  if (!crm || !crmUf) throw new ProfessionalCredentialError('Informe o CRM e a UF.');

  try {
    await withTenant(args.clinicId, async (tx) => {
      const [before] = await tx
        .select({
          role: profiles.role,
          ativo: profiles.ativo,
          crm: profiles.crm,
          crmUf: profiles.crmUf,
          especialidade: profiles.especialidade,
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
      if (!before) throw new MemberNotFoundError('Perfil profissional não encontrado.');
      if (!before.ativo || !CREDENTIAL_ROLES.has(before.role)) {
        throw new ProfessionalCredentialError(
          'Seu perfil não pode cadastrar uma credencial profissional.',
        );
      }

      if (before.crm === crm && before.crmUf === crmUf && before.especialidade === especialidade)
        return;

      await tx
        .update(profiles)
        .set({ crm, crmUf, especialidade })
        .where(and(eq(profiles.id, args.userId), eq(profiles.clinicId, args.clinicId)));

      await logAudit(tx, {
        clinicId: args.clinicId,
        userId: args.userId,
        action: 'internal.user.credential_changed',
        resourceType: 'profile',
        resourceId: args.userId,
        before: { crm: before.crm, crmUf: before.crmUf, especialidade: before.especialidade },
        after: { crm, crmUf, especialidade },
        requestContext: args.requestContext,
      });
    });
  } catch (err) {
    if ((err as { code?: unknown }).code === '23505') throw new CrmConflictError();
    throw err;
  }
}
