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

const desktop = () => screen.getByRole('navigation', { name: 'Configurações' }).firstElementChild!;

describe('SettingsNav', () => {
  it('marca a categoria da rota atual e leva cada uma ao seu primeiro destino', () => {
    pathname.current = '/configuracoes/procedimentos';
    render(<SettingsNav groups={groups} />);

    const categorias = within(desktop().firstElementChild as HTMLElement).getAllByRole('link');
    expect(categorias.map((link) => link.textContent)).toEqual(['Clínica', 'Agenda', 'Produto']);
    expect(categorias.map((link) => link.getAttribute('href'))).toEqual([
      '/configuracoes/perfil',
      '/configuracoes/horarios',
      '/configuracoes/sugestoes',
    ]);
    expect(categorias[1]!.getAttribute('aria-current')).toBe('true');
    expect(categorias[0]!.getAttribute('aria-current')).toBeNull();
  });

  it('abre o segundo nível com o item atual marcado', () => {
    pathname.current = '/configuracoes/procedimentos';
    render(<SettingsNav groups={groups} />);

    const atual = within(desktop() as HTMLElement).getByRole('link', { name: 'Procedimentos' });
    expect(atual.getAttribute('aria-current')).toBe('page');
    expect(
      within(desktop() as HTMLElement).getByRole('link', { name: 'Salas e equipamentos' }),
    ).toBeTruthy();
  });

  /** Sub-linha com um item só é ruído: a categoria já disse onde se está. */
  it('não desenha o segundo nível quando a categoria tem um destino só', () => {
    pathname.current = '/configuracoes/perfil';
    render(<SettingsNav groups={groups} />);

    expect(
      within(desktop() as HTMLElement).queryByRole('link', { name: 'Perfil da clínica' }),
    ).toBeNull();
  });

  it('cai na primeira categoria quando a rota não pertence a nenhuma', () => {
    pathname.current = '/configuracoes';
    render(<SettingsNav groups={groups} />);

    const categorias = within(desktop().firstElementChild as HTMLElement).getAllByRole('link');
    expect(categorias[0]!.getAttribute('aria-current')).toBe('true');
  });

  it('não renderiza nada quando a pessoa não enxerga nenhuma configuração', () => {
    const { container } = render(<SettingsNav groups={[]} />);

    expect(container.innerHTML).toBe('');
  });
});
