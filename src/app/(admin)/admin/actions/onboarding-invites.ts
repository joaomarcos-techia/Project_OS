'use server';

/**
 * Server Actions de convite de clínica (onboarding via convite mágico) — F1.
 *
 * Escrita de PLATAFORMA (convite é pré-clínica, não dado de tenant). Padrão de
 * actions/impersonation: guardAdminAccess (404 se não super_admin AAL2) → validação
 * → superAdminAction (auditado; o fn recebe a tx dbAdmin e cria/cancela o convite).
 * NÃO importa dbAdmin/withTenant. O token CRU é gerado aqui e devolvido UMA vez no
 * link — nunca persiste (só o HMAC vai pro banco).
 */
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { buildRequestContext } from '@/lib/audit/request-context';
import { superAdminAction } from '@/lib/audit/super-admin';
import { requireUser } from '@/lib/auth/tenant-context';
import { assertOnboardingRuntimeReady } from '@/lib/env';
import { cancelInviteTx, createInviteTx, generateInviteToken } from '@/contexts/onboarding';

import { guardAdminAccess } from '../_lib/guard';

export type InviteCreateState = { error: string | null; link?: string };
export type InviteActionState = { error: string | null; ok?: boolean };

const CreateInput = z.object({
  email: z.string().trim().email().max(160).optional().or(z.literal('')),
  planId: z.string().uuid().optional().or(z.literal('')),
  note: z.string().trim().max(280).optional().or(z.literal('')),
});

/** Cria um convite (status pending, expira em 24h). Devolve o link cru UMA vez. */
export async function createClinicInviteAction(
  _prev: InviteCreateState,
  formData: FormData,
): Promise<InviteCreateState> {
  await guardAdminAccess();
  assertOnboardingRuntimeReady();

  const parsed = CreateInput.safeParse({
    email: formData.get('email') ?? '',
    planId: formData.get('planId') ?? '',
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) return { error: 'Dados inválidos (verifique o e-mail).' };

  const email = parsed.data.email ? parsed.data.email : null;
  const suggestedPlanId = parsed.data.planId ? parsed.data.planId : null;
  const note = parsed.data.note ? parsed.data.note : null;

  const { rawToken } = generateInviteToken();
  const user = await requireUser();
  const rc = buildRequestContext(await headers());

  await superAdminAction(
    {
      action: 'clinic_invite_created',
      targetClinicId: null,
      payload: { email, suggestedPlanId, note },
      requestContext: rc,
    },
    (tx) =>
      createInviteTx(tx, {
        rawToken,
        createdBy: user.userId,
        email,
        // plan_snapshot é pinado no checkout; aqui só a sugestão do admin em metadata.
        planSnapshot: null,
        metadata: { suggestedPlanId, note },
      }),
  );

  // SEM revalidatePath aqui: ele força o re-render síncrono de /admin/clinicas (queries
  // pesadas) como parte da resposta do submit → "loading infinito" no modal. O modal já
  // mostra o link; a lista é atualizada pelo router.refresh() no client ao fechar.
  return { error: null, link: `/join/${rawToken}` };
}

/** Cancela um convite (override do admin — por id, qualquer estado menos completed). */
export async function cancelClinicInviteAction(
  _prev: InviteActionState,
  formData: FormData,
): Promise<InviteActionState> {
  await guardAdminAccess();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Convite inválido.' };

  const rc = buildRequestContext(await headers());
  const ok = await superAdminAction(
    {
      action: 'clinic_invite_cancelled',
      targetClinicId: null,
      payload: { inviteId: id.data },
      requestContext: rc,
    },
    (tx) => cancelInviteTx(tx, id.data),
  );
  if (!ok) return { error: 'Convite não encontrado ou já provisionado.' };

  revalidatePath('/admin/clinicas');
  return { error: null, ok: true };
}
