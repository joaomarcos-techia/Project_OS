import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seams = vi.hoisted(() => ({
  refreshSession: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  clearSelector: vi.fn(),
  createServerClient: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@/lib/auth/supabase-server', () => ({
  clearSupabaseSessionSelector: seams.clearSelector,
  createServerClient: seams.createServerClient,
}));
vi.mock('next/navigation', () => ({ redirect: seams.redirect }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  seams.refreshSession.mockResolvedValue({ data: { session: {} }, error: null });
  seams.getUser.mockResolvedValue({ data: { user: { id: 'user-id' } }, error: null });
  seams.signOut.mockResolvedValue({ error: null });
  seams.clearSelector.mockResolvedValue(undefined);
  seams.createServerClient.mockResolvedValue({
    auth: {
      refreshSession: seams.refreshSession,
      getUser: seams.getUser,
      signOut: seams.signOut,
    },
  });
  seams.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
});

describe('GET /auth/session-refresh', () => {
  it('valida a sessão antes de continuar para o path interno', async () => {
    await expect(
      GET(
        new NextRequest('https://qoro.test/auth/session-refresh?next=%2Fconsultorio%3Fdoctor%3D1'),
      ),
    ).rejects.toThrow('redirect:/consultorio?doctor=1');
    expect(seams.getUser).toHaveBeenCalledOnce();
    expect(seams.refreshSession).toHaveBeenCalledOnce();
    expect(seams.signOut).not.toHaveBeenCalled();
    expect(seams.createServerClient).toHaveBeenCalledWith({ cookieWrites: 'required' });
  });

  it.each(['https://evil.invalid/', '//evil.invalid/', '/\\evil.invalid/', '/dashboard#frag'])(
    'nunca redireciona a origem externa ou fragmento %s',
    async (next) => {
      const url = new URL('https://qoro.test/auth/session-refresh');
      url.searchParams.set('next', next);
      await expect(GET(new NextRequest(url))).rejects.toThrow('redirect:/dashboard');
    },
  );

  it('envia sessão inválida ao login sem apagar o seletor de um login posterior', async () => {
    seams.getUser.mockResolvedValue({ data: { user: null }, error: new Error('expired') });
    await expect(GET(new NextRequest('https://qoro.test/auth/session-refresh'))).rejects.toThrow(
      'redirect:/login',
    );
    expect(seams.signOut).not.toHaveBeenCalled();
    expect(seams.clearSelector).not.toHaveBeenCalled();
  });

  it('falha de rotação não consulta user com token velho nem altera o seletor', async () => {
    seams.refreshSession.mockResolvedValue({
      data: { session: null },
      error: new Error('expired'),
    });
    await expect(GET(new NextRequest('https://qoro.test/auth/session-refresh'))).rejects.toThrow(
      'redirect:/login',
    );
    expect(seams.getUser).not.toHaveBeenCalled();
    expect(seams.signOut).not.toHaveBeenCalled();
    expect(seams.clearSelector).not.toHaveBeenCalled();
  });

  it('não redireciona em loop quando a escrita do cookie rotacionado lança', async () => {
    seams.refreshSession.mockRejectedValue(new Error('headers committed'));

    const response = await GET(new NextRequest('https://qoro.test/auth/session-refresh'));

    expect(response.status).toBe(503);
    expect(await response.text()).toBe('Não foi possível renovar a sessão. Tente novamente.');
    expect(seams.getUser).not.toHaveBeenCalled();
    expect(seams.clearSelector).not.toHaveBeenCalled();
    expect(seams.redirect).not.toHaveBeenCalled();
  });

  it('responde 503 quando a validação lança, sem apagar uma sessão posterior', async () => {
    seams.getUser.mockRejectedValue(new Error('network unavailable'));

    const response = await GET(new NextRequest('https://qoro.test/auth/session-refresh'));

    expect(response.status).toBe(503);
    expect(await response.text()).toBe('Não foi possível validar a sessão. Tente novamente.');
    expect(seams.clearSelector).not.toHaveBeenCalled();
    expect(seams.redirect).not.toHaveBeenCalled();
  });
});
