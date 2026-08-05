/**
 * Supabase browser client — para uso em client components (forms de login,
 * MFA enroll/verify).
 *
 * Singleton no nível do módulo (Next bundler cria 1 instância por bundle).
 * NUNCA usar para decisões de autorização — sempre revalidar via Server Action
 * que chama getCurrentUser() no server.
 */
import { createBrowserClient as createSsrBrowser } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function createBrowserClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_DEV ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      '[auth/supabase-browser] NEXT_PUBLIC_SUPABASE_URL / key publishable ausentes no bundle.',
    );
  }
  cached = createSsrBrowser(url, key);
  return cached;
}
