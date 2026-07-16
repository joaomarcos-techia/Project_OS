'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { hashEmail } from '@/lib/auth/email-hash';
import { assertPasswordResetAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { createServerClient } from '@/lib/auth/supabase-server';
import { logger } from '@/lib/observability/logger';

const Schema = z.object({ password: z.string().min(8).max(256) });

export type ResetState = { error: string | null };

export async function resetPasswordAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const parsed = Schema.safeParse({ password: formData.get('password') });
  if (!parsed.success) {
    return { error: 'Senha deve ter ao menos 8 caracteres.' };
  }
  const supabase = await createServerClient();

  // V10 (auditoria de segurança): valida EXPLICITAMENTE a recovery session (não
  // confia só no cookie) e aplica rate-limit — antes era a única ação de auth sem
  // throttle. Sem user/e-mail na sessão de recovery → mensagem genérica.
  const { data: userData } = await supabase.auth.getUser();
  const email = userData.user?.email;
  if (!email) {
    return { error: 'Link de redefinição inválido ou expirado. Solicite um novo.' };
  }

  // Mesma defesa do login/forgot (F-06/F-08): IP + email_hash, fail-open se o
  // Upstash cair. Limitado → mensagem genérica (não confirma nada ao atacante).
  const limit = await assertPasswordResetAllowed(getClientIp(await headers()), hashEmail(email));
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

  // I-8: quem redefine a senha geralmente está RECUPERANDO uma conta comprometida.
  // Revoga as OUTRAS sessões (mantém esta) — determinístico, não depende de config
  // invisível do GoTrue. Sem isto, o atacante com refresh token ativo continuaria
  // dentro mesmo depois da vítima trocar a senha. Best-effort: não trava o reset.
  await supabase.auth.signOut({ scope: 'others' }).catch(() => {
    /* não-fatal — o redirect segue; sessões restantes caem no epoch se drift */
  });

  redirect('/login?reason=password_updated');
}
