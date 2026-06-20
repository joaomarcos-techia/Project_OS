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
  | '/admin';

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
  // super_admin já AAL2 → painel da plataforma (C15). O destino é a home do
  // Platform Admin; o founder nunca cai no app tenant sem clínica (o que
  // lançaria em requireClinicId). Operar uma clínica é só via impersonate.
  if (ctx.role === 'super_admin') {
    return '/admin';
  }
  // Demais roles: direto para dashboard
  return '/dashboard';
}
