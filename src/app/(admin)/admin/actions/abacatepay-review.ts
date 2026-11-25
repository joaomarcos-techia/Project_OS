'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { buildRequestContext } from '@/lib/audit/request-context';
import { superAdminAction } from '@/lib/audit/super-admin';
import { challengeAndVerify, listFactors } from '@/lib/auth/mfa';
import { requireUser } from '@/lib/auth/tenant-context';
import { createServerClient } from '@/lib/auth/supabase-server';
import { captureBackgroundError } from '@/lib/observability/capture';
import {
  abacatePayReplayInput,
  AbacatePayReviewError,
  authorizeAbacatePayReplayTx,
} from '@/contexts/billing/internal/abacatepay-review';
import { reconcileAbacatePayInbox } from '@/contexts/billing/internal/abacatepay-processing';
import { guardAdminAccess } from '../_lib/guard';

export type ReplayActionState = { error: string | null; message?: string };

export async function replayAbacatePayReviewAction(
  _previous: ReplayActionState,
  form: FormData,
): Promise<ReplayActionState> {
  await guardAdminAccess();
  const parsed = abacatePayReplayInput.safeParse({
    accountId: form.get('accountId'),
    eventId: form.get('eventId'),
    clinicId: form.get('clinicId'),
    snapshot: form.get('snapshot'),
    reason: form.get('reason'),
    evidenceReference: form.get('evidenceReference'),
  });
  const code = String(form.get('code') ?? '').trim();
  if (!parsed.success || !/^\d{6}$/.test(code))
    return { error: 'Confira os dados e informe os 6 dígitos do autenticador.' };
  try {
    const supabase = await createServerClient({ cookieWrites: 'required' });
    const factor = (await listFactors(supabase)).find((f) => f.status === 'verified');
    if (!factor)
      return { error: 'Configure um autenticador antes de autorizar o reprocessamento.' };
    await challengeAndVerify(supabase, factor.id, code);
  } catch {
    return { error: 'Não foi possível confirmar o autenticador. Tente um código atual.' };
  }
  const actor = await requireUser();
  try {
    await superAdminAction(
      {
        action: 'abacatepay_review_replay_authorized',
        targetClinicId: parsed.data.clinicId,
        payload: {
          accountId: parsed.data.accountId,
          eventId: parsed.data.eventId,
          reason: parsed.data.reason,
          evidenceReference: parsed.data.evidenceReference,
        },
        requestContext: buildRequestContext(await headers()),
      },
      (tx) => authorizeAbacatePayReplayTx(tx, parsed.data, actor.userId),
    );
  } catch (error) {
    if (error instanceof AbacatePayReviewError)
      return {
        error:
          error.code === 'replay_limit'
            ? 'Limite de 3 reprocessamentos por evento em 24 horas. Encaminhe o incidente à engenharia.'
            : 'O evento mudou ou está indisponível. Atualize a página antes de tentar novamente.',
      };
    captureBackgroundError(new Error('AbacatePay review authorization failed'), {
      flow: 'billing.abacatepay.review',
    });
    return { error: 'A autorização não foi concluída. Nenhum pagamento foi marcado como pago.' };
  }
  // The approval is durable before I/O. A timeout cannot erase it or reset the attempt counter.
  let message =
    'Nova leitura autorizada e enfileirada. O evento continua sujeito à prova financeira.';
  try {
    const result = await reconcileAbacatePayInbox({ eventId: parsed.data.eventId });
    if (result.scanned)
      message = result.review
        ? 'A leitura foi executada e o evento continua em revisão. Não houve liberação por intervenção manual.'
        : 'A leitura foi executada. Confira o histórico e o período reconciliado antes de encerrar o incidente.';
  } catch {
    captureBackgroundError(new Error('AbacatePay authorized readback deferred'), {
      flow: 'billing.abacatepay.review',
    });
  }
  revalidatePath('/admin/billing/operacao');
  return { error: null, message };
}
