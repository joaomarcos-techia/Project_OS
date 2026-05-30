/**
 * Routing policy — pure functions, sem IO (D23).
 *
 * Decide para onde redirecionar após login com base no estado do user. Server
 * Actions de login chamam aqui em vez de espalhar if/else.
 *
 * Inputs: estado já lido (role, MFA enrolled, AAL atual).
 * Output: rota destino.
 */
import type { Role } from '@/lib/auth/roles';

import { mustHaveMFA } from './mfa-policy';

export type PostLoginRoute =
  | '/login/mfa'
  | '/account/security?force=1'
  | '/dashboard'
  | '/admin/select-clinic';

export interface PostLoginContext {
  role: Role;
  mfaEnrolledAt: Date | null;
  aal: 'aal1' | 'aal2' | null;
}

export function postLoginRedirect(ctx: PostLoginContext): PostLoginRoute {
  // super_admin sem MFA enrolled → força enrollment
  if (mustHaveMFA(ctx.role) && ctx.mfaEnrolledAt === null) {
    return '/account/security?force=1';
  }
  // super_admin com MFA mas só AAL1 → vai para challenge TOTP
  if (mustHaveMFA(ctx.role) && ctx.aal !== 'aal2') {
    return '/login/mfa';
  }
  // super_admin já AAL2 → dashboard admin (em C15 vira "select clinic" para impersonate)
  if (ctx.role === 'super_admin') {
    return '/admin/select-clinic';
  }
  // Demais roles: direto para dashboard
  return '/dashboard';
}
