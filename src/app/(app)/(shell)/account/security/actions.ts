'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { createServerClient } from '@/lib/auth/supabase-server';
import { enrollTotp, listFactors, unenrollTotp, verifyTotpEnroll } from '@/lib/auth/mfa';
import { assertMfaAllowed, getClientIp } from '@/lib/auth/rate-limit';
import { requireUser } from '@/lib/auth/tenant-context';

/** M3 — teto da superfície MFA (enroll/verify/unenroll). Ver [rate-limit.ts]. */
async function mfaRateLimited(userId: string): Promise<boolean> {
  const rl = await assertMfaAllowed(userId, getClientIp(await headers()));
  return !rl.ok;
}

const RATE_LIMITED = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';

export type EnrollResultState = {
  step: 'idle' | 'enrolling' | 'verifying' | 'done';
  factorId: string | null;
  qrSvg: string | null;
  secret: string | null;
  error: string | null;
};

const INITIAL_ENROLL: EnrollResultState = {
  step: 'idle',
  factorId: null,
  qrSvg: null,
  secret: null,
  error: null,
};

export async function startEnrollAction(): Promise<EnrollResultState> {
  const user = await requireUser();
  if (await mfaRateLimited(user.userId)) return { ...INITIAL_ENROLL, error: RATE_LIMITED };
  const supabase = await createServerClient();
  try {
    const enroll = await enrollTotp(supabase);
    return {
      step: 'verifying',
      factorId: enroll.factorId,
      qrSvg: enroll.qrCodeSvg,
      secret: enroll.secret,
      error: null,
    };
  } catch (e) {
    return {
      ...INITIAL_ENROLL,
      error: e instanceof Error ? e.message : 'Falha ao iniciar enrollment.',
    };
  }
}

export async function verifyEnrollAction(
  prev: EnrollResultState,
  formData: FormData,
): Promise<EnrollResultState> {
  const factorId = String(formData.get('factorId') ?? '');
  const code = String(formData.get('code') ?? '').trim();
  if (!factorId || !/^\d{6}$/.test(code)) {
    return { ...prev, error: 'Código de 6 dígitos obrigatório.' };
  }
  const user = await requireUser();
  if (await mfaRateLimited(user.userId)) return { ...prev, error: RATE_LIMITED };
  const supabase = await createServerClient();
  try {
    await verifyTotpEnroll(supabase, factorId, code);
  } catch (e) {
    return { ...prev, error: e instanceof Error ? e.message : 'Código inválido.' };
  }
  // Marca mfa_enrolled_at via RPC SECURITY DEFINER (D31 — coluna-a-coluna controlada).
  const { error } = await supabase.rpc('mark_mfa_enrolled', { p_enrolled: true });
  if (error) {
    return { ...prev, error: error.message };
  }

  // I-8: acabou de adicionar um 2º fator. As OUTRAS sessões foram estabelecidas
  // SEM ele — revoga-as (mantém esta). Elas re-logam e agora enfrentam o MFA.
  // Determinístico, não depende de config do GoTrue. Best-effort.
  await supabase.auth.signOut({ scope: 'others' }).catch(() => {
    /* não-fatal — o enroll está concluído */
  });

  revalidatePath('/account/security');
  return { ...INITIAL_ENROLL, step: 'done' };
}

export async function unenrollAction(formData: FormData): Promise<void> {
  const factorId = String(formData.get('factorId') ?? '');
  if (!factorId) return;
  const user = await requireUser();
  // R-04 (auditoria 2026-06-10): remover um factor VERIFICADO exige sessão
  // AAL2. O GoTrue já recusa em AAL1 (confirmado em prod 2026-06-11), mas a
  // recusa aflorava como exceção não-tratada (500). Guard explícito aqui:
  // AAL1 → volta ao challenge TOTP (defense-in-depth + UX). aal null é
  // fail-closed (token antigo sem claim → trata como não-AAL2).
  if (user.aal !== 'aal2') {
    redirect('/login/mfa');
  }
  // Param PRÓPRIO — não reusar `unenroll_error`, cuja mensagem manda "conclua a
  // verificação TOTP". Além de errada aqui, ela é auto-derrotante: o verify consome o
  // MESMO bucket, então seguir a instrução gasta mais orçamento e repete o erro.
  if (await mfaRateLimited(user.userId)) {
    redirect('/account/security?rate_limited=1');
  }
  const supabase = await createServerClient();
  try {
    await unenrollTotp(supabase, factorId);
  } catch {
    // Recusa do GoTrue (ex.: AAL insuficiente em corrida de sessão) ou rede.
    redirect('/account/security?unenroll_error=1');
  }
  // Re-checar se ainda há factor verified; se não, limpa mfa_enrolled_at via RPC.
  const remaining = await listFactors(supabase);
  if (!remaining.some((f) => f.status === 'verified')) {
    await supabase.rpc('mark_mfa_enrolled', { p_enrolled: false });
  }
  revalidatePath('/account/security');
  redirect('/account/security');
}
