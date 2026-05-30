/**
 * MFA policy — pure functions, sem IO (D23).
 *
 * Centraliza "quem precisa de MFA?" e "quando enforce AAL2?". Servers Actions
 * e middleware consultam aqui em vez de espalhar `if (role === 'super_admin')`
 * em N lugares.
 *
 * Decisão D6 (MVP): MFA obrigatório APENAS super_admin. gestor/financial
 * recebem opt-in forte mas NÃO são forçados (até recovery codes + admin reset
 * existirem em C15).
 */
import type { Role } from '@/lib/auth/roles';

export function mustHaveMFA(role: Role): boolean {
  return role === 'super_admin';
}

export function mustEnforceAAL2(role: Role): boolean {
  return role === 'super_admin';
}

/**
 * Para gestor/financial: UI exibe banner "ative MFA" no primeiro login,
 * mas não bloqueia. Esta função decide se o banner aparece.
 */
export function shouldPromptMFAEnroll(role: Role, mfaEnrolledAt: Date | null): boolean {
  if (mfaEnrolledAt !== null) return false;
  return role === 'gestor' || role === 'financial' || role === 'super_admin';
}
