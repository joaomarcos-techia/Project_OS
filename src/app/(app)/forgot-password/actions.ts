'use server';

import { headers } from 'next/headers';
import { z } from 'zod';

import { createServerClient } from '@/lib/auth/supabase-server';

const Schema = z.object({ email: z.string().email().max(254) });

export type ForgotState = { error: string | null; sent: boolean };

export async function forgotPasswordAction(
  _prev: ForgotState,
  formData: FormData,
): Promise<ForgotState> {
  const parsed = Schema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { error: 'Email inválido.', sent: false };
  }
  const supabase = await createServerClient();
  const hdrs = await headers();
  const origin = hdrs.get('origin') ?? 'http://localhost:3000';
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/reset-password`,
  });
  if (error) {
    // Não vazamos detalhes — mensagem genérica evita user enumeration.
  }
  // Sempre retorna sent=true (idem — anti-enumeration).
  return { error: null, sent: true };
}
