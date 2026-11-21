/**
 * Pacote de migrations COMPOSTO, na ordem do lançamento coordenado e do DEV compartilhado:
 * main 0000–0135 → #53 0136–0142 → #55 0143–0158 → #53 0159 (candidata congelada) → #55 0160.
 *
 * Serve ao pré-voo só leitura do ledger de produção (`db-migrate-prod.ts --check-composition
 * --migrations-dir <pasta>`): o journal do #55 sozinho não tem as peças do #53 e o guarda o recusa
 * antes de conectar (fail-closed). Aqui as peças do #53 vêm do git (`git show`, sem tocar o worktree
 * dele), a 0159 com o sha256 aplicado no DEV e fixado no manifesto; o resultado passa pelo guarda
 * de composição (só journal) antes de ser devolvido.
 *
 * Só lê o git e escreve numa pasta NOVA (vazia ou inexistente), nunca no journal do repositório.
 *
 *   npx tsx scripts/security/compose-release-migrations.ts --out <pasta nova> [--pr53-ref <ref>]
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { MIGRATION_COMPOSITION_MANIFEST as MANIFEST } from '@/lib/db/migration-composition.manifest';

import {
  PR53_CANDIDATE_REF,
  PR53_CANDIDATE_SHA256,
  readPr53FinancialCandidate,
} from './dev-order-chain';
import { checkComposition } from './migration-composition-io';

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

const T0159 = '0159_saas_period_snapshot';

export interface ComposedRelease {
  folder: string;
  entries: number;
  last: string;
  pending0136to0160: number;
}

export async function composeReleaseMigrations(opts: {
  outDir: string;
  pr53Ref?: string;
  candidateRef?: string;
  repoRoot?: string;
}): Promise<ComposedRelease> {
  const root = path.resolve(opts.repoRoot ?? process.cwd());
  const repoMigrations = path.join(root, 'drizzle/migrations');
  const out = path.resolve(opts.outDir);
  assert.ok(
    !out.toLowerCase().startsWith(repoMigrations.toLowerCase()),
    'a pasta de saída não pode ficar dentro de drizzle/migrations',
  );
  assert.ok(!existsSync(out) || readdirSync(out).length === 0, `pasta de saída não vazia: ${out}`);
  const git = (...a: string[]) =>
    execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const pr53Ref = opts.pr53Ref ?? 'origin/feat/billing-abacatepay-20261107';

  const local = JSON.parse(
    readFileSync(path.join(repoMigrations, 'meta/_journal.json'), 'utf8'),
  ) as {
    version: string;
    dialect: string;
    entries: JournalEntry[];
  };
  const pr53 = (
    JSON.parse(git('show', `${pr53Ref}:drizzle/migrations/meta/_journal.json`)) as {
      entries: JournalEntry[];
    }
  ).entries.filter((e) => e.idx >= 136 && e.idx <= 142);
  assert.equal(pr53.length, 7, `o #53 (${pr53Ref}) deve ter 0136–0142 no journal`);
  const candidate = readPr53FinancialCandidate(opts.candidateRef ?? PR53_CANDIDATE_REF);
  assert.equal(
    createHash('sha256').update(candidate).digest('hex'),
    PR53_CANDIDATE_SHA256,
    'a 0159 candidata não é a fixada (aplicada no DEV)',
  );
  const pinned0159 = MANIFEST.pinned.find((p) => p.tag === T0159);
  assert.ok(pinned0159, '0159 ausente do manifesto');

  const folder = path.join(out, 'migrations');
  cpSync(repoMigrations, folder, { recursive: true });
  for (const e of pr53) {
    writeFileSync(
      path.join(folder, `${e.tag}.sql`),
      git('show', `${pr53Ref}:drizzle/migrations/${e.tag}.sql`),
    );
  }
  writeFileSync(path.join(folder, `${T0159}.sql`), candidate);
  const entries = [
    ...local.entries,
    ...pr53,
    { idx: 159, version: '7', when: pinned0159.when, tag: T0159, breakpoints: true },
  ].sort((a, b) => a.idx - b.idx);
  writeFileSync(
    path.join(folder, 'meta/_journal.json'),
    JSON.stringify({ ...local, entries }, null, 2),
  );
  // O pacote só sai daqui se o guarda (só journal) aceitar: contíguo, `when` crescente, pinos e
  // dependências 0136 → … → 0160.
  await checkComposition({ folder, manifest: MANIFEST });
  return {
    folder,
    entries: entries.length,
    last: entries.at(-1)!.tag,
    pending0136to0160: entries.filter((e) => e.idx >= 136).length,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const outDir = arg('out');
  if (!outDir) throw new Error('uso: --out <pasta nova> [--pr53-ref <ref>]');
  const r = await composeReleaseMigrations({
    outDir,
    ...(arg('pr53-ref') ? { pr53Ref: arg('pr53-ref')! } : {}),
  });
  console.log(
    `[compose-release] ${r.entries} entradas (última ${r.last}; ${r.pending0136to0160} a partir da 0136) em ${r.folder}`,
  );
}
