/**
 * MFA — facade fino sobre supabase.auth.mfa.* (TOTP nativo).
 *
 * Decisão D1 (plano C3): usar Supabase Auth MFA nativo (não otplib próprio).
 * AAL1/AAL2 fluem no JWT já validado server-side. Zero TOTP secret em nossa DB.
 *
 * Decisão D6: MFA obrigatório APENAS super_admin no MVP. gestor/financial
 * recebem opt-in forte (UI prompta). Re-avaliar em C15 com recovery codes.
 *
 * Helpers de POLICY (quem precisa de MFA? quando enforce AAL2?) vivem em
 * src/lib/auth/policies/mfa-policy.ts (pure functions, sem IO, D23). Este
 * módulo só wrappa o Supabase SDK.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export interface MFAEnrollResult {
  factorId: string;
  qrCodeSvg: string;
  secret: string;
}

/** Inicia enrollment de novo factor TOTP. Retorna QR + secret para o usuário escanear. */
export async function enrollTotp(supabase: SupabaseClient): Promise<MFAEnrollResult> {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
  if (error) throw error;
  return {
    factorId: data.id,
    qrCodeSvg: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

/**
 * Verifica código TOTP durante enrollment (primeira verificação após enroll
 * conclui o setup do factor).
 */
export async function verifyTotpEnroll(
  supabase: SupabaseClient,
  factorId: string,
  code: string,
): Promise<void> {
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) throw challenge.error;
  const verify = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code,
  });
  if (verify.error) throw verify.error;
}

/**
 * Verifica TOTP durante login (passo /login/mfa). Promove AAL1 → AAL2.
 */
export async function challengeAndVerify(
  supabase: SupabaseClient,
  factorId: string,
  code: string,
): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw error;
}

/** Remove factor TOTP (unenroll). */
export async function unenrollTotp(supabase: SupabaseClient, factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

/**
 * Retorna o nível atual de AAL (Authentication Assurance Level).
 * - aal1: senha apenas
 * - aal2: senha + TOTP verificado
 */
export async function getAal(supabase: SupabaseClient): Promise<'aal1' | 'aal2' | null> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return null;
  if (data.currentLevel === 'aal2') return 'aal2';
  if (data.currentLevel === 'aal1') return 'aal1';
  return null;
}

/** Lista factors registrados no profile do usuário corrente. */
export async function listFactors(
  supabase: SupabaseClient,
): Promise<Array<{ id: string; type: 'totp'; status: 'verified' | 'unverified' }>> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return (data.totp ?? []).map((f) => ({
    id: f.id,
    type: 'totp' as const,
    status: f.status as 'verified' | 'unverified',
  }));
}
