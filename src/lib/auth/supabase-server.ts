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

import {
  createSupabaseSessionGeneration,
  isSupabaseSessionGeneration,
  supabaseAuthCookieName,
  SUPABASE_SESSION_SELECTOR_COOKIE,
  SUPABASE_SESSION_SELECTOR_MAX_AGE,
  SUPABASE_SESSION_COOKIE_OPTIONS,
} from './supabase-session-cookie';

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
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
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
/**
 * Fixa os atributos do cookie de sessão em vez de herdá-los (auditoria
 * 2026-09-10, item 7 — "SameSite=Lax no mínimo").
 *
 * A sessão Supabase contém access e refresh tokens reutilizáveis. Somente o
 * servidor os lê; HttpOnly impede a leitura por JavaScript no origin. O default
 * instalado do @supabase/ssr não fornece essa proteção.
 *
 * `secure` acompanha o ambiente: forçá-lo sempre quebraria o login em
 * `http://localhost`, e um cookie que não é gravado em dev vira workaround.
 * Mesmo critério já usado em `app/(app)/auth/confirm/route.ts`.
 *
 * Tudo o mais que a biblioteca decide (nome, `maxAge`, `path`, `domain`,
 * fragmentação `.0`/`.1`) passa intacto.
 */
export function hardenCookie<T extends Record<string, unknown>>(
  options: T | undefined,
): Omit<T, 'httpOnly' | 'sameSite' | 'secure'> & {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
} {
  return {
    ...((options ?? {}) as T),
    ...SUPABASE_SESSION_COOKIE_OPTIONS,
  };
}

type CreateServerClientOptions = {
  /** Em Route Handlers/Actions que mudam Auth, falhar a escrita deve abortar o fluxo. */
  cookieWrites?: 'best-effort' | 'required';
  /** Login/OTP cria uma geração nova para não disputar Set-Cookie com refreshes antigos. */
  newSession?: boolean;
  /** Signup com confirmação obrigatória não pode instalar auto-login inesperado. */
  sessionWrites?: 'allow' | 'reject';
};

export async function createServerClient(
  options: CreateServerClientOptions = {},
): Promise<SupabaseClient> {
  const { url, key } = supabaseEnv();
  const cookieStore = await cookies();
  const selectedGeneration = cookieStore.get(SUPABASE_SESSION_SELECTOR_COOKIE)?.value;
  const generation = options.newSession
    ? createSupabaseSessionGeneration()
    : isSupabaseSessionGeneration(selectedGeneration)
      ? selectedGeneration
      : createSupabaseSessionGeneration();
  const cookieName = supabaseAuthCookieName(url, generation);
  if (!cookieName) {
    throw new Error('[auth/supabase-server] NEXT_PUBLIC_SUPABASE_URL não gera cookie válido.');
  }
  let newSessionBound = false;

  const adapter: CookieMethodsServer = {
    getAll() {
      return cookieStore.getAll().map(({ name, value }) => ({ name, value }));
    },
    setAll(items) {
      const sessionItems = items.filter(
        ({ name }) => name === cookieName || name.startsWith(`${cookieName}.`),
      );
      if (
        options.sessionWrites === 'reject' &&
        sessionItems.some(({ value }) => value.length > 0)
      ) {
        throw new Error('[auth/supabase-server] Unexpected signup session');
      }
      const persist = () => {
        for (const { name, value, options: cookieOptions } of items) {
          cookieStore.set(name, value, hardenCookie(cookieOptions));
        }
        if (options.newSession) {
          if (sessionItems.some(({ value }) => value.length > 0)) {
            cookieStore.set(SUPABASE_SESSION_SELECTOR_COOKIE, generation, {
              ...SUPABASE_SESSION_COOKIE_OPTIONS,
              path: '/',
              maxAge: SUPABASE_SESSION_SELECTOR_MAX_AGE,
            });
            newSessionBound = true;
          } else if (newSessionBound && sessionItems.length > 0) {
            cookieStore.set(SUPABASE_SESSION_SELECTOR_COOKIE, '', {
              ...SUPABASE_SESSION_COOKIE_OPTIONS,
              path: '/',
              maxAge: 0,
              expires: new Date(0),
            });
            newSessionBound = false;
          }
        }
      };
      if (options.cookieWrites === 'required') {
        persist();
        return;
      }
      try {
        persist();
      } catch {
        // Server Components não podem escrever cookies. O middleware encaminha
        // sessões próximas do vencimento ao Route Handler gravável antes do RSC.
      }
    },
  };

  return createSsrClient(url, key, {
    cookies: adapter,
    cookieOptions: { name: cookieName, ...SUPABASE_SESSION_COOKIE_OPTIONS },
    global: { fetch: fetchWithTimeout },
  });
}

/**
 * Desvincula a geração atual. Refreshes já em voo podem regravar o cookie da
 * geração antiga, mas sem este seletor ele nunca volta a ser uma sessão ativa.
 */
export async function clearSupabaseSessionSelector(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SUPABASE_SESSION_SELECTOR_COOKIE, '', {
    ...SUPABASE_SESSION_COOKIE_OPTIONS,
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  });
}
