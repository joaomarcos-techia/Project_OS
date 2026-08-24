// @vitest-environment happy-dom
import type { ComponentProps } from 'react';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));

import { ShellSidebar, SidebarUserMenu, SideNavLink } from './shell-chrome';

afterEach(cleanup);

const icon = <svg />;

describe('estado ativo da navegação lateral', () => {
  it('marca o item da página corrente para leitor de tela', () => {
    render(<SideNavLink href="/pacientes" active icon={icon} label="Pacientes" />);
    expect(screen.getByRole('link').getAttribute('aria-current')).toBe('page');
  });

  it('não distingue o ativo só por cor — usa peso junto', () => {
    // 1.4.1: cor sozinha nao pode carregar a informacao. O ativo perdeu o fundo
    // azul para seguir a referencia, entao o peso passou a ser o segundo sinal.
    render(<SideNavLink href="/pacientes" active icon={icon} label="Pacientes" />);
    expect(screen.getByRole('link').className).toContain('font-medium');
  });

  it('não pinta fundo no ativo: a referência distingue por contraste', () => {
    render(<SideNavLink href="/pacientes" active icon={icon} label="Pacientes" />);
    expect(screen.getByRole('link').className).not.toContain('--primary-soft');
  });

  it('reserva o fundo para o hover, que é transitório', () => {
    render(<SideNavLink href="/agenda" active={false} icon={icon} label="Agenda" />);
    const cls = screen.getByRole('link').className;
    expect(cls).toContain('hover:bg-surface-hover');
    expect(cls).toContain('text-fg-muted');
  });
});

describe('ancoragem do chrome da sidebar', () => {
  it('não rola a barra inteira: o wordmark e o rodapé ficam fixos', () => {
    // Antes o <aside> tinha overflow-y-auto e levava wordmark e bloco do usuario
    // embora junto com a lista. O scroll agora pertence so ao <nav>.
    const { container } = render(
      <ShellSidebar open={false}>
        <span>conteudo</span>
      </ShellSidebar>,
    );
    const aside = container.querySelector('aside');
    expect(aside?.className).toContain('overflow-hidden');
    expect(aside?.className).not.toContain('overflow-y-auto');
  });
});

describe('menu do usuário no rodapé', () => {
  const base = {
    userName: 'Olívia Owner',
    userRole: 'Dono(a)',
    initials: 'OO',
    theme: 'light' as const,
    onToggleTheme: () => {},
    logoutFormId: 'painel-logout',
  };

  it('mostra nome e cargo no gatilho, sem exigir abrir o menu', () => {
    render(<SidebarUserMenu {...base} />);
    expect(screen.getByRole('button', { name: /Olívia Owner/ })).toBeTruthy();
    expect(screen.getByText('Dono(a)')).toBeTruthy();
  });

  it('não deixa tema nem Sair soltos no rodapé', () => {
    // O conteudo do menu so existe depois de abrir: se aparecesse aqui, seriam
    // linhas soltas de novo, que e exatamente o que a mudanca removeu.
    render(<SidebarUserMenu {...base} />);
    expect(screen.queryByText('Tema claro')).toBeNull();
    expect(screen.queryByText('Sair')).toBeNull();
  });

  /**
   * O Perfil da clínica só existe no menu para quem tem `manage:settings` — o
   * layout do shell decide isso e simplesmente não passa o destino.
   */
  it('só oferece o perfil da clínica quando o shell informa o destino', async () => {
    const abrir = () => {
      const gatilho = screen.getByRole('button', { name: /Olívia Owner/ });
      gatilho.focus();
      fireEvent.keyDown(gatilho, { key: 'Enter' });
    };

    const { unmount } = render(<SidebarUserMenu {...base} />);
    abrir();
    expect(await screen.findByRole('menuitem', { name: 'Sair' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Perfil da clínica' })).toBeNull();
    unmount();

    render(<SidebarUserMenu {...base} clinicSettingsHref="/configuracoes/perfil" />);
    abrir();
    expect(
      (await screen.findByRole('menuitem', { name: 'Perfil da clínica' })).getAttribute('href'),
    ).toBe('/configuracoes/perfil');
  });
});
