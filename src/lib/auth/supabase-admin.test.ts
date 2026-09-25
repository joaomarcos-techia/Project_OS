import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://admin-timeout.supabase.test',
    SUPABASE_SECRET_KEY: 'synthetic-service-key',
  },
}));

function abortableFetch(): typeof fetch {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return reject(new Error('missing abort signal'));
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
}

async function configuredAdminFetch(): Promise<typeof fetch> {
  const client = { auth: { admin: {} } };
  mocks.createClient.mockReturnValue(client);
  const { createAdminClient } = await import('./supabase-admin');
  expect(createAdminClient()).toBe(client);
  const options: unknown = mocks.createClient.mock.calls[0]?.[2];
  if (!options || typeof options !== 'object') throw new Error('missing Supabase options');
  const globalOptions: unknown = Reflect.get(options, 'global');
  if (!globalOptions || typeof globalOptions !== 'object') {
    throw new Error('missing Supabase global options');
  }
  const configuredFetch: unknown = Reflect.get(globalOptions, 'fetch');
  if (typeof configuredFetch !== 'function') throw new Error('missing configured fetch');
  return (input, init) => Reflect.apply(configuredFetch, undefined, [input, init]);
}

describe('createAdminClient fetch timeout', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    mocks.createClient.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('aborta uma chamada da Admin API depois de 20 segundos', async () => {
    vi.stubGlobal('fetch', abortableFetch());
    const adminFetch = await configuredAdminFetch();
    const pending = adminFetch('https://admin-timeout.supabase.test/auth/v1/admin/users');
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    await vi.advanceTimersByTimeAsync(20_000);

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propaga o abort do chamador sem esperar o teto', async () => {
    vi.stubGlobal('fetch', abortableFetch());
    const adminFetch = await configuredAdminFetch();
    const controller = new AbortController();
    const pending = adminFetch('https://admin-timeout.supabase.test/auth/v1/admin/users', {
      signal: controller.signal,
    });
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort();

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('limpa o timer quando a resposta chega antes do teto', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const adminFetch = await configuredAdminFetch();

    await expect(
      adminFetch('https://admin-timeout.supabase.test/auth/v1/admin/users'),
    ).resolves.toMatchObject({ status: 204 });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('findAdminUserByEmail', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    mocks.createClient.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('usa o filtro indexado do GoTrue e exige igualdade exata', async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({
        users: [
          { id: 'user-1', email: 'other@example.test' },
          { id: 'user-2', email: 'Ana@Example.Test' },
        ],
      }),
    );
    vi.stubGlobal('fetch', request);
    const { findAdminUserByEmail } = await import('./supabase-admin');

    await expect(findAdminUserByEmail(' ana@example.test ')).resolves.toEqual({
      kind: 'found',
      user: { id: 'user-2', email: 'Ana@Example.Test' },
    });

    const [input, init] = request.mock.calls[0] as [URL, RequestInit];
    expect(input.pathname).toBe('/auth/v1/admin/users');
    expect(input.searchParams.get('filter')).toBe('ana@example.test');
    expect(input.searchParams.get('page')).toBe('1');
    expect(input.searchParams.get('per_page')).toBe('10');
    expect(init.headers).toMatchObject({
      apikey: 'synthetic-service-key',
      Authorization: 'Bearer synthetic-service-key',
    });
  });

  it.each([
    [
      'nenhum resultado exato',
      { users: [{ id: 'user-1', email: 'other@example.test' }] },
      'missing',
    ],
    [
      'mais de um resultado exato',
      {
        users: [
          { id: 'user-1', email: 'ana@example.test' },
          { id: 'user-2', email: 'ANA@example.test' },
        ],
      },
      'unavailable',
    ],
    ['envelope inválido', { users: 'invalid' }, 'unavailable'],
  ])('falha fechada para %s', async (_case, body, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
    const { findAdminUserByEmail } = await import('./supabase-admin');
    await expect(findAdminUserByEmail('ana@example.test')).resolves.toEqual({ kind });
  });

  it('traduz falha HTTP ou de rede em indisponibilidade', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    let authModule = await import('./supabase-admin');
    await expect(authModule.findAdminUserByEmail('ana@example.test')).resolves.toEqual({
      kind: 'unavailable',
    });

    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    authModule = await import('./supabase-admin');
    await expect(authModule.findAdminUserByEmail('ana@example.test')).resolves.toEqual({
      kind: 'unavailable',
    });
  });
});
