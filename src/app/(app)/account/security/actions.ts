'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { createServerClient } from '@/lib/auth/supabase-server';
import { enrollTotp, listFactors, unenrollTotp, verifyTotpEnroll } from '@/lib/auth/mfa';
import { requireUser } from '@/lib/auth/tenant-context';

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
  await requireUser();
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
  await requireUser();
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
  revalidatePath('/account/security');
  return { ...INITIAL_ENROLL, step: 'done' };
}

export async function unenrollAction(formData: FormData): Promise<void> {
  const factorId = String(formData.get('factorId') ?? '');
  if (!factorId) return;
  await requireUser();
  const supabase = await createServerClient();
  await unenrollTotp(supabase, factorId);
  // Re-checar se ainda há factor verified; se não, limpa mfa_enrolled_at via RPC.
  const remaining = await listFactors(supabase);
  if (!remaining.some((f) => f.status === 'verified')) {
    await supabase.rpc('mark_mfa_enrolled', { p_enrolled: false });
  }
  revalidatePath('/account/security');
  redirect('/account/security');
}
