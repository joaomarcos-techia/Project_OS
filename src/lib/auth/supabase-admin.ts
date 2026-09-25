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
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

import { env } from '@/lib/env';

let cached: SupabaseClient | null = null;
const SUPABASE_ADMIN_FETCH_TIMEOUT_MS = 20_000;
const ADMIN_USER_FILTER_LIMIT = 10;

export type AdminUserByEmailLookup =
  | { kind: 'found'; user: User }
  | { kind: 'missing' }
  | { kind: 'unavailable' };

function adminConfiguration(): { url: string; secret: string } {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) {
    throw new Error(
      '[auth/supabase-admin] NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY/SERVICE_ROLE_KEY ausentes. ' +
        'Required para Admin API calls em C3+.',
    );
  }
  return { url, secret };
}

/** A Admin API também é I/O remoto e não pode prender uma rota indefinidamente. */
function fetchAdminWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPABASE_ADMIN_FETCH_TIMEOUT_MS);
  const callerSignal = init?.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export function createAdminClient(): SupabaseClient {
  if (cached) return cached;

  const { url, secret } = adminConfiguration();

  cached = createClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: { fetch: fetchAdminWithTimeout },
  });
  return cached;
}

/**
 * Busca indexada pelo filtro nativo do GoTrue.
 *
 * O SDK JS expõe apenas paginação em `listUsers`, embora o endpoint oficial
 * aceite `filter`. Usar o endpoint aqui evita varrer toda a base a cada reenvio
 * e ainda exige igualdade exata antes de devolver o usuário.
 */
export async function findAdminUserByEmail(email: string): Promise<AdminUserByEmailLookup> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 160) return { kind: 'unavailable' };

  try {
    const { url, secret } = adminConfiguration();
    const endpoint = new URL('/auth/v1/admin/users', url);
    endpoint.searchParams.set('filter', normalized);
    endpoint.searchParams.set('page', '1');
    endpoint.searchParams.set('per_page', String(ADMIN_USER_FILTER_LIMIT));
    const response = await fetchAdminWithTimeout(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        apikey: secret,
        Authorization: `Bearer ${secret}`,
      },
      cache: 'no-store',
    });
    if (!response.ok) return { kind: 'unavailable' };
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null || !('users' in body)) {
      return { kind: 'unavailable' };
    }
    const users = Reflect.get(body, 'users');
    if (!Array.isArray(users)) return { kind: 'unavailable' };
    const exact = users.filter(
      (candidate): candidate is User =>
        typeof candidate === 'object' &&
        candidate !== null &&
        typeof Reflect.get(candidate, 'id') === 'string' &&
        typeof Reflect.get(candidate, 'email') === 'string' &&
        Reflect.get(candidate, 'email').trim().toLowerCase() === normalized,
    );
    if (exact.length === 0) return { kind: 'missing' };
    return exact.length === 1 ? { kind: 'found', user: exact[0]! } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
