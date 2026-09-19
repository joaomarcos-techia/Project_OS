/** Contrato do adapter server-only e dos atributos do cookie Supabase. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type CookieItem = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

type CapturedOptions = {
  cookies: {
    getAll(): Array<{ name: string; value: string }>;
    setAll(items: CookieItem[]): void;
  };
  cookieOptions?: { name?: string };
};

const GENERATION = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const seams = vi.hoisted(() => ({
  captured: null as CapturedOptions | null,
  jar: new Map<string, string>(),
  set: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-test',
  },
}));
vi.mock('next/headers', () => ({ cookies: seams.cookies }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn((_url: string, _key: string, options: CapturedOptions) => {
    seams.captured = options;
    return { auth: {} };
  }),
}));

import { clearSupabaseSessionSelector, createServerClient, hardenCookie } from './supabase-server';
import { SUPABASE_SESSION_SELECTOR_COOKIE } from './supabase-session-cookie';

function captured(): CapturedOptions {
  if (!seams.captured) throw new Error('createServerClient não capturado');
  return seams.captured;
}

beforeEach(() => {
  vi.clearAllMocks();
  seams.captured = null;
  seams.jar.clear();
  seams.jar.set(SUPABASE_SESSION_SELECTOR_COOKIE, GENERATION);
  seams.set.mockImplementation((name: string, value: string, options: { maxAge?: number }) => {
    if (options.maxAge === 0) seams.jar.delete(name);
    else seams.jar.set(name, value);
  });
  seams.cookies.mockResolvedValue({
    get: (name: string) => {
      const value = seams.jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll: () => [...seams.jar].map(([name, value]) => ({ name, value })),
    set: seams.set,
  });
});

describe('hardenCookie', () => {
  it('sobrescreve pedidos inseguros de cookie e força HttpOnly e SameSite=Lax', () => {
    const hardened = hardenCookie({ httpOnly: false, sameSite: 'none' as const });

    expect(hardened.httpOnly).toBe(true);
    expect(hardened.sameSite).toBe('lax');
  });

  it('preserva tudo o que é política de sessão do provedor', () => {
    const hardened = hardenCookie({ path: '/', maxAge: 3600, domain: 'exemplo.test' });

    expect(hardened).toMatchObject({ path: '/', maxAge: 3600, domain: 'exemplo.test' });
  });

  it('aceita opções ausentes sem produzir undefined', () => {
    expect(hardenCookie(undefined)).toMatchObject({ httpOnly: true, sameSite: 'lax' });
  });

  it('secure acompanha o ambiente, para não quebrar login em http://localhost', () => {
    expect(hardenCookie({}).secure).toBe(false);
  });
});

describe('adapter de sessão por geração', () => {
  it('signup rejeita sessão inesperada antes de qualquer fragmento/seletor, preservando a anterior', async () => {
    await createServerClient({
      newSession: true,
      cookieWrites: 'required',
      sessionWrites: 'reject',
    });
    const name = captured().cookieOptions?.name;
    if (!name) throw new Error('cookie name missing');
    expect(() =>
      captured().cookies.setAll([
        { name: `${name}-code-verifier`, value: 'verifier' },
        { name: `${name}.0`, value: 'unexpected-fragment' },
        { name: `${name}.1`, value: 'unexpected-fragment' },
      ]),
    ).toThrow('[auth/supabase-server] Unexpected signup session');
    expect(seams.set).not.toHaveBeenCalled();
    expect(seams.jar.get(SUPABASE_SESSION_SELECTOR_COOKIE)).toBe(GENERATION);
    captured().cookies.setAll([{ name: `${name}-code-verifier`, value: 'verifier' }]);
    expect(seams.jar.get(SUPABASE_SESSION_SELECTOR_COOKIE)).toBe(GENERATION);
  });
  it('lê e escreve apenas o nome apontado pelo seletor atual', async () => {
    await createServerClient({ cookieWrites: 'required' });
    const expected = `sb-project-auth-token-v2-${GENERATION}`;

    expect(captured().cookieOptions?.name).toBe(expected);
    captured().cookies.setAll([{ name: expected, value: 'session', options: {} }]);
    expect(seams.set).toHaveBeenCalledWith(
      expected,
      'session',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
    expect(seams.set).not.toHaveBeenCalledWith(
      SUPABASE_SESSION_SELECTOR_COOKIE,
      expect.anything(),
      expect.anything(),
    );
  });

  it('uma autenticação nova cria nome próprio e só então troca o seletor', async () => {
    await createServerClient({ cookieWrites: 'required', newSession: true });
    const name = captured().cookieOptions?.name;
    expect(name).toMatch(/^sb-project-auth-token-v2-[a-f0-9]{32}$/);

    captured().cookies.setAll([{ name: name ?? '', value: 'new-session', options: {} }]);
    const generation = name?.slice('sb-project-auth-token-v2-'.length);
    expect(seams.set.mock.calls.at(-1)).toEqual([
      SUPABASE_SESSION_SELECTOR_COOKIE,
      generation,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    ]);
  });

  it('propaga falha de escrita no contexto required', async () => {
    await createServerClient({ cookieWrites: 'required' });
    seams.set.mockImplementation(() => {
      throw new Error('headers committed');
    });

    expect(() =>
      captured().cookies.setAll([
        { name: `sb-project-auth-token-v2-${GENERATION}`, value: 'session' },
      ]),
    ).toThrow('headers committed');
  });

  it('tolera a mesma falha apenas no contexto best-effort de Server Component', async () => {
    await createServerClient();
    seams.set.mockImplementation(() => {
      throw new Error('read-only response');
    });

    expect(() =>
      captured().cookies.setAll([
        { name: `sb-project-auth-token-v2-${GENERATION}`, value: 'session' },
      ]),
    ).not.toThrow();
  });

  it('limpa o seletor explicitamente sem copiar a sessão', async () => {
    await clearSupabaseSessionSelector();

    expect(seams.set).toHaveBeenCalledWith(
      SUPABASE_SESSION_SELECTOR_COOKIE,
      '',
      expect.objectContaining({ httpOnly: true, maxAge: 0, path: '/' }),
    );
  });

  it('refresh antigo aplicado depois de login novo não volta a selecionar a geração anterior', async () => {
    await createServerClient({ cookieWrites: 'required' });
    const oldAdapter = captured();
    const oldName = oldAdapter.cookieOptions?.name;
    if (!oldName) throw new Error('Nome da geração antiga ausente');

    await createServerClient({ cookieWrites: 'required', newSession: true });
    const newAdapter = captured();
    const newName = newAdapter.cookieOptions?.name;
    if (!newName) throw new Error('Nome da geração nova ausente');
    newAdapter.cookies.setAll([{ name: newName, value: 'session-B' }]);
    const selectedAfterLogin = seams.jar.get(SUPABASE_SESSION_SELECTOR_COOKIE);

    oldAdapter.cookies.setAll([{ name: oldName, value: 'late-refresh-A' }]);

    expect(seams.jar.get(SUPABASE_SESSION_SELECTOR_COOKIE)).toBe(selectedAfterLogin);
    expect(seams.jar.get(newName)).toBe('session-B');
    await createServerClient({ cookieWrites: 'required' });
    expect(captured().cookieOptions?.name).toBe(newName);
  });

  it('refresh antigo aplicado depois da limpeza não ressuscita uma sessão ativa', async () => {
    await createServerClient({ cookieWrites: 'required' });
    const oldAdapter = captured();
    const oldName = oldAdapter.cookieOptions?.name;
    if (!oldName) throw new Error('Nome da geração antiga ausente');

    await clearSupabaseSessionSelector();
    oldAdapter.cookies.setAll([{ name: oldName, value: 'late-refresh-A' }]);

    expect(seams.jar.has(SUPABASE_SESSION_SELECTOR_COOKIE)).toBe(false);
    await createServerClient({ cookieWrites: 'required' });
    expect(captured().cookieOptions?.name).not.toBe(oldName);
  });
});
