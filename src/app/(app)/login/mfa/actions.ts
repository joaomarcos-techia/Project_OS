'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getAal, challengeAndVerify, listFactors } from '@/lib/auth/mfa';
import { postLoginRedirect } from '@/lib/auth/policies';
import { assertMfaAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { isRole } from '@/lib/auth/roles';
import { createServerClient } from '@/lib/auth/supabase-server';

export type MfaActionState = {
  error: string | null;
};

export async function verifyMfaAction(
  _prev: MfaActionState,
  formData: FormData,
): Promise<MfaActionState> {
  const code = String(formData.get('code') ?? '').trim();
  if (!/^\d{6}$/.test(code)) {
    return { error: 'Código deve ter 6 dígitos.' };
  }
  const supabase = await createServerClient();

  // M3: brute-force do 2º fator dependia SÓ do throttle do GoTrue. O usuário já
  // está em AAL1 aqui (passou a senha), então há userId para limitar.
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return { error: 'Sessão expirada. Faça login novamente.' };
  const rl = await assertMfaAllowed(authData.user.id, getClientIp(await headers()));
  if (!rl.ok) return { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' };

  const factors = await listFactors(supabase);
  const verified = factors.find((f) => f.status === 'verified');
  if (!verified) {
    return { error: 'Nenhum fator TOTP verificado encontrado.' };
  }
  try {
    await challengeAndVerify(supabase, verified.id, code);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Código inválido.' };
  }

  // C15: agora em AAL2, decide o destino pela MESMA routing-policy do loginAction.
  // super_admin → /admin (Platform Admin); demais roles → /dashboard.
  let route = '/dashboard';
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    const { data: rows } = await supabase
      .from('profiles')
      .select('role, mfa_enrolled_at')
      .eq('id', data.user.id)
      .limit(1);
    const profile = rows?.[0] as { role?: string; mfa_enrolled_at?: string | null } | undefined;
    if (profile?.role && isRole(profile.role)) {
      const aal = await getAal(supabase);
      route = postLoginRedirect({
        role: profile.role,
        mfaEnrolledAt: profile.mfa_enrolled_at ? new Date(profile.mfa_enrolled_at) : null,
        aal,
      });
    }
  }
  redirect(route);
}
