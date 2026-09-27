import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('atributos comuns do cookie Supabase', () => {
  it.each([
    ['production', true],
    ['development', false],
    ['test', false],
  ])('no ambiente %s usa Secure=%s, HttpOnly e SameSite', async (mode, secure) => {
    vi.stubEnv('NODE_ENV', mode);
    vi.resetModules();
    const { SUPABASE_SESSION_COOKIE_OPTIONS } = await import('./supabase-session-cookie');
    expect(SUPABASE_SESSION_COOKIE_OPTIONS).toEqual({ httpOnly: true, sameSite: 'lax', secure });
  });

  it('separa o nome legado da geração server-only selecionada', async () => {
    const { supabaseAuthCookieName, supabaseAuthCookiePrefix, supabaseLegacyAuthCookieName } =
      await import('./supabase-session-cookie');
    const url = 'https://project.supabase.co';
    const generation = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    expect(supabaseLegacyAuthCookieName(url)).toBe('sb-project-auth-token');
    expect(supabaseAuthCookiePrefix(url)).toBe('sb-project-auth-token-v2');
    expect(supabaseAuthCookieName(url, generation)).toBe(`sb-project-auth-token-v2-${generation}`);
    expect(supabaseAuthCookieName(url, 'inválida')).toBeNull();
  });

  it('gera seletores imprevisíveis no formato aceito', async () => {
    const { createSupabaseSessionGeneration, isSupabaseSessionGeneration } =
      await import('./supabase-session-cookie');
    const first = createSupabaseSessionGeneration();
    const second = createSupabaseSessionGeneration();

    expect(isSupabaseSessionGeneration(first)).toBe(true);
    expect(isSupabaseSessionGeneration(second)).toBe(true);
    expect(second).not.toBe(first);
  });
});
