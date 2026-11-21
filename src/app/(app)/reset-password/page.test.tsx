// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  getUser: vi.fn(),
  readGrant: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.cookieGet }) }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/auth/recovery-grant', () => ({
  RECOVERY_GRANT_COOKIE: 'qoro-recovery-grant',
  readRecoveryGrant: mocks.readGrant,
}));
vi.mock('@/lib/auth/supabase-server', () => ({
  createServerClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('./reset-password-form', () => ({
  ResetPasswordForm: ({ username }: { username?: string | null }) => (
    <form aria-label="Nova senha" data-username={username ?? ''} />
  ),
}));

import ResetPasswordPage from './page';

const userId = '11111111-1111-4111-8111-111111111111';
const grant = { kind: 'profile', userId, epoch: 4, expiresAt: Date.now() + 600_000 };

async function renderPage() {
  render(await ResetPasswordPage({ searchParams: Promise.resolve({}) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookieGet.mockReturnValue({ value: 'signed-grant' });
  mocks.readGrant.mockReturnValue(grant);
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId, email: 'ana@example.test' } } });
});
afterEach(cleanup);

describe('/reset-password', () => {
  it('com o grant e a sessão do próprio link, mostra o formulário para a conta certa', async () => {
    await renderPage();
    const form = screen.getByRole('form', { name: 'Nova senha' });
    expect(form.getAttribute('data-username')).toBe('ana@example.test');
    expect(screen.queryByText('Link inválido ou expirado')).toBeNull();
  });

  // Ciclo 9 (Preview): cookies capturados antes da troca de senha ainda carregam o grant assinado,
  // mas a troca revoga a sessão do link (logout global).
  it.each([
    ['sessão revogada', { data: { user: null } }],
    ['sessão de outra conta', { data: { user: { id: 'outra-conta', email: 'b@example.test' } } }],
  ])(
    'com o grant e %s, diz que o link não vale mais e não mostra o formulário',
    async (_l, session) => {
      mocks.getUser.mockResolvedValue(session);
      await renderPage();
      expect(screen.getByText('Link inválido ou expirado')).toBeTruthy();
      expect(screen.queryByRole('form', { name: 'Nova senha' })).toBeNull();
      expect(screen.queryByText(/Ela vale a partir de agora/u)).toBeNull();
    },
  );

  it('sem grant, não consulta a sessão e não mostra o formulário', async () => {
    mocks.readGrant.mockReturnValue(null);
    await renderPage();
    expect(screen.getByText('Link inválido ou expirado')).toBeTruthy();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
});
