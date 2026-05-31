'use server';

import { headers } from 'next/headers';
import { z } from 'zod';

import { createServerClient } from '@/lib/auth/supabase-server';
import { hashEmail } from '@/lib/auth/email-hash';
import { assertPasswordResetAllowed, getClientIp } from '@/lib/auth/rate-limit';

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
  const hdrs = await headers();

  // F-06: rate limit (IP + email_hash) ANTES de disparar o email de reset —
  // evita email-flooding / abuso. Sempre retornamos sent=true (anti-enumeration):
  // se limitado, apenas NÃO disparamos o email. F-08: fail-open se Upstash cair.
  const limit = await assertPasswordResetAllowed(getClientIp(hdrs), hashEmail(parsed.data.email));
  if (!limit.ok) {
    return { error: null, sent: true };
  }

  const supabase = await createServerClient();
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
