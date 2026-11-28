/**
 * Gera os artefatos versionados da terminologia TUSS a partir das planilhas
 * oficiais da ANS (P0.9 do QORO_TISS_MASTER_PLAN.md).
 *
 * Entrada: as duas planilhas extraídas do pacote "Representação de Conceitos
 * em Saúde" da competência (tabela 22 e "Demais terminologias"). O pacote é
 * grande demais para o repositório; o SHA-256 dele entra no manifesto.
 *
 * Saída: `data/tiss/terminologia/<versão>/tab-NN.json` + `MANIFEST.json`.
 * A saída é determinística: rodar de novo com as mesmas planilhas produz os
 * mesmos bytes, sem carimbo de hora.
 *
 * Uso:
 *   npx tsx scripts/tiss/terminology/build-artifacts.ts \
 *     --tuss22 "<…>/TUSS 22 - PROCEDIMENTOS E EVENTOS EM SAÚDE - VERSÃO 202609.xlsx" \
 *     --demais "<…>/TUSS - Demais terminologias - VERSÃO 202609.xlsx" \
 *     --version 202609 \
 *     --archive-url https://www.ans.gov.br/arquivos/extras/tiss/Padrao_TISS_Representacao_de_Conceitos_em_Saude_202609.zip \
 *     --archive-sha256 <sha do zip oficial>
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  parseOfficialSheet,
  tableNumberFromSheetName,
  type TerminologyTable,
} from '@/contexts/health-insurance/tiss/terminology/official-sheet';
import { readXlsx } from '@/lib/xlsx';

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (!value) throw new Error(`argumento obrigatório ausente: --${name}`);
  return value;
}

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

function main(): void {
  const version = arg('version');
  if (!/^\d{6}$/u.test(version)) throw new Error('--version deve ser AAAAMM (ex.: 202609)');
  const archiveUrl = arg('archive-url');
  const archiveSha256 = arg('archive-sha256');
  if (!/^[0-9a-f]{64}$/u.test(archiveSha256)) throw new Error('--archive-sha256 inválido');
  const outDir = path.resolve(
    process.argv.includes('--out') ? arg('out') : `data/tiss/terminologia/${version}`,
  );

  const sources = [arg('tuss22'), arg('demais')].map((file) => {
    const bytes = readFileSync(file);
    return { file: path.basename(file), sha256: sha256(bytes), bytes };
  });

  const tables = new Map<string, TerminologyTable & { sourceFile: string }>();
  for (const source of sources) {
    const workbook = readXlsx(source.bytes);
    for (const sheetName of workbook.sheetNames) {
      if (!tableNumberFromSheetName(sheetName)) continue; // capa, índice
      const sheet = workbook.sheet(sheetName);
      if (!sheet) continue;
      const parsed = parseOfficialSheet(sheetName, sheet.rows);
      if (tables.has(parsed.table)) {
        throw new Error(`tabela ${parsed.table} aparece em mais de uma aba`);
      }
      tables.set(parsed.table, { ...parsed, sourceFile: source.file });
    }
  }
  if (!tables.has('22')) throw new Error('a tabela 22 não foi encontrada nas planilhas');

  mkdirSync(outDir, { recursive: true });
  const manifestTables: Record<string, { file: string; sha256: string; count: number }> = {};
  for (const table of [...tables.values()].sort((a, b) => a.table.localeCompare(b.table))) {
    const file = `tab-${table.table}.json`;
    const content = `${JSON.stringify(
      {
        standard: 'TUSS — Terminologia Unificada da Saúde Suplementar',
        version,
        table: table.table,
        title: table.title,
        source: table.sourceFile,
        count: table.terms.length,
        terms: table.terms,
      },
      null,
      2,
    )}\n`;
    writeFileSync(path.join(outDir, file), content);
    manifestTables[table.table] = { file, sha256: sha256(content), count: table.terms.length };
  }

  const manifest = {
    standard: 'Padrão TISS — Componente de Representação de Conceitos em Saúde (TUSS)',
    version,
    archive: { url: archiveUrl, sha256: archiveSha256 },
    sources: sources.map(({ file, sha256: hash }) => ({ file, sha256: hash })),
    generatedBy: 'scripts/tiss/terminology/build-artifacts.ts',
    tables: manifestTables,
  };
  writeFileSync(path.join(outDir, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  for (const [table, info] of Object.entries(manifestTables)) {
    console.log(`tabela ${table}: ${info.count} termos`);
  }
  console.log(`${Object.keys(manifestTables).length} tabelas gravadas em ${outDir}`);
}

main();
