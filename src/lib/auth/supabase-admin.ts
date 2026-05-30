/**
 * Supabase admin client — usa SERVICE_ROLE key, BYPASSA RLS.
 *
 * Use APENAS em:
 *   - scripts/ (seed-super-admin, smoke-login, test-hook)
 *   - src/app/(admin)/** (rotas super_admin)
 *   - src/app/api/admin/** (endpoints admin)
 *   - código de bootstrap que precisa criar/listar users via Admin API
 *
 * IMPORTANTE: NÃO importa `server-only` propositalmente — scripts CLI (tsx,
 * fora do Next) precisam importar este módulo, e `server-only` lança quando
 * importado fora de Server Component bundle. Proteção contra import em
 * client bundle vem do ESLint guard em eslint.config.mjs (no-restricted-imports
 * em `createAdminClient` para os mesmos paths que dbAdmin).
 *
 * Para uso runtime tenant-scoped, SEMPRE preferir createServerClient() do
 * supabase-server.ts (respeita RLS, usa JWT do usuário).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';

let cached: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  if (cached) return cached;

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) {
    throw new Error(
      '[auth/supabase-admin] NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY/SERVICE_ROLE_KEY ausentes. ' +
        'Required para Admin API calls em C3+.',
    );
  }

  cached = createClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return cached;
}
