// @vitest-environment happy-dom
import type { ComponentProps } from 'react';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));

import { SideNavLink } from './shell-chrome';

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
