// @vitest-environment happy-dom
import type { ComponentProps } from 'react';

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireUser, notFound } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/auth/tenant-context', () => ({ requireUser }));
vi.mock('next/navigation', () => ({ notFound }));
vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));

import { SettingsCategoryPage } from './settings-category';

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({
    permissions: ['manage:availability', 'manage:procedures', 'manage:settings'],
    isSuperAdmin: false,
    aal: 'aal1',
  });
});

describe('SettingsCategoryPage', () => {
  it('abre a categoria com um card por destino acessível', async () => {
    render(await SettingsCategoryPage({ id: 'agenda' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Configurações' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Agenda' })).toBeTruthy();
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/configuracoes/horarios',
      '/configuracoes/procedimentos',
      '/configuracoes/recursos',
    ]);
    expect(
      screen.getByText('Catálogo com código, preço e duração — base da agenda e do faturamento.'),
    ).toBeTruthy();
  });

  /** O gate real vive na rota de destino; aqui o filtro é de anúncio. */
  it('omite o card do destino que a pessoa não pode abrir', async () => {
    requireUser.mockResolvedValue({
      permissions: ['manage:availability'],
      isSuperAdmin: false,
      aal: 'aal1',
    });

    render(await SettingsCategoryPage({ id: 'agenda' }));

    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/configuracoes/horarios',
      '/configuracoes/recursos',
    ]);
  });

  it('mostra o status real quando a categoria carrega um', async () => {
    render(
      await SettingsCategoryPage({
        id: 'canais-ia',
        statuses: { '/configuracoes/whatsapp': { tone: 'green', label: 'Conectado' } },
      }),
    );

    const whatsapp = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href') === '/configuracoes/whatsapp')!
      .closest('[class*="group"]') as HTMLElement;
    expect(within(whatsapp).getByText('Conectado')).toBeTruthy();
  });

  /**
   * Categoria sem nenhum destino visível não existe para esta pessoa — a aba
   * também não foi desenhada. 404 é a resposta honesta, não uma página vazia.
   */
  it('devolve 404 quando a categoria não tem destino visível', async () => {
    requireUser.mockResolvedValue({ permissions: [], isSuperAdmin: false, aal: 'aal1' });

    await expect(SettingsCategoryPage({ id: 'agenda' })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledOnce();
  });

  it('devolve 404 para um slug de categoria que não existe', async () => {
    await expect(SettingsCategoryPage({ id: 'inventada' })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
