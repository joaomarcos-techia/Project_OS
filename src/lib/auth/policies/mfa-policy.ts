/**
 * MFA policy — pure functions, sem IO (D23).
 *
 * Centraliza "quem precisa de MFA?" e "quando enforce AAL2?". Servers Actions
 * e middleware consultam aqui em vez de espalhar `if (role === 'super_admin')`
 * em N lugares.
 *
 * Decisão: **ADR-038** — MFA obrigatório APENAS super_admin. gestor/financial
 * recebem opt-in forte mas NÃO são forçados: sem recovery codes + reset
 * administrativo + fluxo "perdi meu 2º fator", tornar compulsório troca o risco
 * de senha vazada pelo de funcionário legítimo trancado para fora.
 *
 * (Isto era citado como "ADR-008 D6" em 6+ documentos — mas D6 NUNCA existiu como
 * bullet escrito no ADR-008. A regra vivia só em prosa do PROGRESS. O I-5 da
 * auditoria de identidade pegou a referência pendurada; ADR-038 a formaliza.)
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
