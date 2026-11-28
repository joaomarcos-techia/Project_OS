'use server';

import { cookies } from 'next/headers';

import { readTissFootprintLazy } from '@/app/(app)/_lib/tiss-footprint';
import { isInTissPasswordScope } from '@/lib/auth/security-profile/password-policy';
import { isTissProfileEnforced } from '@/lib/auth/security-profile/tiss-scope';
import {
  SESSION_ACTIVITY_COOKIE,
  SESSION_ACTIVITY_COOKIE_OPTIONS,
  encodeSessionActivity,
  sessionActivitySecret,
} from '@/lib/auth/session-activity';
import { createServerClient } from '@/lib/auth/supabase-server';
import { authenticate } from '@/lib/auth/tenant-context';
import { metrics } from '@/lib/observability/metrics';

export type SessionActivityResult =
  | { ok: true; enforced: boolean }
  | { ok: false; locked: boolean };

/**
 * S2 / requisito 83 — o guarda do shell chama esta action quando houve interação (tecla, clique, toque, rolagem),
 * no máximo a cada 30 s, e ao montar. A porta única (`authenticate`) roda ANTES: sessão já bloqueada continua
 * bloqueada (renovar nunca ressuscita). Com a sessão ativa, grava o cookie assinado com o horário do servidor, o
 * usuário, a sessão e o alcance do perfil TISS (leitor do rastro injetado; rastro ilegível = no alcance).
 */
export async function registerSessionActivityAction(): Promise<SessionActivityResult> {
  const auth = await authenticate();
  if (!auth.ok) return { ok: false, locked: auth.reason === 'SESSION_LOCKED' };
  if (!isTissProfileEnforced(process.env)) return { ok: true, enforced: false };

  const sessionId = auth.identity.sessionId;
  if (!sessionId) return { ok: false, locked: false };
  const scope = await isInTissPasswordScope(auth.identity.clinicId, readTissFootprintLazy);
  (await cookies()).set(
    SESSION_ACTIVITY_COOKIE,
    encodeSessionActivity(
      { uid: auth.identity.userId, sid: sessionId, at: Date.now(), scope },
      sessionActivitySecret(),
    ),
    SESSION_ACTIVITY_COOKIE_OPTIONS,
  );
  return { ok: true, enforced: scope };
}

/**
 * Encerramento legítimo depois do bloqueio: o guarda já salvou o rascunho pendente e escondeu a tela; aqui a
 * sessão local é encerrada no Auth (`signOut` local) e o cookie de atividade sai. O cliente segue para
 * `/login?reason=inactivity`. Action (POST com a proteção de origem do Next), não GET: um link de fora não desloga.
 */
export async function lockSessionAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  // Sem sessão não há o que encerrar: negativa explícita ANTES de qualquer escrita de cookie (nenhuma action "dá
  // certo" sem sessão, e uma action que muda cookie devolve a página re-renderizada em vez do próprio resultado).
  let supabase: Awaited<ReturnType<typeof createServerClient>>;
  try {
    supabase = await createServerClient({ cookieWrites: 'required' });
    const { data } = await supabase.auth.getClaims();
    if (!data?.claims) return { ok: false, error: 'Nenhuma sessão para encerrar.' };
  } catch {
    return { ok: false, error: 'Nenhuma sessão para encerrar.' };
  }
  (await cookies()).delete(SESSION_ACTIVITY_COOKIE);
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    return { ok: false, error: 'Não foi possível encerrar a sessão agora.' };
  }
  metrics.emit('auth.session.locked', { reason: 'client_idle' });
  return { ok: true };
}
