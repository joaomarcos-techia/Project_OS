// @vitest-environment happy-dom
import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { navigation, toggleTheme, linkStatus } = vi.hoisted(() => ({
  navigation: { pathname: '/configuracoes/pagamentos' },
  toggleTheme: vi.fn(),
  linkStatus: { pending: false },
}));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));
vi.mock('next/link', () => ({
  default: ({
    prefetch: _prefetch,
    ...props
  }: ComponentProps<'a'> & { prefetch?: boolean | null }) => <a {...props} />,
  useLinkStatus: () => linkStatus,
}));
vi.mock('@/components/shared/use-theme', () => ({
  useTheme: () => ({ theme: 'light', toggle: toggleTheme }),
}));
vi.mock('./handoff-store', () => ({ useOpenHandoffCount: () => 2 }));

import { PainelShell } from './painel-shell';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  navigation.pathname = '/configuracoes/pagamentos';
  linkStatus.pending = false;
});

function renderShell() {
  return render(
    <PainelShell userName="Maria da Silva" userRole="Gestor" settingsHref="/configuracoes/horarios">
      <h1>Pagamentos</h1>
    </PainelShell>,
  );
}

describe('shell tenant das referências HTML', () => {
  it.each(['/documentação/agenda', '/documenta%C3%A7%C3%A3o/agenda'])(
    'mantém Ajuda ativa e aponta ao endereço novo: %s',
    (pathname) => {
      navigation.pathname = pathname;
      renderShell();
      const link = screen.getByRole('link', { name: 'Ajuda' });
      expect(link.getAttribute('href')).toBe('/documentação');
      expect(link.getAttribute('aria-current')).toBe('page');
    },
  );
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
  it('a gaveta isola o conteúdo, recebe o foco e o devolve a quem a fechou', () => {
    const { container } = renderShell();
    const trigger = screen.getByRole('button', { name: 'Abrir navegação' });
    const panel = container.querySelector('.qoro-panel');
    fireEvent.click(trigger);
    expect(panel?.hasAttribute('inert')).toBe(true);
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fechar navegação' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panel?.hasAttribute('inert')).toBe(false);
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
  });
  it('a troca de rota fecha a gaveta sem puxar o foco para o botão de menu', () => {
    const shell = () => (
      <PainelShell userName="Maria" settingsHref="/configuracoes">
        <h1>Painel</h1>
      </PainelShell>
    );
    const { rerender } = render(shell());
    const trigger = screen.getByRole('button', { name: 'Abrir navegação' });
    fireEvent.click(trigger);
    navigation.pathname = '/agenda';
    rerender(shell());
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.activeElement).not.toBe(trigger);
  });
  it('mostra Fixar, tema e Sair em lista com nome, como os destinos', () => {
    renderShell();
    const foot = document.querySelector('.qoro-rail-foot');
    const labels = [...(foot?.querySelectorAll('.qoro-rail-item > .qoro-rail-label') ?? [])].map(
      (label) => label.textContent ?? '',
    );
    expect(labels).toHaveLength(3);
    expect(labels[0]).toBe('Fixar menu aberto');
    expect(labels[1]).toMatch(/^Tema /);
    expect(labels[2]).toBe('Sair');
    act(() => screen.getByRole('button', { name: 'Sair' }).focus());
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });
  it('devolve o foco ao botão de tema só quando a troca veio do teclado', () => {
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
      run(0);
      return 0;
    });
    renderShell();
    const theme = screen.getByRole('button', { name: 'Tema claro. Alternar tema' });
    fireEvent.click(theme, { detail: 1 });
    expect(document.activeElement).not.toBe(theme);
    fireEvent.click(theme);
    expect(document.activeElement).toBe(theme);
  });
  it('alterna o rótulo de fixar o menu e mostra a clínica no link de início', () => {
    render(
      <PainelShell userName="Maria" clinicName="Clínica Sol" settingsHref="/configuracoes">
        <h1>Painel</h1>
      </PainelShell>,
    );
    expect(screen.getByRole('link', { name: 'Clínica Sol — início' }).getAttribute('href')).toBe(
      '/',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fixar menu aberto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Recolher menu' }));
    expect(screen.getByRole('button', { name: 'Fixar menu aberto' })).toBeTruthy();
  });
  it('cada destino do menu mantém o nome exato, sem depender do rótulo visível', () => {
    renderShell();
    for (const name of ['Dashboard', 'Agenda', 'Caixa', 'Financeiro', 'Relatórios']) {
      expect(screen.getByRole('link', { name })).toBeTruthy();
    }
  });
  it('mostra "Equipe" no menu e anuncia o nome inteiro da tela', () => {
    renderShell();
    const link = screen.getByRole('link', { name: 'Equipe & Permissões' });
    expect(link.querySelector('.qoro-rail-label')?.textContent).toBe('Equipe');
    expect(link.getAttribute('href')).toBe('/equipe');
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

describe('sidebar: permissões, grupos e estados', () => {
  it('mostra só os módulos permitidos e esconde o grupo que ficou vazio', () => {
    render(
      <PainelShell
        userName="Recepção"
        settingsHref="/configuracoes"
        allowedModuleIds={['dashboard', 'agenda', 'pacientes', 'config', 'ajuda']}
      >
        <h1>Painel</h1>
      </PainelShell>,
    );
    for (const name of ['Dashboard', 'Agenda', 'Pacientes', 'Configurações', 'Ajuda']) {
      expect(screen.getByRole('link', { name })).toBeTruthy();
    }
    for (const name of ['Financeiro', 'Caixa', 'Consultório', 'Equipe & Permissões']) {
      expect(screen.queryByRole('link', { name })).toBeNull();
    }
    // Gestão ficou sem nenhum módulo permitido: nem o título aparece.
    expect(screen.queryByRole('group', { name: 'Gestão' })).toBeNull();
    // Sem Conversas, o contador de atendimento não aparece em lugar nenhum.
    expect(screen.queryByLabelText('2 conversas aguardando atendimento')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Abrir navegação' }).hasAttribute('aria-describedby'),
    ).toBe(false);
  });

  it('nomeia cada grupo pelo título visível, na ordem do menu', () => {
    renderShell();
    const groups = screen
      .getAllByRole('group')
      .map((group) => group.getAttribute('data-nav-group'));
    expect(groups).toEqual(['Operação', 'Clínico', 'Gestão', 'Administração']);
    const operacao = screen.getByRole('group', { name: 'Operação' });
    expect(operacao.querySelectorAll('a')).toHaveLength(3);
  });

  it('marca o item que está carregando a próxima tela', () => {
    linkStatus.pending = true;
    const { container } = renderShell();
    expect(container.querySelectorAll('.qoro-rail-nav .qoro-rail-pending').length).toBeGreaterThan(
      0,
    );
    linkStatus.pending = false;
  });

  it('não mostra indicador de carregamento quando nada está pendente', () => {
    const { container } = renderShell();
    expect(container.querySelector('.qoro-rail-pending')).toBeNull();
  });

  it('o botão Menu descreve as conversas pendentes e sai do foco com a gaveta aberta', () => {
    renderShell();
    const trigger = screen.getByRole('button', { name: 'Abrir navegação' });
    const describedBy = trigger.getAttribute('aria-describedby');
    expect(describedBy && document.getElementById(describedBy)?.textContent).toBe(
      '2 conversas aguardando atendimento',
    );
    fireEvent.click(trigger);
    expect(trigger.hasAttribute('inert')).toBe(true);
    const dialog = screen.getByRole('dialog', { name: 'Navegação' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger.hasAttribute('inert')).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Navegação' })).toBeNull();
  });
});
