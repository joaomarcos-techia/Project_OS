// @vitest-environment happy-dom
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { navigation, toggleTheme } = vi.hoisted(() => ({
  navigation: { pathname: '/configuracoes/pagamentos' },
  toggleTheme: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));
vi.mock('next/link', () => ({
  default: ({
    prefetch: _prefetch,
    ...props
  }: ComponentProps<'a'> & { prefetch?: boolean | null }) => <a {...props} />,
}));
vi.mock('@/components/shared/use-theme', () => ({
  useTheme: () => ({ theme: 'light', toggle: toggleTheme }),
}));
vi.mock('./handoff-store', () => ({ useOpenHandoffCount: () => 2 }));

import { PainelShell } from './painel-shell';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderShell() {
  return render(
    <PainelShell userName="Maria da Silva" userRole="Gestor" settingsHref="/configuracoes/horarios">
      <h1>Pagamentos</h1>
    </PainelShell>,
  );
}

describe('shell tenant das referências HTML', () => {
  it('mantém Configurações ativo em todas as categorias e preserva o destino autorizado', () => {
    renderShell();
    const link = screen.getByRole('link', { name: 'Configurações' });
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(link.getAttribute('href')).toBe('/configuracoes/horarios');
    expect(screen.queryByRole('link', { name: 'Documentação' })).toBeNull();
  });
  it('oferece tema e logout POST diretamente no rodapé', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Tema claro. Alternar tema' }));
    expect(toggleTheme).toHaveBeenCalledOnce();
    const logout = screen.getByRole('button', { name: 'Sair' });
    const form = document.getElementById(logout.getAttribute('form') ?? '');
    expect(form?.getAttribute('action')).toBe('/logout');
    expect(form?.getAttribute('method')).toBe('post');
  });
  it('fecha a navegação por Escape e pelo controle explícito', () => {
    renderShell();
    const trigger = screen.getByRole('button', { name: 'Abrir navegação' });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar navegação' }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
  it('isola a aparência e preserva acesso ao conteúdo e contagem de handoff', () => {
    const { container } = renderShell();
    expect(container.querySelector('[data-qoro-shell="tenant"]')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Pular para o conteúdo' }).getAttribute('href')).toBe(
      '#qoro-main',
    );
    expect(screen.getByRole('main').id).toBe('qoro-main');
    expect(screen.getByLabelText('2 conversas aguardando atendimento')).toBeTruthy();
    expect(screen.getByText('MS')).toBeTruthy();
  });
});
