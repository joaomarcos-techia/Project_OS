// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SettingsSectionNav } from './settings-section-nav';

afterEach(cleanup);

const sections = [
  { id: 'clinica', label: 'Clínica' },
  { id: 'agenda', label: 'Agenda' },
  { id: 'canais-ia', label: 'Canais e IA' },
];

describe('SettingsSectionNav', () => {
  it('é uma navegação nomeada de âncoras da própria página', () => {
    render(<SettingsSectionNav sections={sections} />);

    const nav = screen.getByRole('navigation', { name: 'Seções de configurações' });
    expect(nav).toBeTruthy();
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '#clinica',
      '#agenda',
      '#canais-ia',
    ]);
  });

  /**
   * Sem IntersectionObserver (SSR e ambiente de teste) a barra não pode ficar
   * sem estado: a primeira seção segue marcada e a navegação continua útil.
   */
  it('marca a primeira seção enquanto não há observação de rolagem', () => {
    render(<SettingsSectionNav sections={sections} />);

    const [primeiro, segundo] = screen.getAllByRole('link');
    expect(primeiro!.getAttribute('aria-current')).toBe('location');
    expect(segundo!.getAttribute('aria-current')).toBeNull();
  });

  it('oferece a mesma escolha por menu, para telas sem espaço para a trilha', () => {
    render(<SettingsSectionNav sections={sections} />);

    // O conteúdo do menu só existe depois de aberto (Radix em portal); o que a
    // tela estreita precisa garantir é o gatilho anunciando a seção atual.
    expect(screen.getByRole('button', { name: /Clínica/ })).toBeTruthy();
  });

  it('não renderiza nada quando não há seção visível para a pessoa', () => {
    const { container } = render(<SettingsSectionNav sections={[]} />);

    expect(container.innerHTML).toBe('');
  });
});
