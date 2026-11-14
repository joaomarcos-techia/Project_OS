/**
 * A cadeia de migrations NA ORDEM DO DEV compartilhado: `main` 0000–0135 → #53 0136–0142
 * (lidas do commit do #53 por `git show`, sem tocar o worktree dele) → #55 0143+.
 * Usada pelos harnesses que precisam do schema que o DEV terá (gatilhos de trial do #53
 * em `lancamentos` ao lado dos do convênio). Só leitura do git; nada é aplicado fora do
 * Postgres descartável de quem chama.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { readMigrations } from './scratch-schema';

export const PR53_DEFAULT_REF = '8c591c8f';

const git = (...args: string[]) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 << 20 });

export async function readDevOrderChain(
  ref = process.env.PR53_REF ?? PR53_DEFAULT_REF,
): Promise<{ file: string; body: string }[]> {
  const pr53Files = git('ls-tree', '--name-only', ref, 'drizzle/migrations/')
    .split('\n')
    .map((l) => l.trim().replace(/^drizzle\/migrations\//u, ''))
    .filter((f) => /^01(?:3[6-9]|4[0-2])_.*\.sql$/u.test(f));
  assert.equal(
    pr53Files.length,
    7,
    `esperava 0136–0142 no #53 (${ref}), achei ${pr53Files.join(',')}`,
  );
  const local = await readMigrations();
  assert.ok(
    !local.some((m) => /^01(?:3[6-9]|4[0-2])_/u.test(m.file)),
    'a branch do convênio não deve ter 0136–0142',
  );
  const chain = [
    ...local,
    ...pr53Files.map((file) => ({ file, body: git('show', `${ref}:drizzle/migrations/${file}`) })),
  ];
  // A 0159 do #53 está APLICADA no DEV (fora do journal dele, como candidata). Quando a
  // branch do convênio tem migration depois dela (0160+), a cadeia do DEV inclui a 0159
  // com os MESMOS bytes aplicados (sha256 conferido), senão o descartável não seria o DEV.
  if (local.some((m) => Number(m.file.slice(0, 4)) >= 160)) {
    const body = readPr53FinancialCandidate(process.env.PR53_CANDIDATE_REF ?? PR53_CANDIDATE_REF);
    assert.equal(
      createHash('sha256').update(body).digest('hex'),
      PR53_CANDIDATE_SHA256,
      'a 0159 candidata do #53 não é a aplicada no DEV',
    );
    chain.push({ file: '0159_saas_period_snapshot.sql', body });
  }
  chain.sort((a, b) => a.file.localeCompare(b.file));
  chain.forEach((m, i) =>
    assert.equal(Number(m.file.slice(0, 4)), i, `prefixo ${m.file} na posição ${i}`),
  );
  return chain;
}

/** Commit do #53 cuja 0159 candidata é byte a byte a aplicada no DEV (release-manifest). */
export const PR53_CANDIDATE_REF = '97e2c306';
export const PR53_CANDIDATE_SHA256 =
  'eb00a4e3dd45f89e7eef4dc2c95c577e7932f1f2131d5bfb4ff8f5e4570f5c74';

/** O SQL candidato do #53 (fora do journal dele), para a composição depois da cauda do TISS. */
export function readPr53FinancialCandidate(ref = process.env.PR53_REF ?? PR53_DEFAULT_REF): string {
  return git(
    'show',
    `${ref}:docs/decoupling/asaas-to-abacatepay/migrations/saas_period_snapshot.candidate.sql`,
  );
}

/** Texto de uma função `public.<name>()` como a migration a define (até o `END $$;`). */
export function functionText(body: string, name: string): string {
  const start = body.indexOf(`CREATE OR REPLACE FUNCTION public.${name}()`);
  assert.ok(start >= 0, `função ${name} ausente`);
  const end = body.indexOf('END $$;', start);
  return body.slice(start, end + 'END $$;'.length);
}
