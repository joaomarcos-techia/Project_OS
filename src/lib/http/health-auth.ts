import 'server-only';

import { getCurrentUser } from '@/lib/auth/tenant-context';
import { safeEqual } from '@/lib/auth/secret-compare';
import { env } from '@/lib/env';

/**
 * Auth dos endpoints de health (MEDIUM-19): Bearer `CRON_SECRET` = monitoring;
 * super_admin AAL2 = detalhe extra. Sem credencial → `denied` (o caller devolve
 * 401), o que evita profiling público da infra.
 *
 * Ponto único das três rotas de `/api/health/**`. Vive separado de
 * [cron-auth.ts] de propósito: aqui a resolução de super_admin lê cookie via
 * `getCurrentUser()`, e o caminho de cron não pode arrastar essa dependência —
 * ele precisa continuar puro sobre `Request`.
 *
 * F-09: o Bearer é o controle real. Não se exige o header `x-vercel-cron`, que
 * monitores externos (UptimeRobot/Better Stack) não têm como enviar.
 */
export type HealthAuthLevel = 'monitoring' | 'super_admin' | 'denied';

export async function healthAuthLevel(req: Request): Promise<HealthAuthLevel> {
  // super_admin primeiro: se estiver logado, devolve o detalhe completo.
  try {
    const user = await getCurrentUser();
    if (user?.isSuperAdmin && user.aal === 'aal2') return 'super_admin';
  } catch {
    // sessão ausente/inválida não é erro aqui — cai no Bearer.
  }

  // `CRON_SECRET` é optional() no schema (só `assertCronRuntimeReady()` o exige).
  // Sem este guard, `Bearer ${undefined}` interpolaria para a string literal
  // "Bearer undefined" e QUALQUER chamador enviando esse header autenticaria.
  // Fail-close aqui, e não na memória de quem chama.
  const secret = env.CRON_SECRET;
  if (secret && safeEqual(req.headers.get('authorization'), `Bearer ${secret}`)) return 'monitoring';
  return 'denied';
}
