// @vitest-environment happy-dom
import type { ComponentProps } from 'react';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/configuracoes/perfil',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));

import { Input } from './input';
import { NavTabs } from './nav-tabs';

afterEach(cleanup);

describe('foundation de navegação e foco', () => {
  it('mantém todas as tabs em uma faixa horizontal rolável no mobile', () => {
    render(
      <NavTabs
        tabs={[
          { label: 'Visão geral', href: '/configuracoes', exact: true },
          { label: 'Perfil', href: '/configuracoes/perfil' },
          { label: 'Integrações', href: '/configuracoes/integracoes' },
        ]}
      />,
    );

    const navigation = screen.getByRole('navigation', { name: 'Navegação da seção' });
    expect(navigation.className).toContain('overflow-x-auto');
    expect(screen.getByRole('link', { name: 'Integrações' }).className).toContain('shrink-0');
    expect(screen.getByRole('link', { name: 'Perfil' }).getAttribute('aria-current')).toBe('page');
  });

  it('expõe um anel específico para foco visível por teclado', () => {
    render(<Input aria-label="Nome" />);

    expect(screen.getByRole('textbox', { name: 'Nome' }).className).toContain(
      'focus-visible:shadow-',
    );
  });
});
