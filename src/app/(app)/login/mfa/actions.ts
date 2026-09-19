'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getAal, challengeAndVerify, listFactors } from '@/lib/auth/mfa';
import { postLoginRedirect } from '@/lib/auth/policies';
import { assertMfaAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { isRole } from '@/lib/auth/roles';
import { clearSupabaseSessionSelector, createServerClient } from '@/lib/auth/supabase-server';
import { readAuthoritativeProfile } from '@/lib/auth/tenant-context';
import { metrics } from '@/lib/observability/metrics';

export type MfaActionState = {
  error: string | null;
};

/**
 * Sai somente da sessão deste navegador antes de voltar ao login. O usuário
 * ainda está em AAL1 nesta tela; navegar direto para `/login` manteria o cookie
 * e a política de autenticação o enviaria de volta ao desafio MFA.
 */
export async function switchAccountAction(_prev: MfaActionState): Promise<MfaActionState> {
  try {
    const supabase = await createServerClient({ cookieWrites: 'required' });
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      return { error: 'Não foi possível trocar de conta. Tente novamente.' };
    }
    await clearSupabaseSessionSelector();
  } catch {
    return { error: 'Não foi possível trocar de conta. Tente novamente.' };
  }

  redirect('/login');
}

export async function verifyMfaAction(
  _prev: MfaActionState,
  formData: FormData,
): Promise<MfaActionState> {
  const code = String(formData.get('code') ?? '').trim();
  if (!/^\d{6}$/.test(code)) {
    return { error: 'Código deve ter 6 dígitos.' };
  }
  const supabase = await createServerClient({ cookieWrites: 'required' });

  // M3: brute-force do 2º fator dependia SÓ do throttle do GoTrue. O usuário já
  // está em AAL1 aqui (passou a senha), então há userId para limitar.
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return { error: 'Sessão expirada. Faça login novamente.' };
  const rl = await assertMfaAllowed(authData.user.id, getClientIp(await headers()));
  if (!rl.ok) {
    metrics.emit('auth.ratelimit.tripped', { route: 'mfa' });
    return { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' };
  }

  let factors: Awaited<ReturnType<typeof listFactors>>;
  try {
    factors = await listFactors(supabase);
  } catch {
    return { error: 'Não foi possível validar o segundo fator. Tente novamente.' };
  }
  const verified = factors.find((f) => f.status === 'verified');
  if (!verified) {
    return { error: 'Nenhum fator TOTP verificado encontrado.' };
  }
  try {
    await challengeAndVerify(supabase, verified.id, code);
  } catch (e) {
    // A1: um enxame de MFA falho era invisível — nem métrica, nem log. Só o
    // MOTIVO, nunca o código nem o userId (o volume é o sinal de ataque).
    metrics.emit('auth.mfa.failed', {
      reason: e instanceof Error ? e.name : 'unknown',
    });
    return { error: 'Código inválido ou expirado.' };
  }

  // C15: agora em AAL2, decide o destino pela MESMA routing-policy do loginAction.
  // super_admin → /admin (Platform Admin); demais roles → /dashboard.
  let route = '/dashboard';
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    const profile = await readAuthoritativeProfile(data.user.id);
    if (profile?.role && isRole(profile.role)) {
      const aal = await getAal(supabase);
      route = postLoginRedirect({
        role: profile.role,
        mfaEnrolledAt: profile.mfaEnrolledAt,
        aal,
      });
    }
  }
  redirect(route);
}
