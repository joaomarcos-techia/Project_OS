'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';

import {
  ensurePasswordAuthenticatedSignupAuthBinding,
  readSignupAuthBinding,
} from '@/contexts/onboarding';
import {
  CAPTCHA_ERROR_MESSAGE,
  captchaOptions,
  isCaptchaError,
  readCaptchaToken,
} from '@/lib/auth/captcha';
import { createServerClient } from '@/lib/auth/supabase-server';
import { readAuthoritativeProfile } from '@/lib/auth/tenant-context';
import { hashEmail } from '@/lib/auth/email-hash';
import { recordLoginAttempt } from '@/lib/auth/login-audit';
import { assertLoginAllowed, assertPasswordResetAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { postLoginRedirect } from '@/lib/auth/policies';
import { resolvePreTenantOnboarding } from '@/lib/auth/pretenant-onboarding';
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
      // Presente só quando o widget produziu um token. Com o captcha desligado
      // no projeto, o GoTrue ignora o campo.
      ...captchaOptions(readCaptchaToken(formData)),
    });
    if (error) {
      // O motivo distingue desafio reprovado de rejeição do provedor — são
      // incidentes diferentes e o conserto de cada um é outro. A RESPOSTA ao
      // usuário continua idêntica nos dois casos: esta action nunca revela se
      // o endereço existe, e um erro visível de captcha aqui seria um oráculo
      // a menos de ruído para quem enumera contas.
      logger.warn('forgot_password.request_failed', {
        reason: isCaptchaError(error) ? 'captcha_failed' : 'provider_rejected',
      });
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

  const supabase = await createServerClient({ cookieWrites: 'required', newSession: true });
  // `options` é omitido quando não há token: mandar `{ captchaToken: '' }` faz o
  // GoTrue tratar como token INVÁLIDO, não como ausente.
  const options = captchaOptions(readCaptchaToken(formData));
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
    ...(options ? { options } : {}),
  });
  if (error || !data.user) {
    // Captcha reprovado NÃO é tentativa de credencial: contá-lo como falha de
    // login envenenaria o rate limit por e-mail (um widget expirado bloquearia
    // a conta de quem digitou a senha certa) e o sinal de brute-force.
    if (isCaptchaError(error)) {
      metrics.emit('auth.login.failed', { reason: 'captcha_failed' });
      return { error: CAPTCHA_ERROR_MESSAGE };
    }
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
  if (!profile) {
    const onboarding = await resolvePreTenantOnboarding(supabase);
    if (onboarding.ok) {
      if (onboarding.kind === 'redirect') redirect(onboarding.route);
      const currentBinding = readSignupAuthBinding(data.user);
      if (currentBinding?.passwordState === 'set') redirect('/cadastro/continuar');
      // Contas pré-tenant criadas antes do marker em app_metadata já têm senha.
      // O login acabou de prová-la; reata o marker apenas à linha verificada que
      // o mesmo user/e-mail possui, sem aceitar referência vinda do formulário.
      const binding = await ensurePasswordAuthenticatedSignupAuthBinding({
        userId: onboarding.userId,
        email: onboarding.email,
      });
      if (binding.ok) redirect('/cadastro/continuar');
    }
    await supabase.auth.signOut({ scope: 'local' });
    return { error: 'Profile inválido. Contate o administrador.' };
  }
  if (!profile.role || !isRole(profile.role)) {
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
