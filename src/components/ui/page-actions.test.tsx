// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PageActions } from './page-actions';

afterEach(cleanup);

function abrirMenu() {
  const trigger = screen.getByRole('button', { name: 'Mais ações' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

// UX-012 (docs/otimização_ui_final.md): no celular, primária à vista e o resto no menu.
describe('PageActions', () => {
  it('no computador as secundárias são botões; no celular elas saem da linha', () => {
    render(
      <PageActions
        label="Ações da tela"
        secondary={[{ href: '/a', label: 'Destino A' }]}
        primary={<button type="button">Principal</button>}
      />,
    );

    const grupo = screen.getByRole('group', { name: 'Ações da tela' });
    const link = within(grupo).getByRole('link', { name: 'Destino A' });
    expect(link.getAttribute('href')).toBe('/a');
    expect(link.className).toContain('max-md:hidden');
    expect(within(grupo).getByRole('button', { name: 'Principal' })).toBeTruthy();
    // Sem destino ocasional, o menu existe só para o celular.
    expect(screen.getByRole('button', { name: 'Mais ações' }).className).toContain('md:hidden');
  });

  it('o menu repete as secundárias (só no celular) e guarda as ocasionais', async () => {
    render(
      <PageActions
        label="Ações da tela"
        secondary={[{ href: '/a', label: 'Destino A' }]}
        overflow={[{ href: '/b', label: 'Destino B' }]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Mais ações' }).className).not.toContain('md:hidden');
    abrirMenu();

    const a = await screen.findByRole('menuitem', { name: 'Destino A' });
    expect(a.getAttribute('href')).toBe('/a');
    expect(a.className).toContain('md:hidden');
    const b = screen.getByRole('menuitem', { name: 'Destino B' });
    expect(b.getAttribute('href')).toBe('/b');
    expect(b.className).not.toContain('md:hidden');
  });

  it('sem secundárias nem ocasionais, não há menu', () => {
    render(<PageActions label="Ações da tela" primary={<a href="/x">Exportar</a>} />);

    expect(screen.queryByRole('button', { name: 'Mais ações' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Exportar' })).toBeTruthy();
  });

  it('com dobra em lg, as secundárias só voltam a ser botões a partir de 1024 px', async () => {
    render(
      <PageActions
        label="Ações da tela"
        dobraAbaixoDe="lg"
        secondary={[{ href: '/a', label: 'Destino A' }]}
      />,
    );

    expect(screen.getByRole('link', { name: 'Destino A' }).className).toContain('max-lg:hidden');
    expect(screen.getByRole('button', { name: 'Mais ações' }).className).toContain('lg:hidden');
    abrirMenu();
    expect((await screen.findByRole('menuitem', { name: 'Destino A' })).className).toContain(
      'lg:hidden',
    );
  });
});
