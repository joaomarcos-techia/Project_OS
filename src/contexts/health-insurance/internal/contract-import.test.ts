/**
 * P2.7 — leitura e normalização da planilha da tabela contratual. A validação com banco (mesma
 * regra da tela), a aplicação atômica e a idempotência estão em
 * `scripts/security/health-insurance-contract-import-db.ts`.
 */
import { crc32 } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  CONTRACT_IMPORT_LIMITS,
  contractImportTemplateCsv,
  normalizeContractSheet,
  parseCsv,
  parseDay,
  parseMoneyCents,
  readContractSpreadsheet,
} from './contract-import';

const enc = (s: string) => new TextEncoder().encode(s);
const HEADER =
  'tabela;codigo;descricao;tipo_guia;valor;vigencia_inicio;vigencia_fim;plano;exige_autorizacao;coparticipacao_tipo;coparticipacao_valor;retorno_dias;retorno_faturavel;procedimento_clinica';

/** ZIP mínimo (sem compressão), só para montar o .xlsx de teste. */
function storedZip(entries: Array<{ name: string; data: string }>): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.from(e.data, 'utf8');
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + data.length;
  }
  const dir = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, dir, eocd]));
}

function xlsxOf(rows: string): Uint8Array {
  return storedZip([
    {
      name: 'xl/workbook.xml',
      data: '<workbook xmlns:r="r"><sheets><sheet name="Tabela" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
    },
  ]);
}
const t = (ref: string, v: string) => `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
const n = (ref: string, v: number, f?: string) =>
  `<c r="${ref}">${f ? `<f>${f}</f>` : ''}<v>${v}</v></c>`;

describe('leitura da planilha (P2.7)', () => {
  it('modelo para baixar tem todas as colunas e uma linha que valida', () => {
    const sheet = parseCsv(contractImportTemplateCsv());
    const norm = normalizeContractSheet(sheet);
    expect(norm.missingColumns).toEqual([]);
    expect(norm.errors).toEqual([]);
    expect(norm.rows).toHaveLength(1);
    expect(norm.rows[0]).toMatchObject({
      procedureCode: '10101012',
      guideType: 'consulta',
      unitValueCents: 15000,
      validFrom: '2027-01-01',
      copayKind: 'percentage',
      copayPercentage: 30,
      returnDays: 30,
      clinicProcedureCode: 'CONS',
    });
  });

  it('CSV: separador ; ou , detectado, aspas, BOM, CRLF e linhas vazias', () => {
    const semi = parseCsv(`﻿a;b\r\n"x;1";"di""z"\r\n\r\n2;3\r\n`);
    expect(semi.header).toEqual(['a', 'b']);
    expect(semi.rows).toEqual([
      { line: 2, cells: ['x;1', 'di"z'] },
      { line: 4, cells: ['2', '3'] },
    ]);
    const comma = parseCsv('a,b\n1,"2,5"\n');
    expect(comma.rows).toEqual([{ line: 2, cells: ['1', '2,5'] }]);
    expect(() => parseCsv('a;b\n"aberto;1\n')).toThrow(/aspas/u);
  });

  it('XLSX: primeira aba, valor em cache da fórmula (nunca executada), data serial', () => {
    const rows =
      `<row r="1">${HEADER.split(';')
        .map((h, i) => t(`${String.fromCharCode(65 + i)}1`, h))
        .join('')}</row>` +
      `<row r="2">${t('A2', '22')}${t('B2', '10101012')}${t('D2', 'consulta')}${n('E2', 150, '100+50')}${n('F2', 46388)}${t('N2', 'CONS')}</row>`;
    const sheet = readContractSpreadsheet('tabela.xlsx', xlsxOf(rows));
    const norm = normalizeContractSheet(sheet);
    expect(norm.errors).toEqual([]);
    expect(norm.rows[0]).toMatchObject({ unitValueCents: 15000, validFrom: '2027-01-01', line: 2 });
  });

  it('formato e tamanho conferidos antes de ler', () => {
    expect(() => readContractSpreadsheet('a.pdf', enc('x'))).toThrow(/\.csv ou \.xlsx/u);
    expect(() => readContractSpreadsheet('a.xlsx', enc('não é zip'))).toThrow(/não é um \.xlsx/u);
    expect(() => readContractSpreadsheet('a.csv', xlsxOf(''))).toThrow(/outro formato/u);
    expect(() => readContractSpreadsheet('a.csv', new Uint8Array(0))).toThrow(/vazio/u);
    expect(() =>
      readContractSpreadsheet('a.csv', new Uint8Array(CONTRACT_IMPORT_LIMITS.maxBytes + 1)),
    ).toThrow(/2 MB/u);
    expect(() => readContractSpreadsheet('a.csv', enc('a;b\n1\u00002'))).toThrow(/binário/u);
    const many = `${HEADER}\n${'x\n'.repeat(CONTRACT_IMPORT_LIMITS.maxRows + 5)}`;
    expect(() => readContractSpreadsheet('a.csv', enc(many))).toThrow(/2000 linhas/u);
  });

  it('valores, datas e booleanos em formatos brasileiros', () => {
    expect(parseMoneyCents('150,00')).toBe(15000);
    expect(parseMoneyCents('R$ 1.234,56')).toBe(123456);
    expect(parseMoneyCents('1234.5')).toBe(123450);
    expect(parseMoneyCents('12,345')).toBeNull();
    expect(parseMoneyCents('abc')).toBeNull();
    expect(parseDay('31/12/2027')).toBe('2027-12-31');
    expect(parseDay('2027-02-29')).toBeNull();
    expect(parseDay('31/02/2027')).toBeNull();
    expect(parseDay('46388')).toBe('2027-01-01');
  });

  it('cabeçalho sem coluna obrigatória: nenhuma linha é lida', () => {
    const norm = normalizeContractSheet(parseCsv('codigo;valor\n10101012;150,00\n'));
    expect(norm.missingColumns).toEqual(['tipo_guia', 'vigencia_inicio', 'procedimento_clinica']);
    expect(norm.rows).toEqual([]);
  });

  it('erros por linha, sem esconder nada; fórmula disfarçada recusada; colunas extras avisadas', () => {
    const csv = [
      `${HEADER};observacao`,
      '18;10101012;;consulta;150,00;01/01/2027;;;;;;;;CONS;x',
      '22;abc;;exame;;32/13/2027;;;talvez;mista;;400;;;',
      '22;10101012;=HYPERLINK("http://x");consulta;150,00;01/01/2027;;;;;;;;CONS;',
      '22;10101012;;consulta;150,00;01/01/2027;01/01/2026;;;fixa;;;;CONS;',
    ].join('\n');
    const norm = normalizeContractSheet(parseCsv(csv));
    expect(norm.unknownColumns).toEqual(['observacao']);
    expect(norm.rows).toEqual([]);
    const byLine = new Map(norm.errors.map((e) => [e.line, e.messages.join(' | ')]));
    expect(byLine.get(2)).toMatch(/só a 22/u);
    expect(byLine.get(3)).toMatch(
      /codigo.*tipo_guia.*valor.*vigencia_inicio.*exige_autorizacao.*coparticipacao_tipo.*retorno_dias.*procedimento_clinica/su,
    );
    expect(byLine.get(4)).toMatch(/fórmula não é aceita/u);
    expect(byLine.get(5)).toMatch(/antes do início.*coparticipacao_valor/su);
  });
});
