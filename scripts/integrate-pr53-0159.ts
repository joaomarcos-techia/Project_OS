/**
 * Integra a 0159 do PR #53 no journal DEPOIS de o #55 estar sobre o #53 (ordem real #53 → #56 → #55).
 * Regras e recusas: src/lib/db/integrate-pr53-0159.ts. Sem banco e sem rede: só arquivos do
 * repositório integrado. Não renumera nada e não altera o SQL do #53 (copia os bytes conferidos).
 *
 *   npx tsx scripts/integrate-pr53-0159.ts            # grava drizzle/migrations/0159_*.sql e o journal
 *   npx tsx scripts/integrate-pr53-0159.ts --check    # só confere (sai 1 se faltar ou divergir)
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { T0159, integratePr53Successor, type DrizzleJournal } from '../src/lib/db/integrate-pr53-0159';
import { MIGRATION_COMPOSITION_MANIFEST } from '../src/lib/db/migration-composition.manifest';

const root = process.cwd();
const dir = path.join(root, 'drizzle/migrations');
const journalPath = path.join(dir, 'meta/_journal.json');
const pr53 = path.join(root, 'docs/decoupling/asaas-to-abacatepay/migrations');
const check = process.argv.includes('--check');

if (!existsSync(path.join(pr53, 'release-manifest.json'))) {
  console.error('[0159] sem o release-manifest do #53 nesta árvore: a 0159 só entra com o #53 integrado');
  process.exit(1);
}
const raw = readFileSync(journalPath, 'utf8');
const journal = JSON.parse(raw) as DrizzleJournal;
const fileSha256 = new Map<string, string>();
for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')))
  fileSha256.set(f.replace(/\.sql$/u, ''), createHash('sha256').update(readFileSync(path.join(dir, f), 'utf8')).digest('hex'));

const out = integratePr53Successor({
  journal,
  fileSha256,
  frozenSql: readFileSync(path.join(pr53, 'saas_period_snapshot.candidate.sql'), 'utf8'),
  releaseManifest: JSON.parse(readFileSync(path.join(pr53, 'release-manifest.json'), 'utf8')),
  manifest: MIGRATION_COMPOSITION_MANIFEST,
});
if (!out.changed) {
  console.log(`[0159] já integrada: ${journal.entries.length} entradas, contíguas e em ordem`);
  process.exit(0);
}
if (check) {
  console.error('[0159] falta integrar a 0159 do #53 (rode sem --check)');
  process.exit(1);
}
writeFileSync(path.join(dir, `${T0159}.sql`), out.sql);
writeFileSync(journalPath, `${JSON.stringify(out.journal, null, 2)}${raw.endsWith('\n') ? '\n' : ''}`);
console.log(`[0159] integrada: ${out.journal.entries.length} entradas, contíguas, when crescente`);
