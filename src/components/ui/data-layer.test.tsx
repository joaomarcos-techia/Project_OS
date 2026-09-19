// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Avatar, initialsFrom } from './avatar';
import { DataTable } from './data-table';
import { EntityCell } from './entity-cell';
import { StatsInline } from './stats-inline';
import { TableBody, TableCell, TableRow } from './table';

afterEach(cleanup);

describe('iniciais do avatar', () => {
  it('usa primeira e última palavra, não as duas primeiras', () => {
    expect(initialsFrom('Mariana Costa')).toBe('MC');
  });

  it('ignora preposição do meio — "Maria da Silva" é MS, não MD', () => {
    expect(initialsFrom('Maria da Silva')).toBe('MS');
  });

  it('aguenta nome de uma palavra só', () => {
    expect(initialsFrom('Tetse')).toBe('T');
  });

  it('não quebra com string vazia', () => {
    expect(initialsFrom('   ')).toBe('?');
  });
});

describe('EntityCell', () => {
  it('mostra nome e sublinha juntos', () => {
    render(<EntityCell name="Mariana Costa" sub="32 anos" />);
    expect(screen.getByText('Mariana Costa')).toBeTruthy();
    expect(screen.getByText('32 anos')).toBeTruthy();
  });

  it('deriva o avatar do nome quando não recebe leading', () => {
    const { container } = render(<EntityCell name="Mariana Costa" />);
    expect(container.querySelector('[data-slot="avatar"]')?.textContent).toBe('MC');
  });

  it('troca o avatar pelo leading quando a entidade não é pessoa', () => {
    const { container } = render(<EntityCell name="Atestado médico" leading={<i>ic</i>} />);
    expect(container.querySelector('[data-slot="avatar"]')).toBeNull();
  });
});

describe('Avatar', () => {
  it('é decorativo: o nome já está no texto ao lado', () => {
    const { container } = render(<Avatar name="Carlos Mendes" />);
    expect(container.querySelector('[data-slot="avatar"]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });
});

describe('StatsInline', () => {
  it('separa os itens por ponto médio', () => {
    render(<StatsInline items={[{ label: '2 pacientes' }, { label: '1 novo' }]} />);
    expect(screen.getByText('2 pacientes')).toBeTruthy();
    expect(screen.getByText('1 novo')).toBeTruthy();
    expect(screen.getAllByText('·')).toHaveLength(1);
  });

  it('não renderiza nada sem itens', () => {
    const { container } = render(<StatsInline items={[]} />);
    expect(container.querySelector('[data-slot="stats-inline"]')).toBeNull();
  });
});

describe('DataTable', () => {
  const rows = (
    <TableBody>
      <TableRow>
        <TableCell>Maria</TableCell>
      </TableRow>
    </TableBody>
  );

  it('conta no formato da referência: intervalo de total', () => {
    render(
      <DataTable
        total={1248}
        page={1}
        pageCount={125}
        pageSize={10}
        unit={{ one: 'paciente', many: 'pacientes' }}
        hrefFor={(p) => `?page=${p}`}
      >
        {rows}
      </DataTable>,
    );
    expect(screen.getByText(/1–10 de 1\.248 pacientes/u)).toBeTruthy();
  });

  it('usa o singular quando há um só', () => {
    render(
      <DataTable
        total={1}
        page={1}
        pageCount={1}
        pageSize={10}
        unit={{ one: 'paciente', many: 'pacientes' }}
        hrefFor={(p) => `?page=${p}`}
      >
        {rows}
      </DataTable>,
    );
    expect(screen.getByText(/1–1 de 1 paciente$/u)).toBeTruthy();
  });

  it('esconde a paginação quando há uma página só', () => {
    render(
      <DataTable
        total={2}
        page={1}
        pageCount={1}
        pageSize={10}
        unit={{ one: 'paciente', many: 'pacientes' }}
        hrefFor={(p) => `?page=${p}`}
      >
        {rows}
      </DataTable>,
    );
    expect(screen.queryByLabelText('Paginação')).toBeNull();
  });

  it('mostra o vazio no lugar da tabela quando o total é zero', () => {
    render(
      <DataTable
        total={0}
        page={1}
        pageCount={1}
        pageSize={10}
        unit={{ one: 'paciente', many: 'pacientes' }}
        hrefFor={(p) => `?page=${p}`}
        empty={<p>Nenhum paciente ainda</p>}
      >
        {rows}
      </DataTable>,
    );
    expect(screen.getByText('Nenhum paciente ainda')).toBeTruthy();
    expect(screen.queryByText('Maria')).toBeNull();
  });
});
