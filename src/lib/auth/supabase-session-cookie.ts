/** A sessão Supabase só é lida e renovada no servidor. */
export const SUPABASE_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
} as const;

export const SUPABASE_SESSION_SELECTOR_COOKIE = 'qoro-auth-session';
export const SUPABASE_SESSION_SELECTOR_MAX_AGE = 400 * 24 * 60 * 60;

type CookieEntry = { name: string; value: string };

function supabaseProjectRef(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const project = new URL(url).hostname.split('.')[0];
    return project && /^[a-z0-9-]+$/i.test(project) ? project : null;
  } catch {
    return null;
  }
}

/** Prefixo exclusivo da sessão server-only. */
export function supabaseAuthCookiePrefix(url: string | undefined): string | null {
  const project = supabaseProjectRef(url);
  return project ? `sb-${project}-auth-token-v2` : null;
}

export function isSupabaseSessionGeneration(value: string | undefined): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value);
}

export function createSupabaseSessionGeneration(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

/**
 * Cada sessão estabelecida recebe um nome próprio. Refreshes antigos só podem
 * regravar o nome da geração antiga; nunca alteram o seletor da sessão atual.
 */
export function supabaseAuthCookieName(
  url: string | undefined,
  generation: string | undefined,
): string | null {
  const prefix = supabaseAuthCookiePrefix(url);
  return prefix && isSupabaseSessionGeneration(generation) ? `${prefix}-${generation}` : null;
}

/** Nome default usado antes do cutover HttpOnly; serve somente para expiração, nunca migração. */
export function supabaseLegacyAuthCookieName(url: string | undefined): string | null {
  const project = supabaseProjectRef(url);
  return project ? `sb-${project}-auth-token` : null;
}

/** Cookies v2 de qualquer geração, inclusive o nome estático usado durante desenvolvimento local. */
export function supabaseVersionedAuthCookies(
  cookies: readonly CookieEntry[],
  prefix: string,
): CookieEntry[] {
  return cookies.filter(
    (cookie) =>
      cookie.name === prefix ||
      cookie.name.startsWith(`${prefix}-`) ||
      new RegExp(`^${prefix}\\.[0-9]+$`).test(cookie.name),
  );
}

/** Inclui o cookie inteiro ou todos os fragmentos `.0`, `.1`, ... do mesmo projeto. */
export function supabaseAuthCookies(cookies: readonly CookieEntry[], name: string): CookieEntry[] {
  return cookies.filter(
    (cookie) => cookie.name === name || new RegExp(`^${name}\\.[0-9]+$`).test(cookie.name),
  );
}

/**
 * Sinal de UX para enviar uma navegação ao Route Handler gravável antes do RSC.
 * Isto NÃO autentica ninguém: o Auth server e os guards continuam sendo a autoridade.
 */
export function sessionNeedsRefresh(
  cookies: readonly CookieEntry[],
  name: string,
  now = Date.now(),
) {
  const parts = supabaseAuthCookies(cookies, name);
  if (parts.length === 0) return false;
  const whole = parts.find((part) => part.name === name)?.value;
  const chunks = parts
    .filter((part) => part.name !== name)
    .sort((a, b) => Number(a.name.slice(name.length + 1)) - Number(b.name.slice(name.length + 1)));
  const contiguous = chunks.every((part, index) => part.name === `${name}.${index}`);
  const encoded = whole ?? (contiguous ? chunks.map((part) => part.value).join('') : '');
  if (!encoded) return true;
  try {
    const raw = encoded.startsWith('base64-')
      ? atob(encoded.slice(7).replaceAll('-', '+').replaceAll('_', '/'))
      : encoded;
    const session: unknown = JSON.parse(raw);
    if (!session || typeof session !== 'object' || !('expires_at' in session)) return true;
    const expiresAt = session.expires_at;
    // auth-js renova com margem de 90 s. Antecipar mais que essa margem evita
    // rotação em um Server Component, que não pode persistir Set-Cookie.
    return typeof expiresAt !== 'number' || expiresAt * 1000 - now < 120_000;
  } catch {
    return true;
  }
}
