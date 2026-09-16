// @vitest-environment happy-dom
/** SDK SSR instalado contra Auth sintético em loopback; sem SDK no browser. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Component, type PropsWithChildren } from 'react';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { startSupabaseAuthFixture } from '@/lib/test/supabase-auth-fixture';
import {
  sessionNeedsRefresh,
  supabaseAuthCookieName,
  SUPABASE_SESSION_SELECTOR_COOKIE,
} from '@/lib/auth/supabase-session-cookie';

const seams = vi.hoisted(() => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: '',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key',
  },
  jar: new Map<string, string>(),
  cookieWrites: [] as Array<{ name: string; options: { httpOnly?: boolean } }>,
  markInviteAccepted: vi.fn(),
  readProfile: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@/lib/env', () => ({ env: seams.env }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => {
      const value = seams.jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll: () => [...seams.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options: { httpOnly?: boolean; maxAge?: number }) => {
      seams.cookieWrites.push({ name, options });
      if (options.maxAge === 0) seams.jar.delete(name);
      else seams.jar.set(name, value);
    },
  }),
}));
vi.mock('next/navigation', () => ({ redirect: seams.redirect }));
vi.mock('@/contexts/identity/internal/members', () => ({
  markInviteAccepted: seams.markInviteAccepted,
}));
vi.mock('@/lib/auth/tenant-context', () => ({
  readAuthoritativeProfile: seams.readProfile,
}));
vi.mock('@/lib/auth/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  assertInviteAcceptAllowed: async () => ({ ok: true }),
}));
vi.mock('@/lib/observability/logger', () => ({ logger: { warn: vi.fn() } }));

import ConvitePage from './page';
import { acceptInviteAction } from './actions';
import { GET as confirm } from '../auth/confirm/route';
import { GET as refresh } from '../auth/session-refresh/route';

class RedirectSignal extends Error {
  constructor(readonly destination: string) {
    super('Synthetic Next redirect');
  }
}
class RedirectBoundary extends Component<PropsWithChildren, { destination: string | null }> {
  override state = { destination: null };
  static getDerivedStateFromError(error: unknown) {
    if (!(error instanceof RedirectSignal)) throw error;
    return { destination: error.destination };
  }
  override render() {
    return this.state.destination ? <p>{this.state.destination}</p> : this.props.children;
  }
}

let fixture: Awaited<ReturnType<typeof startSupabaseAuthFixture>>;

beforeAll(async () => {
  vi.stubGlobal('BroadcastChannel', undefined);
  fixture = await startSupabaseAuthFixture();
  seams.env.NEXT_PUBLIC_SUPABASE_URL = fixture.origin;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', fixture.origin);
});
beforeEach(() => {
  vi.clearAllMocks();
  seams.jar.clear();
  seams.cookieWrites.length = 0;
  seams.readProfile.mockResolvedValue({
    ativo: true,
    deletedAt: null,
    inviteAcceptedAt: null,
  });
  seams.redirect.mockImplementation((destination: string) => {
    throw new RedirectSignal(destination);
  });
});
afterEach(() => cleanup());
afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await fixture.close();
});

async function confirmInvite(token = 'valid-invite', destination = '/convite') {
  await expect(
    confirm(
      new NextRequest(
        `${fixture.origin}/auth/confirm?token_hash=${token}&type=invite&next=/convite`,
      ),
    ),
  ).rejects.toMatchObject({ destination });
}

function expireStoredSession(): void {
  const name = supabaseAuthCookieName(
    fixture.origin,
    seams.jar.get(SUPABASE_SESSION_SELECTOR_COOKIE),
  );
  if (!name) throw new Error('Expected a selected SSR session generation');
  const value = seams.jar.get(name);
  if (!value?.startsWith('base64-')) throw new Error('Expected a single SSR session cookie');
  const session = JSON.parse(Buffer.from(value.slice(7), 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
  session.expires_at = Math.floor(Date.now() / 1000) - 1;
  seams.jar.set(name, `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`);
}

describe('sessão Supabase server-only', () => {
  it('confirma link, grava todos os fragmentos HttpOnly e aceita o convite pelo formulário real', async () => {
    await confirmInvite();
    expect(seams.cookieWrites.length).toBeGreaterThan(0);
    expect(seams.cookieWrites.every((write) => write.options.httpOnly === true)).toBe(true);

    const updatesBefore = fixture.passwordUpdates;
    render(
      <RedirectBoundary>
        {await ConvitePage({ searchParams: Promise.resolve({}) })}
      </RedirectBoundary>,
      { onCaughtError: () => {} },
    );
    expect(screen.getByText(/Clínica sintética/)).toBeTruthy();
    const password = screen.getByLabelText('Senha');
    fireEvent.change(password, { target: { value: 'Synthetic123!' } });
    fireEvent.change(screen.getByLabelText('Confirmar senha'), {
      target: { value: 'Different123!' },
    });
    const form = screen.getByRole('button', { name: 'Criar senha e entrar' }).closest('form');
    if (!form) throw new Error('Invite form is missing');
    fireEvent.submit(form);
    await screen.findByText('As senhas não conferem.');
    expect(fixture.passwordUpdates).toBe(updatesBefore);

    fireEvent.change(screen.getByLabelText('Confirmar senha'), {
      target: { value: 'Synthetic123!' },
    });
    fireEvent.submit(form);
    await screen.findByText('/dashboard');
    expect(fixture.passwordUpdates).toBe(updatesBefore + 1);
    expect(seams.markInviteAccepted).toHaveBeenCalledWith(fixture.user.id);
    expect(fixture.requests).toContain('POST /auth/v1/logout?scope=others');
    expect(fixture.requests).toContain('POST /auth/v1/token?grant_type=refresh_token');
    expect(seams.cookieWrites.every((write) => write.options.httpOnly === true)).toBe(true);
  });

  it.each([
    ['invalid-invite', 'invalid_token'],
    ['expired-invite', 'expired'],
  ])('rejeita %s na confirmação, na página e na action direta', async (token, reason) => {
    await confirmInvite(token, `/auth/auth-error?reason=${reason}`);
    render(await ConvitePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText('Convite inválido ou expirado')).toBeTruthy();
    expect(screen.queryByLabelText('Senha')).toBeNull();
    const form = new FormData();
    form.set('password', 'Synthetic123!');
    form.set('confirm', 'Synthetic123!');
    expect(await acceptInviteAction({ error: null }, form)).toEqual({
      error: 'Sessão inválida. Abra o link do convite novamente.',
    });
    expect(seams.markInviteAccepted).not.toHaveBeenCalled();
  });

  it('recusa conta já ativa antes de alterar a senha', async () => {
    await confirmInvite();
    seams.readProfile.mockResolvedValue({
      ativo: true,
      deletedAt: null,
      inviteAcceptedAt: new Date(),
    });
    render(await ConvitePage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByLabelText('Senha')).toBeNull();
    const form = new FormData();
    form.set('password', 'Synthetic123!');
    form.set('confirm', 'Synthetic123!');
    expect(await acceptInviteAction({ error: null }, form)).toEqual({
      error: 'Convite inválido ou já aceito. Peça um novo ao administrador da clínica.',
    });
    expect(seams.markInviteAccepted).not.toHaveBeenCalled();
  });

  it('OTP inválido desvincula a identidade anterior sem selecionar uma sessão nova', async () => {
    await confirmInvite();
    const previousGeneration = seams.jar.get(SUPABASE_SESSION_SELECTOR_COOKIE);
    expect(previousGeneration).toMatch(/^[a-f0-9]{32}$/);
    await confirmInvite('invalid-invite', '/auth/auth-error?reason=invalid_token');
    expect(seams.jar.has(SUPABASE_SESSION_SELECTOR_COOKIE)).toBe(false);
    render(await ConvitePage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByLabelText('Senha')).toBeNull();
  });

  it('encaminha token_hash legado ao verificador server-side', async () => {
    await expect(
      ConvitePage({ searchParams: Promise.resolve({ token_hash: 'abc', type: 'invite' }) }),
    ).rejects.toMatchObject({
      destination: '/auth/confirm?token_hash=abc&type=invite&next=%2Fconvite',
    });
  });

  it('renova access/refresh expirados no Route Handler antes do RSC e mantém a sessão na recarga', async () => {
    await confirmInvite();
    expireStoredSession();
    const name = supabaseAuthCookieName(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      seams.jar.get(SUPABASE_SESSION_SELECTOR_COOKIE),
    );
    expect(name).toMatch(/^sb-127-auth-token-v2-[a-f0-9]{32}$/);
    if (!name) throw new Error('Expected a selected SSR session generation');
    expect(
      sessionNeedsRefresh(
        [...seams.jar].map(([cookieName, value]) => ({ name: cookieName, value })),
        name,
      ),
    ).toBe(true);
    await expect(
      refresh(new NextRequest(`${fixture.origin}/auth/session-refresh?next=/convite`)),
    ).rejects.toMatchObject({
      destination: '/convite',
    });
    expect(fixture.requests).toContain('POST /auth/v1/token?grant_type=refresh_token');
    expect(seams.cookieWrites.every((write) => write.options.httpOnly === true)).toBe(true);
    render(await ConvitePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByLabelText('Senha')).toBeTruthy();
  });

  it('refresh sem sessão retorna ao login e rejeita retorno externo', async () => {
    await expect(
      refresh(new NextRequest(`${fixture.origin}/auth/session-refresh?next=https://evil.invalid/`)),
    ).rejects.toMatchObject({ destination: '/login' });
  });

  it.each(['https://evil.invalid/', '//evil.invalid/', '/\\evil.invalid/'])(
    'refresh autenticado restringe destino externo %s',
    async (next) => {
      await confirmInvite();
      const url = new URL(`${fixture.origin}/auth/session-refresh`);
      url.searchParams.set('next', next);
      await expect(refresh(new NextRequest(url))).rejects.toMatchObject({
        destination: '/dashboard',
      });
    },
  );
});
