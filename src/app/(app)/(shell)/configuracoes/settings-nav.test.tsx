// @vitest-environment happy-dom
import type { ComponentProps } from 'react';

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pathname = vi.hoisted(() => ({ current: '/configuracoes/procedimentos' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));
vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));

import { SettingsNav } from './settings-nav';

afterEach(cleanup);

const TODOS = [
  '/configuracoes/horarios',
  '/configuracoes/procedimentos',
  '/configuracoes/recursos',
  '/configuracoes/whatsapp',
  '/configuracoes/agente',
  '/equipe',
  '/financeiro',
  '/configuracoes/assinatura',
  '/configuracoes/lgpd',
  '/configuracoes/auditoria',
  '/account/security',
  '/configuracoes/sugestoes',
];

/** A trilha de abas do desktop; o menu de tela estreita é o irmão seguinte. */
const abas = () =>
  screen.getByRole('navigation', { name: 'Configurações' }).firstElementChild as HTMLElement;

describe('SettingsNav', () => {
  it('desenha uma aba por categoria, apontando para a rota da categoria', () => {
    pathname.current = '/configuracoes/agenda';
    render(<SettingsNav visibleHrefs={TODOS} />);

    const links = within(abas()).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual([
      'Agenda',
      'Canais e IA',
      'Gestão',
      'Conformidade e segurança',
      'Produto',
    ]);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/configuracoes/agenda',
      '/configuracoes/canais-ia',
      '/configuracoes/gestao',
      '/configuracoes/seguranca',
      '/configuracoes/produto',
    ]);
  });

  /**
   * Estar dentro de uma configuração não pode apagar a aba: quem abre Horários
   * continua em Agenda, e é assim que se volta para as irmãs dela.
   */
  it('mantém a aba da categoria marcada dentro de cada destino', () => {
    pathname.current = '/configuracoes/procedimentos';
    render(<SettingsNav visibleHrefs={TODOS} />);

    const marcadas = within(abas())
      .getAllByRole('link')
      .filter((a) => a.getAttribute('aria-current') === 'page');
    expect(marcadas.map((a) => a.textContent)).toEqual(['Agenda']);
  });

  it('some com a categoria inteira quando nenhum destino dela é visível', () => {
    pathname.current = '/configuracoes/sugestoes';
    render(<SettingsNav visibleHrefs={['/account/security', '/configuracoes/sugestoes']} />);

    expect(
      within(abas())
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Conformidade e segurança', 'Produto']);
  });

  /**
   * `/configuracoes/perfil` chega pelo menu do rodapé e não pertence a categoria
   * nenhuma. Marcar a primeira aba ali diria ao operador que ele está num lugar
   * onde não está.
   */
  it('não marca aba nenhuma quando a rota fica fora das categorias', () => {
    pathname.current = '/configuracoes/perfil';
    render(<SettingsNav visibleHrefs={TODOS} />);

    expect(
      within(abas())
        .getAllByRole('link')
        .filter((a) => a.getAttribute('aria-current') === 'page'),
    ).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Configurações/u })).toBeTruthy();
  });

  it('anuncia a categoria aberta no gatilho da tela estreita', () => {
    pathname.current = '/configuracoes/whatsapp';
    render(<SettingsNav visibleHrefs={TODOS} />);

    expect(screen.getByRole('button', { name: /Canais e IA/u })).toBeTruthy();
  });

  it('não renderiza nada quando a pessoa não enxerga nenhuma configuração', () => {
    const { container } = render(<SettingsNav visibleHrefs={[]} />);

    expect(container.innerHTML).toBe('');
  });
});
