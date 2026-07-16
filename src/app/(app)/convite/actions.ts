'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { markInviteAccepted } from '@/contexts/identity/internal/members';
import { assertInviteAcceptAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { createServerClient } from '@/lib/auth/supabase-server';
import { logger } from '@/lib/observability/logger';

const Schema = z
  .object({
    password: z.string().min(8, 'A senha deve ter ao menos 8 caracteres.').max(256),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { message: 'As senhas não conferem.', path: ['confirm'] });

export type AcceptState = { error: string | null };

const RATE_LIMITED = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';

/**
 * Aceite do convite: o convidado (já autenticado pelo link do Supabase, mas SEM
 * claims — o hook nega enquanto invite_accepted_at IS NULL, I-3) define a senha, o
 * convite passa a ACEITO, e a sessão é revalidada.
 *
 * Ordem importa:
 *   1. rate-limit (I-12) — o link é bearer out-of-band; limita o abuso do aceite.
 *   2. updateUser(password) — prova de posse do e-mail (o ponto do gate).
 *   3. signOut({scope:'others'}) — I-8: definir a senha revoga OUTRAS sessões
 *      (se o link vazou e alguém abriu antes, aquela sessão morre agora).
 *   4. markInviteAccepted — liga o gate: a partir daqui o hook injeta claims.
 *   5. refreshSession — o JWT em mãos foi emitido PENDENTE (sem claims); sem trocar
 *      por um token novo, o convidado cairia em /login. Se o refresh falhar (rede),
 *      NÃO fica preso: a senha já existe, então /login?reason=invite_accepted é
 *      garantido — sem loop de retry.
 */
export async function acceptInviteAction(
  _prev: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  const parsed = Schema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };

  const ip = getClientIp(await headers());
  const rl = await assertInviteAcceptAllowed(ip);
  if (!rl.ok) return { error: RATE_LIMITED };

  const supabase = await createServerClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { error: 'Sessão inválida. Abra o link do convite novamente.' };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    // Mensagem genérica (não vaza detalhe do GoTrue); o cru vai para o log.
    logger.warn('convite.accept.update_password_failed', { message: error.message });
    return { error: 'Não foi possível definir a senha. Tente novamente.' };
  }

  // I-8: revoga outras sessões após a troca de senha (determinístico, não depende de
  // config invisível do GoTrue). Best-effort — não trava o aceite.
  await supabase.auth.signOut({ scope: 'others' }).catch(() => {
    /* não-fatal: o aceite segue; as outras sessões morrem no epoch se drift */
  });

  await markInviteAccepted(userData.user.id);

  // Troca o token pendente (sem claims) por um com claims. Se falhar, cai no login.
  const { error: refreshErr } = await supabase.auth.refreshSession();
  if (refreshErr) {
    logger.warn('convite.accept.refresh_failed', { message: refreshErr.message });
    redirect('/login?reason=invite_accepted');
  }

  redirect('/dashboard');
}
