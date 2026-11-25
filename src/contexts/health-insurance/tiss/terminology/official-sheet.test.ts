import { describe, expect, it } from 'vitest';

import type { XlsxRow } from '@/lib/xlsx';

import {
  TerminologySheetError,
  cellDate,
  normalizeHeader,
  parseOfficialSheet,
  tableNumberFromSheetName,
} from './official-sheet';

const row = (index: number, cells: XlsxRow['cells']): XlsxRow => ({ index, cells });

// Formato real das abas "Demais terminologias" (Tab 52, TUSS 202609).
const tab52: XlsxRow[] = [
  row(1, { A: 'Tabela 52 - Terminologia de tipo de consulta' }),
  row(5, {
    A: 'Código do Termo',
    B: 'Termo',
    C: 'Data de início de vigência',
    D: 'Data de fim de vigência',
    E: 'Data de fim de implantação',
  }),
  row(7, { A: '1', B: 'Primeira Consulta', C: 38943, E: 38943 }),
  row(8, { A: '2', B: 'Retorno', C: 38943, E: 38943 }),
  row(10, { A: '4', B: 'Por encaminhamento', C: 41192, E: 41882 }),
  row(12, { A: 'Fonte: ANS' }),
];

describe('parseOfficialSheet', () => {
  it('mapeia colunas pelo nome e converte as datas', () => {
    const out = parseOfficialSheet('Tab 52', tab52.slice(0, 5));
    expect(out.table).toBe('52');
    expect(out.title).toBe('Tabela 52 - Terminologia de tipo de consulta');
    expect(out.terms).toEqual([
      {
        code: '1',
        term: 'Primeira Consulta',
        startsOn: '2006-08-14',
        endsOn: null,
        implantationEndsOn: '2006-08-14',
      },
      {
        code: '2',
        term: 'Retorno',
        startsOn: '2006-08-14',
        endsOn: null,
        implantationEndsOn: '2006-08-14',
      },
      {
        code: '4',
        term: 'Por encaminhamento',
        startsOn: '2012-10-10',
        endsOn: null,
        implantationEndsOn: '2014-08-31',
      },
    ]);
  });

  it('aceita "Código" e "Grupo" (tabela 63)', () => {
    const out = parseOfficialSheet('Tab 63', [
      row(5, { A: 'Código', B: 'Grupo', C: 'Data de início de vigência' }),
      row(6, { A: '001', B: 'Consultas médicas', C: 44409 }),
    ]);
    expect(out.terms).toEqual([
      expect.objectContaining({ code: '001', term: 'Consultas médicas', startsOn: '2021-08-01' }),
    ]);
  });

  it('linha de rodapé sem termo é erro, nunca é descartada em silêncio', () => {
    expect(() => parseOfficialSheet('Tab 52', tab52)).toThrow(/código Fonte: ANS sem termo/u);
  });

  it('guarda colunas extras (Sigla da tabela 59) e preserva zeros à esquerda', () => {
    const out = parseOfficialSheet('Tab 59', [
      row(1, { A: 'Tabela 59 - Terminologia de Unidade Federativa' }),
      row(5, {
        A: 'Código do Termo',
        B: 'Termo',
        C: 'Sigla',
        D: 'Data de início de vigência',
        E: 'Data de fim de vigência',
        F: 'Data de fim de implantação',
      }),
      row(7, { A: '35', B: 'São Paulo', C: 'SP', D: 41192, F: 41882 }),
      row(8, { A: '06', B: 'Teste com zero', C: 'XX', D: 41192 }),
    ]);
    expect(out.terms[0]).toMatchObject({ code: '35', term: 'São Paulo', extra: { Sigla: 'SP' } });
    expect(out.terms[1]?.code).toBe('06');
  });

  it('aceita "Código da Tabela" e "Descrição" (tabela 87)', () => {
    const out = parseOfficialSheet('Tab 87 - Lista de terminologias', [
      row(9, { A: 'Tabela 87 - Relação das terminologias unificadas da saúde suplementar' }),
      row(11, { A: 'Código da Tabela', B: 'Descrição', C: 'Data de início de vigência' }),
      row(12, { A: '22', B: 'Procedimentos e eventos em saúde', C: 41192 }),
    ]);
    expect(out.table).toBe('87');
    expect(out.terms).toEqual([
      expect.objectContaining({ code: '22', term: 'Procedimentos e eventos em saúde' }),
    ]);
  });

  it('recusa código repetido', () => {
    expect(() =>
      parseOfficialSheet('Tab 52', [tab52[1]!, tab52[2]!, row(9, { A: '1', B: 'Outra' })]),
    ).toThrow(/código 1 repetido/u);
  });

  it('recusa aba sem cabeçalho de código ou sem termos', () => {
    expect(() => parseOfficialSheet('Tab 52', [row(1, { A: 'nada' })])).toThrow(
      TerminologySheetError,
    );
    expect(() => parseOfficialSheet('Tab 52', [tab52[1]!])).toThrow(/sem termos/u);
    expect(() => parseOfficialSheet('Capa', tab52)).toThrow(/não é uma tabela TUSS/u);
  });
});

describe('auxiliares', () => {
  it('número da tabela a partir do nome da aba', () => {
    expect(tableNumberFromSheetName('Tab 22  VERSÃO 202609')).toBe('22');
    expect(tableNumberFromSheetName('Tab 87 - Lista de terminologias')).toBe('87');
    expect(tableNumberFromSheetName('Indice')).toBeNull();
  });

  it('normaliza cabeçalho sem acento e com espaços colapsados', () => {
    expect(normalizeHeader('  Data de início  de vigência ')).toBe('data de inicio de vigencia');
  });

  it('datas em serial, dd/mm/aaaa ou ISO; texto inválido é erro', () => {
    expect(cellDate(45658)).toBe('2025-01-01');
    expect(cellDate('31/12/2026')).toBe('2026-12-31');
    expect(cellDate('2026-12-31')).toBe('2026-12-31');
    expect(cellDate(undefined)).toBeNull();
    expect(() => cellDate('ontem')).toThrow(TerminologySheetError);
  });
});
