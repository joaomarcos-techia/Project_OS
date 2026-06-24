/**
 * Supabase server client — único caminho para leitura de cookies/session
 * server-side em Next 15.
 *
 * Convenção:
 *   - Server Components / Server Actions / Route Handlers → createServerClient()
 *   - NUNCA chamar supabase.auth.getSession() (ESLint bloqueia). Use getUser()
 *     que round-trippa para validar signature.
 *
 * Next 15: cookies() é assíncrono. O adapter do @supabase/ssr aceita um getter
 * que retorna `RequestCookies | Promise<RequestCookies>`; usamos `await cookies()`
 * dentro dos handlers.
 *
 * Server-only — não importável de client components.
 */
import 'server-only';

import { createServerClient as createSsrClient, type CookieMethodsServer } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { env } from '@/lib/env';

// Teto de tempo para QUALQUER chamada à API do Supabase (Auth/REST) feita por
// este cliente. Sem isto, um stall do Supabase (Auth saturado, rede ruim) pendura
// o Server Component / Server Action até o undici matar a resposta em ~300s — o
// "login infinito" no passo de TOTP (challengeAndVerify/getAal) e no guard do
// /admin (getClaims). 20s é folga grande p/ um round-trip de auth (normal < 2s) e
// ainda tolera um cold-start; acima disso é melhor estourar e deixar o usuário
// re-tentar do que pendurar a tela.
const SUPABASE_FETCH_TIMEOUT_MS = 20_000;

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPABASE_FETCH_TIMEOUT_MS);
  // Respeita um signal que o caller já tenha passado (encadeia os aborts).
  const callerSignal = init?.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function supabaseEnv(): { url: string; key: string } {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      '[auth/supabase-server] NEXT_PUBLIC_SUPABASE_URL ou key publishable/anon ausentes.',
    );
  }
  return { url, key };
}

/**
 * Cliente para Server Components, Server Actions e Route Handlers.
 * Lê/escreve cookies via next/headers (assíncrono em Next 15).
 *
 * Em Server Components puros (read-only), o adapter pode lançar quando tenta
 * setAll — capturamos e ignoramos como recomendação oficial Supabase.
 */
export async function createServerClient(): Promise<SupabaseClient> {
  const { url, key } = supabaseEnv();
  const cookieStore = await cookies();

  const adapter: CookieMethodsServer = {
    getAll() {
      return cookieStore.getAll().map(({ name, value }) => ({ name, value }));
    },
    setAll(items) {
      try {
        for (const { name, value, options } of items) {
          cookieStore.set(name, value, options);
        }
      } catch {
        // Lendo de Server Component: setAll não disponível. Esperado — o
        // middleware refresh-a tokens. Silencioso por design (Supabase docs).
      }
    },
  };

  return createSsrClient(url, key, {
    cookies: adapter,
    global: { fetch: fetchWithTimeout },
  });
}
