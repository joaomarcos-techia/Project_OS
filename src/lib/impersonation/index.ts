/**
 * Módulo de impersonate (C15) — encapsula cookie + sessão autoritativa.
 *
 * Superfície pública:
 *   - startImpersonation  → cria sessão (revoga anterior) + seta cookie. (Server Action)
 *   - resolveImpersonation→ escopo efetivo p/ tenant-context (bind ao super_admin).
 *   - stopImpersonation   → revoga + limpa cookie. (Server Action)
 *   - revokeImpersonation → kill switch por id. (Server Action / operador)
 *   - getImpersonationView→ projeção display-only p/ o banner (NÃO usa tenant-context).
 *
 * Decisões (plano C15 §2):
 *   - O cookie só carrega o id assinado; a LINHA manda. (OR-I6)
 *   - resolveImpersonation só devolve algo p/ super_admin com AAL2 (OR-I7).
 *   - getImpersonationView NÃO importa tenant-context (evita ciclo; banner só
 *     depende deste módulo — review #9).
 *
 * Server-only.
 */
import 'server-only';

import { cookies } from 'next/headers';

import type { Tx } from '@/lib/db';

import { IMPERSONATION_COOKIE, readImpersonationCookie, signImpersonationCookie } from './cookie';
import {
  IMPERSONATION_TTL_SECONDS,
  createSessionTx,
  findActiveSession,
  findActiveSessionView,
  revokeSession,
} from './session';
import type { ImpersonationSession, ImpersonationView } from './types';

export { IMPERSONATION_COOKIE, IMPERSONATION_TTL_SECONDS };
export type { ImpersonationSession, ImpersonationView };

/** Campos mínimos que o módulo precisa do usuário (evita ciclo com tenant-context). */
interface ImpersonatingUser {
  userId: string;
  isSuperAdmin: boolean;
  aal: 'aal1' | 'aal2' | null;
}

/**
 * Cria a sessão DENTRO da tx do superAdminAction (atômico com impersonate_start).
 * Retorna o impersonationId. O cookie é setado DEPOIS do commit, via
 * setImpersonationCookie (cookies() não pode rodar dentro da tx do pool max:1).
 */
export async function createImpersonationSessionTx(
  tx: Tx,
  args: { superAdminId: string; clinicId: string; ip: string | null; userAgent: string | null },
): Promise<string> {
  return createSessionTx(tx, args);
}

/** Seta o cookie assinado após a sessão ter sido criada/commitada. */
export async function setImpersonationCookie(impersonationId: string): Promise<void> {
  const store = await cookies();
  store.set(IMPERSONATION_COOKIE, signImpersonationCookie(impersonationId), {
    httpOnly: true,
    // Em produção exigimos HTTPS; em dev (localhost http) o browser descartaria
    // um cookie Secure — então liberamos só fora de produção para testes locais.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: IMPERSONATION_TTL_SECONDS,
  });
}

/**
 * Resolve o escopo efetivo. Devolve null se: não é super_admin, não está em
 * AAL2, cookie ausente/forjado, ou sessão inexistente/expirada/revogada.
 * O bind ao super_admin (findActiveSession) impede uso cruzado de cookie.
 */
export async function resolveImpersonation(
  user: ImpersonatingUser,
): Promise<ImpersonationSession | null> {
  if (!user.isSuperAdmin || user.aal !== 'aal2') return null;
  const store = await cookies();
  const id = readImpersonationCookie(store.get(IMPERSONATION_COOKIE)?.value);
  if (!id) return null;
  const row = await findActiveSession(id, user.userId);
  if (!row) return null;
  return { impersonationId: row.id, clinicId: row.clinicId, startedAt: row.startedAt };
}

/** Encerra a sessão atual: revoga a linha e limpa o cookie. */
export async function stopImpersonation(): Promise<{ impersonationId: string } | null> {
  const store = await cookies();
  const id = readImpersonationCookie(store.get(IMPERSONATION_COOKIE)?.value);
  store.delete(IMPERSONATION_COOKIE);
  if (!id) return null;
  await revokeSession(id);
  return { impersonationId: id };
}

/** Kill switch por id (operador / incidente). Não mexe no cookie do caller. */
export async function revokeImpersonation(impersonationId: string): Promise<void> {
  await revokeSession(impersonationId);
}

/** Projeção display-only para o banner. Cookie válido + sessão ativa. */
export async function getImpersonationView(): Promise<ImpersonationView | null> {
  const store = await cookies();
  const id = readImpersonationCookie(store.get(IMPERSONATION_COOKIE)?.value);
  if (!id) return null;
  return findActiveSessionView(id);
}
