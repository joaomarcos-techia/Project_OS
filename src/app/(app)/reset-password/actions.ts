'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { hashEmail } from '@/lib/auth/email-hash';
import { assertPasswordResetCompletionAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { RECOVERY_GRANT_COOKIE, readRecoveryGrant } from '@/lib/auth/recovery-grant';
import { bumpSessionEpoch } from '@/lib/auth/session-epoch';
import { createServerClient } from '@/lib/auth/supabase-server';
import { readAuthoritativeProfile } from '@/lib/auth/tenant-context';
import { logger } from '@/lib/observability/logger';

const Schema = z.object({ password: z.string().min(8).max(256) });

export type ResetState = { error: string | null };

/**
 * Mensagem única para TODAS as recusas de autorização (ausente, expirado,
 * forjado, usuário errado, já consumido). Distingui-las diria a um atacante
 * qual metade do ataque funcionou.
 */
const INVALID_GRANT =
  'Link de redefinição inválido, expirado ou já utilizado. Peça um novo ao administrador.';

export async function resetPasswordAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const parsed = Schema.safeParse({ password: formData.get('password') });
  if (!parsed.success) {
    return { error: 'Senha deve ter ao menos 8 caracteres.' };
  }
  const supabase = await createServerClient();

  // V10 (auditoria de segurança): valida EXPLICITAMENTE a sessão (não confia só
  // no cookie) e aplica rate-limit.
  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email;
  const userId = userData.user?.id;
  if (!email || !userId) {
    return { error: INVALID_GRANT };
  }

  // ------------------------------------------------------------------
  // AUTH-006 — prova de recovery, não "tem sessão"
  // ------------------------------------------------------------------
  // Antes, o único check era o `getUser()` acima: uma sessão autenticada por
  // SENHA passava por ele e trocava a credencial. O grant abaixo só existe se
  // um `verifyOtp(type:'recovery')` tiver acontecido no servidor.
  const jar = await cookies();
  const grant = readRecoveryGrant(jar.get(RECOVERY_GRANT_COOKIE)?.value);
  if (!grant || grant.userId !== userId) {
    logger.warn('reset_password.grant_missing', { hasGrant: grant !== null });
    return { error: INVALID_GRANT };
  }

  // Uso único: o grant carrega o epoch da emissão e vale enquanto o banco
  // ainda estiver nele. O bump no fim deste fluxo é o que o queima.
  const profile = await readAuthoritativeProfile(userId);
  if (!profile || profile.claimsVersion !== grant.epoch) {
    logger.warn('reset_password.grant_stale', {});
    return { error: INVALID_GRANT };
  }

  // Mesma defesa do login/forgot (F-06/F-08): IP + email_hash, fail-open se o
  // Upstash cair. Limitado → mensagem genérica (não confirma nada ao atacante).
  const limit = await assertPasswordResetCompletionAllowed(
    getClientIp(await headers()),
    hashEmail(email),
  );
  if (!limit.ok) {
    return { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    // V10: NÃO vazar `error.message` cru (podia expor detalhe interno). Mensagem
    // genérica ao usuário; o detalhe vai só para o observability.
    logger.warn('reset_password.update_failed', { message: error.message });
    return { error: 'Não foi possível redefinir a senha. Tente novamente.' };
  }

  // ------------------------------------------------------------------
  // AUTH-007 — expulsar de verdade quem já estava dentro
  // ------------------------------------------------------------------
  // Quem redefine a senha está recuperando uma conta possivelmente
  // comprometida. Antes existia só `signOut({scope:'others'})`, que revoga
  // REFRESH tokens — e o pentest mostrou a segunda sessão navegando no
  // Dashboard depois do reset, porque o ACCESS token dela continuava válido.
  // O bump do epoch mata todos os tokens já emitidos no próximo request,
  // inclusive o desta própria sessão de recovery (que vai para /login).
  // Ele TAMBÉM queima o grant consumido acima.
  let revoked = true;
  try {
    revoked = await bumpSessionEpoch(userId, 'password_reset');
  } catch (err) {
    revoked = false;
    logger.error('reset_password.epoch_bump_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Fecha o outro lado: refresh tokens de TODAS as sessões (antes era
  // 'others'; a desta sessão também deve morrer, já que o epoch a derrubou).
  await supabase.auth.signOut({ scope: 'global' }).catch(() => {
    /* não-fatal: o epoch já derrubou os access tokens */
  });
  jar.delete(RECOVERY_GRANT_COOKIE);

  if (!revoked) {
    // A senha JÁ mudou — não dá para desfazer, e fingir sucesso pleno seria
    // mentir sobre o estado das outras sessões. Dizemos o que aconteceu.
    return {
      error:
        'Senha atualizada, mas não foi possível encerrar as outras sessões. Entre novamente e avise o administrador da clínica.',
    };
  }

  redirect('/login?reason=password_updated');
}
