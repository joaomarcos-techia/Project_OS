// @vitest-environment happy-dom
import type { ComponentProps } from 'react';

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pathname = vi.hoisted(() => ({ current: '/configuracoes/procedimentos' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));
vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));

import { SettingsNav } from './settings-nav';
import type { SettingsNavGroup } from './settings-navigation';

afterEach(cleanup);

const groups: SettingsNavGroup[] = [
  { label: 'Clínica', items: [{ label: 'Perfil da clínica', href: '/configuracoes/perfil' }] },
  {
    label: 'Agenda',
    items: [
      { label: 'Horários', href: '/configuracoes/horarios' },
      { label: 'Procedimentos', href: '/configuracoes/procedimentos' },
      { label: 'Salas e equipamentos', href: '/configuracoes/recursos' },
    ],
  },
  { label: 'Produto', items: [{ label: 'Sugestões', href: '/configuracoes/sugestoes' }] },
];

/** A grade desktop; o menu de tela estreita é o irmão seguinte. */
const directory = () =>
  screen.getByRole('navigation', { name: 'Configurações' }).firstElementChild as HTMLElement;

describe('SettingsNav', () => {
  /**
   * O ponto da barra. Uma versão anterior mostrava só as categorias e revelava
   * os itens de uma por vez — na página inicial da seção isso significava
   * NENHUM destino visível, porque Clínica tem um item só.
   */
  it('mostra todos os destinos o tempo todo, na ordem do mapa', () => {
    pathname.current = '/configuracoes/perfil';
    render(<SettingsNav groups={groups} />);

    expect(
      within(directory())
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toEqual([
      '/configuracoes/perfil',
      '/configuracoes/horarios',
      '/configuracoes/procedimentos',
      '/configuracoes/recursos',
      '/configuracoes/sugestoes',
    ]);
  });

  it('agrupa por categoria e dá o nome do grupo à lista', () => {
    pathname.current = '/configuracoes/perfil';
    render(<SettingsNav groups={groups} />);

    const agenda = within(directory()).getByRole('list', { name: 'Agenda' });
    expect(within(agenda).getAllByRole('link')).toHaveLength(3);
    // Rótulo de grupo não é heading: a barra vem antes do <h1> da página.
    expect(within(directory()).queryAllByRole('heading')).toHaveLength(0);
  });

  it('marca só o destino da rota atual', () => {
    pathname.current = '/configuracoes/procedimentos';
    render(<SettingsNav groups={groups} />);

    const links = within(directory()).getAllByRole('link');
    const marcados = links.filter((a) => a.getAttribute('aria-current') === 'page');
    expect(marcados.map((a) => a.textContent)).toEqual(['Procedimentos']);
  });

  it('anuncia a configuração aberta no gatilho da tela estreita', () => {
    pathname.current = '/configuracoes/recursos';
    render(<SettingsNav groups={groups} />);

    expect(screen.getByRole('button', { name: /Salas e equipamentos/u }).textContent).toContain(
      'Salas e equipamentos',
    );
  });

  it('não renderiza nada quando a pessoa não enxerga nenhuma configuração', () => {
    const { container } = render(<SettingsNav groups={[]} />);

    expect(container.innerHTML).toBe('');
  });
});
