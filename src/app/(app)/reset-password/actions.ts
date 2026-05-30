'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createServerClient } from '@/lib/auth/supabase-server';

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
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: error.message };
  }
  redirect('/login?reason=password_updated');
}
