/**
 * Tipos públicos do módulo de impersonate (C15).
 *
 * O ESTADO de impersonate NUNCA vira um "role lógico". Ele é encapsulado aqui e
 * exposto a `CurrentUser` apenas como `session.impersonation` (plano C15 §2.2).
 */

/** Sessão de impersonate resolvida (escopo efetivo). Bind ao super_admin. */
export interface ImpersonationSession {
  impersonationId: string;
  clinicId: string;
  /** ISO. */
  startedAt: string;
}

/** Projeção leve para o banner (não depende de tenant-context). */
export interface ImpersonationView {
  impersonationId: string;
  clinicId: string;
  clinicNome: string;
  /** ISO. */
  startedAt: string;
  /** ISO. */
  expiresAt: string;
}
