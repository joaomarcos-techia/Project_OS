'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';

import { createServerClient } from '@/lib/auth/supabase-server';
import { readAuthoritativeProfile } from '@/lib/auth/tenant-context';
import { hashEmail } from '@/lib/auth/email-hash';
import { recordLoginAttempt } from '@/lib/auth/login-audit';
import { assertLoginAllowed, assertPasswordResetAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { postLoginRedirect } from '@/lib/auth/policies';
import { getAal } from '@/lib/auth/mfa';
import { isRole } from '@/lib/auth/roles';
import { createPasswordResetRedirectUrl } from '@/lib/http/application-url';
import { logger } from '@/lib/observability/logger';
import { metrics } from '@/lib/observability/metrics';

const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});

export type LoginActionState = {
  error: string | null;
};

const ForgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

export type ForgotPasswordActionState = {
  error: string | null;
  sent: boolean;
};

/**
 * Inicia recovery sem revelar se o endereço pertence a uma conta. A mensagem de
 * sucesso é idêntica para usuário ausente, rate-limit e falha do provedor; o
 * detalhe operacional fica somente nos logs sanitizados.
 */
export async function forgotPasswordAction(
  _prev: ForgotPasswordActionState,
  formData: FormData,
): Promise<ForgotPasswordActionState> {
  const parsed = ForgotPasswordSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { error: 'Informe um e-mail válido.', sent: false };
  }

  const email = parsed.data.email;
  const limit = await assertPasswordResetAllowed(getClientIp(await headers()), hashEmail(email));
  if (!limit.ok) {
    metrics.emit('auth.ratelimit.tripped', { route: 'forgot-password' });
    return { error: null, sent: true };
  }

  try {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: createPasswordResetRedirectUrl(),
    });
    if (error) {
      logger.warn('forgot_password.request_failed', { reason: 'provider_rejected' });
    }
  } catch (error) {
    logger.error('forgot_password.request_failed', {
      reason: error instanceof Error ? error.name : 'unknown',
    });
  }

  return { error: null, sent: true };
}

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
    // A1/M3: até aqui um bloqueio de rate-limit era INVISÍVEL fora da tabela
    // login_attempts — não dava para alertar sobre brute-force nem medir. Sem
    // PII: nem e-mail, nem hash, nem IP (o hash ainda é pseudônimo de pessoa; a
    // contagem é o que importa para o alerta).
    metrics.emit('auth.ratelimit.tripped', { route: 'login' });
    return { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    await recordLoginAttempt(emailHash, ip, false);
    // A1: alimenta a saved-search de brute-force (> N/5min). `reason` distingue
    // credencial inválida de bloqueio — são incidentes diferentes.
    metrics.emit('auth.login.failed', { reason: 'invalid_credentials' });
    return { error: 'Email ou senha inválidos.' };
  }
  await recordLoginAttempt(emailHash, ip, true);

  // Leitura server-side autoritativa. Não usa PostgREST/Data API: o navegador
  // fica restrito ao Auth/Realtime/Storage e não ganha uma superfície SQL CRUD.
  const profile = await readAuthoritativeProfile(data.user.id);
  if (!profile || !profile.role || !isRole(profile.role)) {
    await supabase.auth.signOut({ scope: 'local' });
    return { error: 'Profile inválido. Contate o administrador.' };
  }

  // I-10: profile desativado/deletado NÃO deve "logar e cair num estado inerte".
  // O deny real vem do hook (token sem claims), mas signInWithPassword sucede e a
  // action redirecionaria — criando "logado mas nada funciona" + um
  // record_login_attempt success=true para um desativado. Fecha aqui com mensagem
  // clara. Não fere anti-enumeração: a senha JÁ foi provada correta.
  if (profile.ativo === false || profile.deletedAt != null) {
    await supabase.auth.signOut({ scope: 'local' });
    return { error: 'Acesso desativado. Contate o administrador da clínica.' };
  }

  const aal = await getAal(supabase);
  const route = postLoginRedirect({
    role: profile.role,
    mfaEnrolledAt: profile.mfaEnrolledAt,
    aal,
  });
  redirect(route);
}
