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
import { renderClinicInviteEmail } from '@/lib/email/templates/clinic-invite';
import { sendTransactionalEmail } from '@/lib/email/resend';
import { assertOnboardingRuntimeReady } from '@/lib/env';
import { createOnboardingInvitePath } from '@/lib/auth/onboarding-invite-fragment';
import { createOnboardingInviteUrl } from '@/lib/http/application-url';
import { captureBackgroundError } from '@/lib/observability/capture';
import { metrics } from '@/lib/observability/metrics';
import { cancelInviteTx, createInviteTx, generateInviteToken } from '@/contexts/onboarding';

import { guardAdminAccess } from '../_lib/guard';

export type InviteCreateState = {
  error: string | null;
  link?: string;
  emailDelivery?: 'sent' | 'failed';
};
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
  const requestHeaders = await headers();
  const rc = buildRequestContext(requestHeaders);

  const inviteId = await superAdminAction(
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
  const link = createOnboardingInvitePath(rawToken);
  if (!email) return { error: null, link };

  try {
    const content = renderClinicInviteEmail({ inviteUrl: createOnboardingInviteUrl(rawToken) });
    await sendTransactionalEmail({
      to: email,
      ...content,
      idempotencyKey: `onboarding-invite:${inviteId}`,
    });
    metrics.emit('onboarding.invite_email.sent', {});
    return { error: null, link, emailDelivery: 'sent' };
  } catch (error) {
    // The invitation is already committed and audited. Return its one-time link
    // rather than creating a duplicate invitation when provider delivery fails.
    captureBackgroundError(error, { flow: 'onboarding.invite_email' });
    metrics.emit('onboarding.invite_email.failed', { error });
    return { error: null, link, emailDelivery: 'failed' };
  }
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
