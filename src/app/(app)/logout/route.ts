/**
 * POST /logout
 *
 * Duas revogações, e nenhuma substitui a outra:
 *
 *   1. `bumpSessionEpoch()` — mata os ACCESS TOKENS já emitidos. É o que o
 *      usuário quer dizer com "Sair": o cookie desta aba, a aba antiga, o
 *      outro dispositivo. Todos falham no PRÓXIMO request pelo epoch-check da
 *      porta única (ADR-037).
 *   2. `signOut({scope:'global'})` — revoga os REFRESH tokens (D24), impedindo
 *      que alguém troque um refresh guardado por um token novo.
 *
 * AUTH-005: só o (2) existia. O contrato do Supabase — citado no próprio
 * `tenant-context.ts` — é explícito em que ele não invalida o access token, e
 * o pentest confirmou em produção: cookie copiado antes do logout e segunda
 * sessão continuaram no Dashboard. O epoch existia desde o ADR-037; ninguém o
 * incrementava aqui.
 *
 * ORDEM IMPORTA: o epoch primeiro. Se o bump falhar, não declaramos logout
 * global concluído — melhor devolver erro e o usuário tentar de novo do que
 * limpar o browser e deixar as outras sessões vivas achando que saiu.
 */
import { redirect } from 'next/navigation';

import { bumpSessionEpoch } from '@/lib/auth/session-epoch';
import { createServerClient } from '@/lib/auth/supabase-server';
import { getCurrentUser } from '@/lib/auth/tenant-context';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  const supabase = await createServerClient();
  // Sem sessão válida não há epoch a bumpar (nem token vivo a matar): limpar
  // cookies e seguir para o login é o comportamento correto e idempotente.
  const user = await getCurrentUser();

  if (user) {
    try {
      await bumpSessionEpoch(user.userId, 'logout');
    } catch (err) {
      // Fail-closed: a sessão continua válida e o usuário vê que não saiu.
      // O contrário — 303 para /login com o token ainda bom — é o achado.
      logger.error('logout.epoch_bump_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
      return new Response('Não foi possível encerrar a sessão. Tente novamente.', { status: 503 });
    }
  }

  await supabase.auth.signOut({ scope: 'global' });
  redirect('/login');
}
