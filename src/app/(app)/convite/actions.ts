'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { markInviteAccepted } from '@/contexts/identity/internal/members';
import { createServerClient } from '@/lib/auth/supabase-server';

const Schema = z
  .object({
    password: z.string().min(8, 'A senha deve ter ao menos 8 caracteres.').max(256),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { message: 'As senhas não conferem.', path: ['confirm'] });

export type AcceptState = { error: string | null };

/**
 * Aceite do convite: o convidado (já autenticado pelo link do Supabase) define a
 * senha e o convite passa a ACEITO (invite_accepted_at). Redireciona ao painel.
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

  const supabase = await createServerClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { error: 'Sessão inválida. Abra o link do convite novamente.' };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: error.message };

  await markInviteAccepted(userData.user.id);
  redirect('/dashboard');
}
