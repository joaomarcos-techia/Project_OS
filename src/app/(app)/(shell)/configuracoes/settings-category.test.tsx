// @vitest-environment happy-dom
import type { ComponentProps } from 'react';

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));

import { SettingsGroupSection } from './settings-category';
import { visibleSettingsNavigation } from './settings-navigation';

afterEach(cleanup);

/** O grupo real do mapa, filtrado como o índice filtra — nada de grupo de mentira. */
function grupo(permissions: string[], id = 'agenda') {
  const encontrado = visibleSettingsNavigation(permissions, false).find((g) => g.id === id);
  if (!encontrado) throw new Error(`grupo ${id} invisível para ${permissions.join(',')}`);
  return encontrado;
}

describe('SettingsGroupSection', () => {
  it('empilha um destino por linha, com o cabeçalho do grupo dentro do cartão', () => {
    render(
      <SettingsGroupSection
        group={grupo(['manage:availability', 'manage:procedures', 'manage:settings'])}
      />,
    );

    const secao = screen.getByRole('region', { name: 'Agenda' });
    expect(within(secao).getByRole('heading', { level: 2, name: 'Agenda' })).toBeTruthy();
    expect(
      within(secao)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toEqual([
      '/configuracoes/horarios',
      '/configuracoes/procedimentos',
      '/configuracoes/recursos',
    ]);
  });

  /**
   * O gate real vive na rota de destino; aqui o filtro é de ANÚNCIO. Como não
   * há mais página de categoria, o índice é a única superfície que decide o que
   * é oferecido — e é ela que precisa não oferecer o que não abre.
   */
  it('omite o destino que a pessoa não pode abrir', () => {
    render(<SettingsGroupSection group={grupo(['manage:availability'])} />);

    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/configuracoes/horarios',
      '/configuracoes/recursos',
    ]);
  });

  it('mostra o meta da linha ao lado do destino', () => {
    render(
      <SettingsGroupSection
        group={grupo(['manage:availability', 'manage:procedures', 'manage:settings'])}
        metas={{ '/configuracoes/procedimentos': '38 ativos · 4 inativos' }}
      />,
    );

    const procedimentos = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href') === '/configuracoes/procedimentos')!
      .closest('[class*="group"]') as HTMLElement;
    expect(within(procedimentos).getByText('38 ativos · 4 inativos')).toBeTruthy();
    // Linha sem meta não ganha espaço vazio nem placeholder.
    const horarios = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href') === '/configuracoes/horarios')!
      .closest('[class*="group"]') as HTMLElement;
    expect(within(horarios).queryByText(/ativos/)).toBeNull();
  });

  it('mostra o status real da linha quando existe um', () => {
    render(
      <SettingsGroupSection
        group={grupo(['manage:settings'], 'canais-ia')}
        statuses={{ '/configuracoes/whatsapp': { tone: 'green', label: 'Conectado' } }}
      />,
    );

    const whatsapp = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href') === '/configuracoes/whatsapp')!
      .closest('[class*="group"]') as HTMLElement;
    expect(within(whatsapp).getByText('Conectado')).toBeTruthy();
  });
});
