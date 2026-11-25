/**
 * Extrai os requisitos do Componente de Segurança e Privacidade do Padrão TISS
 * (planilha oficial da ANS) para `data/tiss/seguranca/<versão>/requisitos.json`,
 * com o texto integral de cada requisito. É a fonte da matriz N.2 do
 * QORO_TISS_MASTER_PLAN.md: a análise cita o texto oficial, não um resumo.
 *
 * Saída determinística (sem carimbo de hora).
 *
 * Uso:
 *   npx tsx scripts/tiss/security/extract-requirements.ts \
 *     --xlsx "<…>/Padrão TISS_segurança_202511.xlsx" --version 202511 \
 *     --archive-url <url oficial do zip> --archive-sha256 <sha do zip>
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { excelSerialToIsoDate, readXlsx } from '@/lib/xlsx';

const arg = (name: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v) throw new Error(`--${name} obrigatório`);
  return v;
};

const xlsxPath = arg('xlsx');
const version = arg('version');
const bytes = readFileSync(xlsxPath);
const wb = readXlsx(bytes);
const sheet = wb.sheet(wb.sheetNames[0]!)!;

const header = sheet.rows.find((r) => String(r.cells.A ?? '').trim() === 'Numeração');
if (!header) throw new Error('cabeçalho "Numeração" não encontrado');
const scope = String(
  sheet.rows.find((r) => String(r.cells.A ?? '').trim() === 'Escopo')?.cells.B ?? '',
).trim();

const date = (v: unknown): string | null =>
  typeof v === 'number' ? excelSerialToIsoDate(v) : v == null || v === '' ? null : String(v).trim();

const requirements = sheet.rows
  .filter((r) => r.index > header.index && typeof r.cells.A === 'number')
  .map((r) => ({
    id: r.cells.A as number,
    description: String(r.cells.B ?? '')
      .replace(/\s+/gu, ' ')
      .trim(),
    condition: String(r.cells.C ?? '').trim(),
    startsOn: date(r.cells.D),
    endsOn: date(r.cells.E),
    implementationDeadline: date(r.cells.F),
    note: r.cells.G == null ? null : String(r.cells.G).replace(/\s+/gu, ' ').trim(),
  }));

const out = {
  component: 'Padrão TISS — Componente de Segurança e Privacidade',
  version,
  source: {
    publisher: 'ANS',
    page: 'https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/padrao-tiss-setembro-2026',
    archiveUrl: arg('archive-url'),
    archiveSha256: arg('archive-sha256'),
    sheetFile: path.basename(xlsxPath),
    sheetSha256: createHash('sha256').update(bytes).digest('hex'),
  },
  scope,
  count: requirements.length,
  requirements,
};
const dir = path.join(process.cwd(), 'data/tiss/seguranca', version);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'requisitos.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(
  `${requirements.length} requisitos; ${requirements.filter((r) => r.condition === 'Obrigatório').length} obrigatórios`,
);
