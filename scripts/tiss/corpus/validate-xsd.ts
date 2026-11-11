/**
 * Camada interna de XSD sobre o corpus (P13.2 parcial): valida cada arquivo de
 * `data/tiss/corpus/4.03.00/c1` contra os XSDs oficiais versionados, confere
 * com a expectativa do manifesto e grava `XSD_RESULTS.json` como evidência.
 *
 * `xmllint-wasm` (libxml2 compilada para WebAssembly, MIT) foi avaliado em
 * P0.8 e só entra no `package.json` em P9.2. Até lá, informe onde ele está:
 *   TISS_XMLLINT_WASM_DIR=<pasta com node_modules/xmllint-wasm> \
 *     npx tsx scripts/tiss/corpus/validate-xsd.ts   (TISS_CORPUS=c2 para o corpus c2)
 *
 * Sai com código 1 se algum arquivo divergir do esperado.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { CorpusManifest } from '@/contexts/health-insurance/tiss/corpus/manifest';
import { CORPUS_DIR } from '@/contexts/health-insurance/tiss/corpus/scenarios';

interface XmllintModule {
  validateXML(opts: {
    xml: { fileName: string; contents: Uint8Array };
    schema: { fileName: string; contents: Uint8Array };
    preload: Array<{ fileName: string; contents: Uint8Array }>;
  }): Promise<{ valid: boolean; errors: Array<{ message: string }> }>;
}

function loadXmllint(): { mod: XmllintModule; version: string } {
  const from = process.env.TISS_XMLLINT_WASM_DIR
    ? path.join(process.env.TISS_XMLLINT_WASM_DIR, 'package.json')
    : path.join(process.cwd(), 'package.json');
  const req = createRequire(from);
  const pkg = req('xmllint-wasm/package.json') as { version: string };
  return { mod: req('xmllint-wasm') as XmllintModule, version: pkg.version };
}

const SCHEMA_DIR = path.join(process.cwd(), 'src/contexts/health-insurance/tiss/schemas/4.03.00');
const ROOT_SCHEMA = 'tissV4_03_00.xsd';
// `TISS_CORPUS=c2` valida o corpus da solicitação e do recurso de glosa; o padrão continua o c1.
const dir = path.join(process.cwd(), process.env.TISS_CORPUS ? CORPUS_DIR.replace(/c1$/u, process.env.TISS_CORPUS) : CORPUS_DIR);

const { mod, version } = loadXmllint();
const xsds = readdirSync(SCHEMA_DIR)
  .filter((f) => f.endsWith('.xsd'))
  .map((f) => ({ fileName: f, contents: readFileSync(path.join(SCHEMA_DIR, f)) }));
const schema = xsds.find((x) => x.fileName === ROOT_SCHEMA)!;
const schemaManifest = JSON.parse(readFileSync(path.join(SCHEMA_DIR, 'MANIFEST.json'), 'utf8')) as {
  source?: { archiveSha256?: string };
};
const manifest = JSON.parse(
  readFileSync(path.join(dir, 'MANIFEST.json'), 'utf8'),
) as CorpusManifest;

const results = [];
let mismatches = 0;
for (const entry of manifest.scenarios) {
  if (!entry.file) continue;
  const contents = readFileSync(path.join(dir, entry.file));
  const r = await mod.validateXML({
    xml: { fileName: entry.file, contents },
    schema,
    preload: xsds.filter((x) => x !== schema),
  });
  const expectedValid = !entry.rejectedBy.includes('xsd');
  const ok = r.valid === expectedValid;
  if (!ok) mismatches += 1;
  results.push({
    id: entry.id,
    sha256: entry.sha256,
    xsdValid: r.valid,
    expectedXsdValid: expectedValid,
    asExpected: ok,
    errors: r.errors.slice(0, 3).map((e) => e.message.replace(/\s+/gu, ' ').trim().slice(0, 240)),
  });
  console.log(`${ok ? 'ok ' : 'ERR'} ${entry.id}: XSD ${r.valid ? 'válido' : 'inválido'}`);
}

writeFileSync(
  path.join(dir, 'XSD_RESULTS.json'),
  `${JSON.stringify(
    {
      corpus: manifest.corpus,
      tool: 'xmllint-wasm',
      toolVersion: version,
      rootSchema: ROOT_SCHEMA,
      schemaArchiveSha256: schemaManifest.source?.archiveSha256 ?? null,
      results,
    },
    null,
    2,
  )}\n`,
);
console.log(`${results.length} arquivos; ${mismatches} divergência(s) da expectativa`);
process.exit(mismatches === 0 ? 0 : 1);
