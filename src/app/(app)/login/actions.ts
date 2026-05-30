'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';

import { createServerClient } from '@/lib/auth/supabase-server';
import { hashEmail } from '@/lib/auth/email-hash';
import { assertLoginAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { postLoginRedirect } from '@/lib/auth/policies';
import { getAal } from '@/lib/auth/mfa';
import { isRole } from '@/lib/auth/roles';

const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});

export type LoginActionState = {
  error: string | null;
};

export async function loginAction(
  _prev: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: 'Email ou senha inválidos.' };
  }
  const { email, password } = parsed.data;
  const ip = getClientIp(await headers());

  // Rate limit DUAL (D15) — checa antes de tentar signInWithPassword.
  const emailHash = hashEmail(email);
  const limit = await assertLoginAllowed(ip, emailHash);
  if (!limit.ok) {
    await recordAttempt(emailHash, ip, false);
    return { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    await recordAttempt(emailHash, ip, false);
    return { error: 'Email ou senha inválidos.' };
  }
  await recordAttempt(emailHash, ip, true);

  // Lê profile via Supabase client (respeita RLS: profiles_self_select cobre).
  const { data: profileRows, error: profileErr } = await supabase
    .from('profiles')
    .select('role, mfa_enrolled_at')
    .eq('id', data.user.id)
    .limit(1);
  const profile = profileRows?.[0] as { role?: string; mfa_enrolled_at?: string | null } | undefined;
  if (profileErr || !profile || !profile.role || !isRole(profile.role)) {
    await supabase.auth.signOut({ scope: 'local' });
    return { error: 'Profile inválido. Contate o administrador.' };
  }

  const aal = await getAal(supabase);
  const route = postLoginRedirect({
    role: profile.role,
    mfaEnrolledAt: profile.mfa_enrolled_at ? new Date(profile.mfa_enrolled_at) : null,
    aal,
  });
  redirect(route);
}

async function recordAttempt(
  emailHash: string,
  ip: string,
  success: boolean,
): Promise<void> {
  // Chama RPC via Supabase client (anon/authenticated tem GRANT EXECUTE).
  // Falha de auditoria NÃO bloqueia o fluxo de login.
  try {
    const supabase = await createServerClient();
    await supabase.rpc('record_login_attempt', {
      p_email_hash: emailHash,
      p_ip: ip,
      p_success: success,
    });
  } catch {
    // ignore — auditoria best-effort
  }
}
