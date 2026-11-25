import { crc32, deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { ZipArchive, ZipFormatError, excelSerialToIsoDate, readXlsx } from './index';

interface ZipEntryInput {
  name: string;
  data: Buffer;
  method?: 0 | 8;
  /** Sobrescreve o tamanho declarado (para simular diretório mentiroso). */
  declaredSize?: number;
  /** Sobrescreve o CRC declarado. */
  declaredCrc?: number;
}

/** Escritor ZIP mínimo, só para montar fixtures nos testes. */
function buildZip(entries: ZipEntryInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const method = e.method ?? 8;
    const body = method === 8 ? deflateRawSync(e.data) : e.data;
    const name = Buffer.from(e.name, 'utf8');
    const crc = e.declaredCrc ?? crc32(e.data) >>> 0;
    const size = e.declaredSize ?? e.data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, eocd]);
}

const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Capa" sheetId="1" r:id="rId1"/><sheet name="Tab 52" sheetId="2" r:id="rId2"/></sheets></workbook>`;
const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="worksheet" Target="/xl/worksheets/sheet2.xml"/>
<Relationship Id="rId9" Type="sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
const sharedXml = `<sst><si><t>Código do Termo</t></si><si><t>Termo</t></si><si><r><t>Primeira </t></r><r><t xml:space="preserve">Consulta</t></r></si><si><t>Pr&#233;-natal &amp; afins_x000D_</t></si><si/></sst>`;
const sheet1 = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Capa</t></is></c></row></sheetData></worksheet>`;
const sheet2 = `<worksheet><sheetData>
<row r="5"><c r="A5" t="s"><v>0</v></c><c r="B5" t="s"><v>1</v></c><c r="C5" s="3" t="str"><v>Data</v></c></row>
<row r="7"><c r="A7" t="s"><v>2</v></c><c r="C7" s="4"><v>38943</v></c><c r="D7" t="b"><v>1</v></c></row>
<row r="8"><c t="s" r="A8"><v>3</v></c><c r="B8"><f>1+1</f><v>2</v></c><c r="C8" t="s"><v>4</v></c></row>
<row r="9"/>
</sheetData></worksheet>`;

function workbookZip(method: 0 | 8 = 8): Buffer {
  return buildZip([
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml), method },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(relsXml), method },
    { name: 'xl/sharedStrings.xml', data: Buffer.from(sharedXml), method },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet1), method },
    { name: 'xl/worksheets/sheet2.xml', data: Buffer.from(sheet2), method },
  ]);
}

describe('readXlsx', () => {
  it.each([0, 8] as const)('lê abas, textos e números (método %i)', (method) => {
    const wb = readXlsx(workbookZip(method));
    expect(wb.sheetNames).toEqual(['Capa', 'Tab 52']);
    expect(wb.sheet('Capa')?.rows).toEqual([{ index: 1, cells: { A: 'Capa' } }]);
    const rows = wb.sheet('Tab 52')?.rows ?? [];
    expect(rows.map((r) => r.index)).toEqual([5, 7, 8, 9]);
    expect(rows[0]?.cells).toEqual({ A: 'Código do Termo', B: 'Termo', C: 'Data' });
    // Texto rico vira um só; número fica número; booleano fica booleano.
    expect(rows[1]?.cells).toEqual({ A: 'Primeira Consulta', C: 38943, D: true });
    // Entidade, escape _x000D_ e valor em cache de fórmula; string vazia some.
    expect(rows[2]?.cells).toEqual({ A: 'Pré-natal & afins\r', B: 2 });
    expect(rows[3]?.cells).toEqual({});
  });

  it('aba inexistente devolve null', () => {
    expect(readXlsx(workbookZip()).sheet('Tab 99')).toBeNull();
  });

  it('recusa arquivo que não é ZIP', () => {
    expect(() => readXlsx(Buffer.from('isto não é zip'.repeat(5)))).toThrow(ZipFormatError);
  });

  it('recusa ZIP que não é planilha', () => {
    const zip = buildZip([{ name: 'leia-me.txt', data: Buffer.from('oi') }]);
    expect(() => readXlsx(zip)).toThrow(/não é uma planilha/u);
  });
});

describe('ZipArchive: integridade e limites', () => {
  it('recusa CRC divergente', () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('conteudo'), declaredCrc: 123 }]);
    expect(() => new ZipArchive(zip).read('a.txt')).toThrow(/CRC-32/u);
  });

  it('interrompe zip bomb cujo diretório declara tamanho menor que o real', () => {
    const bomb = Buffer.alloc(2 * 1024 * 1024);
    const zip = buildZip([{ name: 'bomba.xml', data: bomb, declaredSize: 1024 }]);
    expect(() => new ZipArchive(zip).read('bomba.xml')).toThrow(ZipFormatError);
  });

  it('recusa entrada maior que o limite por entrada', () => {
    const zip = buildZip([{ name: 'grande.xml', data: Buffer.alloc(4096) }]);
    const limits = { maxEntries: 10, maxEntryBytes: 1024, maxTotalBytes: 1_000_000 };
    expect(() => new ZipArchive(zip, limits).read('grande.xml')).toThrow(/limite de tamanho/u);
  });

  it('recusa o total descompactado acima do limite', () => {
    const zip = buildZip([
      { name: 'a.xml', data: Buffer.alloc(800) },
      { name: 'b.xml', data: Buffer.alloc(800) },
    ]);
    const archive = new ZipArchive(zip, {
      maxEntries: 10,
      maxEntryBytes: 1024,
      maxTotalBytes: 1000,
    });
    expect(archive.read('a.xml')?.length).toBe(800);
    expect(() => archive.read('b.xml')).toThrow(/limite total/u);
  });

  it('recusa ZIP com entradas demais', () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({
      name: `${i}.txt`,
      data: Buffer.from('x'),
    }));
    expect(
      () =>
        new ZipArchive(buildZip(entries), { maxEntries: 5, maxEntryBytes: 10, maxTotalBytes: 100 }),
    ).toThrow(/excede o limite/u);
  });

  it('entrada ausente devolve null', () => {
    expect(new ZipArchive(buildZip([{ name: 'a', data: Buffer.from('1') }])).read('b')).toBeNull();
  });
});

describe('excelSerialToIsoDate', () => {
  it('converte seriais conhecidos do sistema 1900', () => {
    expect(excelSerialToIsoDate(25569)).toBe('1970-01-01');
    expect(excelSerialToIsoDate(45658)).toBe('2025-01-01');
    expect(excelSerialToIsoDate(45658.75)).toBe('2025-01-01');
  });

  it('recusa valores que não são data', () => {
    expect(excelSerialToIsoDate(0)).toBeNull();
    expect(excelSerialToIsoDate(-1)).toBeNull();
    expect(excelSerialToIsoDate(Number.NaN)).toBeNull();
    expect(excelSerialToIsoDate(3_000_000)).toBeNull();
  });
});
