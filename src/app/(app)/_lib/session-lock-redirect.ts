import { redirect } from 'next/navigation';

import { authenticate } from '@/lib/auth/tenant-context';

/**
 * Para onde vai quem chegou sem identidade: sessão bloqueada por inatividade (S2) recebe o aviso próprio no login;
 * o resto, o login de sempre. `authenticate` é memoizado por requisição: nenhuma consulta nova.
 */
export async function redirectToLogin(): Promise<never> {
  const auth = await authenticate();
  redirect(!auth.ok && auth.reason === 'SESSION_LOCKED' ? '/login?reason=inactivity' : '/login');
}
