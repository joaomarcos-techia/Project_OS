/**
 * Gera o corpus sintético de validação TISS (P13.1 do QORO_TISS_MASTER_PLAN.md)
 * com o código real do app e grava o manifesto com o SHA-256 de cada arquivo.
 *
 * Saída determinística (sem carimbo de hora): rodar de novo produz os mesmos
 * bytes. O teste `corpus.test.ts` falha se o código mudar e o corpus não for
 * regenerado.
 *
 * Uso: npx tsx scripts/tiss/corpus/generate.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { corpusManifest } from '@/contexts/health-insurance/tiss/corpus/manifest';
import { CORPUS_DIR, corpusScenarios } from '@/contexts/health-insurance/tiss/corpus/scenarios';

const dir = path.join(process.cwd(), CORPUS_DIR);
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) {
  if (f.endsWith('.xml')) rmSync(path.join(dir, f));
}

const scenarios = corpusScenarios();
for (const s of scenarios) {
  const bytes = s.bytes();
  if (bytes) writeFileSync(path.join(dir, `${s.id}.xml`), bytes);
}
const manifest = corpusManifest(scenarios);
writeFileSync(path.join(dir, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const files = manifest.scenarios.filter((s) => s.file !== null);
console.log(
  `${manifest.corpus}: ${manifest.scenarios.length} cenários, ${files.length} arquivos ` +
    `(${files.filter((s) => s.expected === 'valid').length} válidos), manifesto ${createHash(
      'sha256',
    )
      .update(JSON.stringify(manifest))
      .digest('hex')
      .slice(0, 12)}`,
);
