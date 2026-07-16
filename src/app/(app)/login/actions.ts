'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';

import { createServerClient } from '@/lib/auth/supabase-server';
import { hashEmail } from '@/lib/auth/email-hash';
import { recordLoginAttempt } from '@/lib/auth/login-audit';
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
    await recordLoginAttempt(emailHash, ip, false);
    return { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    await recordLoginAttempt(emailHash, ip, false);
    return { error: 'Email ou senha inválidos.' };
  }
  await recordLoginAttempt(emailHash, ip, true);

  // Lê profile via Supabase client (respeita RLS: profiles_self_select cobre).
  const { data: profileRows, error: profileErr } = await supabase
    .from('profiles')
    .select('role, mfa_enrolled_at, ativo, deleted_at')
    .eq('id', data.user.id)
    .limit(1);
  const profile = profileRows?.[0] as
    | { role?: string; mfa_enrolled_at?: string | null; ativo?: boolean; deleted_at?: string | null }
    | undefined;
  if (profileErr || !profile || !profile.role || !isRole(profile.role)) {
    await supabase.auth.signOut({ scope: 'local' });
    return { error: 'Profile inválido. Contate o administrador.' };
  }

  // I-10: profile desativado/deletado NÃO deve "logar e cair num estado inerte".
  // O deny real vem do hook (token sem claims), mas signInWithPassword sucede e a
  // action redirecionaria — criando "logado mas nada funciona" + um
  // record_login_attempt success=true para um desativado. Fecha aqui com mensagem
  // clara. Não fere anti-enumeração: a senha JÁ foi provada correta.
  if (profile.ativo === false || profile.deleted_at != null) {
    await supabase.auth.signOut({ scope: 'local' });
    return { error: 'Acesso desativado. Contate o administrador da clínica.' };
  }

  const aal = await getAal(supabase);
  const route = postLoginRedirect({
    role: profile.role,
    mfaEnrolledAt: profile.mfa_enrolled_at ? new Date(profile.mfa_enrolled_at) : null,
    aal,
  });
  redirect(route);
}
