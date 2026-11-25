// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieValue = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => (cookieValue.value ? { value: cookieValue.value } : undefined),
  }),
}));

import { encodeLastAccess, lastAccessSecret } from '@/lib/auth/last-access';

import { LastAccessNotice } from './last-access-notice';

beforeEach(() => {
  vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_sintetico_para_teste_com_tamanho');
  cookieValue.value = undefined;
});

describe('R42 — LastAccessNotice', () => {
  it('sem cookie (fora do perfil TISS): não renderiza nada', async () => {
    const { container } = render(await LastAccessNotice({}));
    expect(container.innerHTML).toBe('');
  });

  it('com o aviso assinado: mostra o último acesso e as falhas', async () => {
    cookieValue.value = encodeLastAccess(
      { previousSuccessAt: '2026-11-22T13:05:00.000Z', failuresSince: 1 },
      lastAccessSecret(),
    );
    render(await LastAccessNotice({ timeZone: 'America/Sao_Paulo' }));
    expect(screen.getByRole('status').textContent).toBe(
      'Seu último acesso foi em 22/11/2026, 10:05; 1 tentativa sem sucesso desde então.',
    );
  });

  it('cookie adulterado: ignora', async () => {
    cookieValue.value = 'eyJ4IjoxfQ.assinatura-falsa';
    const { container } = render(await LastAccessNotice({}));
    expect(container.innerHTML).toBe('');
  });
});
