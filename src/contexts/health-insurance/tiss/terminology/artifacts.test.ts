/**
 * Integridade dos artefatos de terminologia TUSS (P0.9) e validação cruzada
 * com os domínios do XSD oficial 4.03.00.
 *
 * Os artefatos são gerados por `scripts/tiss/terminology/build-artifacts.ts` a
 * partir das planilhas oficiais da ANS. Este teste garante que:
 *  - o manifesto confere com os arquivos (ninguém editou um JSON à mão);
 *  - as tabelas que as guias suportadas usam estão presentes;
 *  - cada domínio do XSD bate com a tabela TUSS correspondente, e as duas
 *    divergências conhecidas da competência 202609 continuam sendo exatamente
 *    as registradas no plano mestre (B.10). Se a ANS corrigir uma delas, o
 *    teste falha de propósito: alguém precisa revisar a regra do validador.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { TerminologyTerm } from './official-sheet';

const VERSION = '202609';
const DIR = path.join(process.cwd(), 'data/tiss/terminologia', VERSION);
const XSD = path.join(
  process.cwd(),
  'src/contexts/health-insurance/tiss/schemas/4.03.00/tissSimpleTypesV4_03_00.xsd',
);

interface Manifest {
  version: string;
  archive: { url: string; sha256: string };
  sources: Array<{ file: string; sha256: string }>;
  tables: Record<string, { file: string; sha256: string; count: number }>;
}
interface TableFile {
  version: string;
  table: string;
  count: number;
  terms: TerminologyTerm[];
}

const manifest = JSON.parse(readFileSync(path.join(DIR, 'MANIFEST.json'), 'utf8')) as Manifest;
const table = (n: string): TableFile =>
  JSON.parse(readFileSync(path.join(DIR, `tab-${n}.json`), 'utf8')) as TableFile;
const codes = (n: string): Set<string> => new Set(table(n).terms.map((t) => t.code));

const xsdText = readFileSync(XSD, 'latin1');
function xsdEnumeration(name: string): Set<string> {
  const start = xsdText.indexOf(`<simpleType name="${name}"`);
  if (start < 0) throw new Error(`domínio ${name} ausente no XSD`);
  const end = xsdText.indexOf('</simpleType>', start);
  return new Set(
    [...xsdText.slice(start, end).matchAll(/enumeration value="([^"]*)"/gu)].map((m) => m[1]!),
  );
}
const minus = (a: Set<string>, b: Set<string>): string[] => [...a].filter((x) => !b.has(x)).sort();

describe(`terminologia TUSS ${VERSION}: artefatos`, () => {
  it('manifesto aponta o pacote oficial e confere com cada arquivo', () => {
    expect(manifest.version).toBe(VERSION);
    expect(manifest.archive.url).toMatch(/^https:\/\/www\.ans\.gov\.br\//u);
    expect(manifest.archive.sha256).toMatch(/^[0-9a-f]{64}$/u);
    const onDisk = readdirSync(DIR).filter((f) => f.startsWith('tab-'));
    expect(onDisk.sort()).toEqual(
      Object.values(manifest.tables)
        .map((t) => t.file)
        .sort(),
    );
    for (const [n, info] of Object.entries(manifest.tables)) {
      const content = readFileSync(path.join(DIR, info.file));
      expect(createHash('sha256').update(content).digest('hex'), info.file).toBe(info.sha256);
      const parsed = table(n);
      expect(parsed.table).toBe(n);
      expect(parsed.terms).toHaveLength(info.count);
      expect(parsed.count).toBe(info.count);
    }
  });

  it('tem as tabelas usadas pela Guia de Consulta e pela SP/SADT', () => {
    for (const n of [
      '22',
      '23',
      '24',
      '26',
      '36',
      '38',
      '39',
      '48',
      '50',
      '52',
      '59',
      '61',
      '72',
      '74',
      '75',
      '76',
      '77',
      '87',
    ]) {
      expect(manifest.tables, `tabela ${n}`).toHaveProperty([n]);
    }
  });

  it('a consulta em consultório (10101012) está na tabela 22 com vigência', () => {
    const consulta = table('22').terms.find((t) => t.code === '10101012');
    expect(consulta).toMatchObject({
      term: 'Consulta em consultório (no horário normal ou preestabelecido)',
      startsOn: '2009-02-13',
      endsOn: null,
    });
  });

  it('nenhum termo tem código vazio, repetido ou datas fora de ordem', () => {
    for (const n of Object.keys(manifest.tables)) {
      const terms = table(n).terms;
      expect(new Set(terms.map((t) => t.code)).size, `tabela ${n}`).toBe(terms.length);
      for (const t of terms) {
        expect(t.code.length, `tabela ${n}`).toBeGreaterThan(0);
        if (t.startsOn && t.endsOn) expect(t.endsOn >= t.startsOn, `${n}/${t.code}`).toBe(true);
      }
    }
  });
});

describe(`terminologia TUSS ${VERSION} × XSD 4.03.00`, () => {
  it.each([
    ['dm_caraterAtendimento', '23'],
    ['dm_conselhoProfissional', '26'],
    ['dm_indicadorAcidente', '36'],
    ['dm_motivoSaida', '39'],
    ['dm_tecnicaUtilizada', '48'],
    ['dm_tipoAtendimento', '50'],
    ['dm_tipoConsulta', '52'],
    ['dm_UF', '59'],
    ['dm_viaDeAcesso', '61'],
    ['dm_tipoIdent', '72'],
    ['dm_ausenciaCodValidacao', '74'],
    ['dm_cobEsp', '75'],
    ['dm_regimeAtendimento', '76'],
    ['dm_saudeOcupacional', '77'],
    ['dm_outrasDespesas', '25'],
  ])('%s é igual à tabela %s', (domain, tab) => {
    expect([...xsdEnumeration(domain)].sort()).toEqual([...codes(tab)].sort());
  });

  it('dm_tabela (tabelas aceitas em itens) está contida na tabela 87', () => {
    expect(minus(xsdEnumeration('dm_tabela'), codes('87'))).toEqual([]);
  });

  it('CBO: divergência conhecida — dois códigos só no XSD, nenhum só na tabela 24', () => {
    expect(minus(xsdEnumeration('dm_CBOS'), codes('24'))).toEqual(['225190', '225245']);
    expect(minus(codes('24'), xsdEnumeration('dm_CBOS'))).toEqual([]);
  });

  it('glosas: divergência conhecida — 24 códigos da tabela 38 ainda fora do XSD', () => {
    // Um demonstrativo de operadora com estes códigos falha no XSD 4.03.00;
    // o importador (P9.5) trata isso como aviso, tendo a tabela 38 como referência.
    expect(minus(codes('38'), xsdEnumeration('dm_tipoGlosa'))).toEqual([
      '5063',
      '5064',
      '5065',
      '5066',
      '5067',
      '5068',
      '5069',
      '5070',
      '5071',
      '5072',
      '5073',
      '5074',
      '5075',
      '5076',
      '5077',
      '5078',
      '5079',
      '5080',
      '5081',
      '5082',
      '5083',
      '5084',
      '5085',
      '5086',
    ]);
  });
});
