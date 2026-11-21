// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DataTable } from './data-table';
import { LinkSegmented } from './link-segmented';
import { PageHeader } from './page-header';

afterEach(cleanup);

describe('PageHeader — barra superior e faixa de título do app v5', () => {
  it('sem as opções novas segue com o título como único h1 da faixa', () => {
    const { container } = render(<PageHeader title="Pacientes" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Pacientes' })).toBeTruthy();
    expect(container.querySelector('[data-slot="page-header-screen"]')).toBeNull();
    expect(container.querySelector('[data-slot="page-header-headline"]')).toBeNull();
  });

  it('com headline, o nome da tela continua sendo o h1 e só muda de lugar', () => {
    const { container } = render(<PageHeader title="Agenda" headline="Novembro de 2026" />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Agenda' });
    expect(heading.getAttribute('data-slot')).toBe('page-header-screen');
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(container.querySelector('[data-slot="page-header-headline"]')?.textContent).toBe(
      'Novembro de 2026',
    );
  });

  it('coloca busca, controles e o bloco de destaque nos próprios lugares', () => {
    const { container } = render(
      <PageHeader
        title="Maria"
        search={<input aria-label="Buscar" />}
        controls={<button type="button">Filtrar</button>}
        leading={<span>MS</span>}
        titleAside={<span>Cadastro ativo</span>}
      />,
    );
    const header = container.querySelector('[data-slot="page-header"]');
    expect(header?.getAttribute('data-hero')).toBe('true');
    expect(
      within(container.querySelector('[data-slot="page-header-search"]') as HTMLElement).getByRole(
        'textbox',
      ),
    ).toBeTruthy();
    expect(container.querySelector('[data-slot="page-header-title-row"]')?.textContent).toContain(
      'Cadastro ativo',
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Maria');
  });
});

describe('LinkSegmented', () => {
  const items = [
    { label: 'Ativos', href: '/x', active: true },
    { label: 'Removidos', href: '/x?r=1', active: false },
  ];

  it('marca só a opção ativa e nomeia o grupo', () => {
    render(<LinkSegmented label="Situação" items={items} />);
    const group = screen.getByRole('group', { name: 'Situação' });
    expect(within(group).getByRole('link', { name: 'Ativos' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      within(group).getByRole('link', { name: 'Removidos' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('vira navegação quando troca a visão da tela', () => {
    render(<LinkSegmented landmark label="Visualização" items={items} />);
    expect(screen.getByRole('navigation', { name: 'Visualização' })).toBeTruthy();
  });
});

describe('DataTable — cabeçalho de cartão', () => {
  const props = {
    total: 0,
    page: 1,
    pageCount: 1,
    pageSize: 50,
    unit: { one: 'item', many: 'itens' },
    hrefFor: () => '/x',
  };

  it('sem título não acrescenta cabeçalho', () => {
    const { container } = render(
      <DataTable {...props}>
        <tbody />
      </DataTable>,
    );
    expect(container.querySelector('[data-slot="table-head"]')).toBeNull();
  });

  it('mostra título e apoio também no estado vazio', () => {
    render(
      <DataTable {...props} title="Lançamentos" description="mais recentes" empty={<p>Vazio</p>}>
        <tbody />
      </DataTable>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Lançamentos' })).toBeTruthy();
    expect(screen.getByText('mais recentes')).toBeTruthy();
    expect(screen.getByText('Vazio')).toBeTruthy();
  });
});
