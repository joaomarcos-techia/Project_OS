/**
 * Gera o corpus `c2` (solicitação SP/SADT e recurso de glosa) pelo código real, com
 * dados 100% fictícios, e grava `MANIFEST.json` com o SHA-256 de cada arquivo.
 * O teste `corpus-c2.test.ts` regenera em memória e confere byte a byte.
 *   npx tsx scripts/tiss/corpus/generate-c2.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { C2_SCENARIOS, CORPUS_C2_DIR } from '@/contexts/health-insurance/tiss/corpus/scenarios-c2';

const dir = path.join(process.cwd(), CORPUS_C2_DIR);
mkdirSync(dir, { recursive: true });
const scenarios = C2_SCENARIOS.map((s) => {
  const built = s.build();
  writeFileSync(path.join(dir, s.file), built.bytes);
  return {
    id: s.id,
    file: s.file,
    description: s.description,
    rejectedBy: s.rejectedBy,
    sha256: createHash('sha256').update(built.bytes).digest('hex'),
    epilogueHash: built.hash,
  };
});
writeFileSync(
  path.join(dir, 'MANIFEST.json'),
  `${JSON.stringify({ corpus: 'c2', tissVersion: '4.03.00', synthetic: true, scenarios }, null, 2)}\n`,
);
console.log(`${scenarios.length} arquivos em ${CORPUS_C2_DIR}`);
