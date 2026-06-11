'use server';

import { redirect } from 'next/navigation';

import { createServerClient } from '@/lib/auth/supabase-server';
import { challengeAndVerify, listFactors } from '@/lib/auth/mfa';

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
  // /dashboard até o C15 existir — '/admin/select-clinic' (destino original,
  // hardcoded aqui e na routing-policy) é rota do platform-admin futuro e
  // devolvia 404 no login do super_admin com MFA (observado em prod 2026-06-11).
  redirect('/dashboard');
}
