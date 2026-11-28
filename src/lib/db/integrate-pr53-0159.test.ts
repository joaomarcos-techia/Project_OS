/**
 * Integração da 0159 do #53 (scripts/integrate-pr53-0159.ts). O SQL real do #53 não existe nesta
 * árvore antes da integração; aqui ele é sintético e o manifesto é o REAL com o pino da 0159 trocado
 * pelo hash do sintético. A prova com os bytes reais roda na composição (o CLI com `--check`).
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type DrizzleJournal,
  Integrate0159Error,
  T0159,
  integratePr53Successor,
  journalOrderProblems,
} from './integrate-pr53-0159';
import type { CompositionManifest } from './migration-composition';
import { MIGRATION_COMPOSITION_MANIFEST } from './migration-composition.manifest';
import { pr53Pinned, withoutPr53 } from './migration-journal-shape';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const dir = resolve(process.cwd(), 'drizzle/migrations');
const real = JSON.parse(readFileSync(resolve(dir, 'meta/_journal.json'), 'utf8')) as DrizzleJournal;
const realSha = new Map(
  readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => [f.replace(/\.sql$/u, ''), sha(readFileSync(resolve(dir, f), 'utf8'))] as const),
);

const BODY = '-- 0159 sintética (os bytes reais são do #53)\nSELECT 1;\n';
const MANIFEST: CompositionManifest = {
  ...MIGRATION_COMPOSITION_MANIFEST,
  pinned: MIGRATION_COMPOSITION_MANIFEST.pinned.map((p) => (p.tag === T0159 ? { ...p, sha256: sha(BODY) } : p)),
};
const PIN = MANIFEST.pinned.find((p) => p.tag === T0159)!;
const RELEASE = {
  financialEntry: { idx: 159, version: '7', breakpoints: true, when: PIN.when, tag: T0159 },
  financialSql: { sha256: sha(BODY) },
  productionAuthorized: false,
};

/** A branch sozinha (sem as do #53), qualquer que seja o estado do journal real. */
const aloneTags = new Set(
  withoutPr53(
    real.entries.map((e) => ({ ...e, sha256: realSha.get(e.tag) })),
    MANIFEST,
  ).map((e) => e.tag),
);
const alone: DrizzleJournal = { ...real, entries: real.entries.filter((e) => aloneTags.has(e.tag)) };
/** O #55 depois de integrado sobre o #53, ainda sem a 0159: as 0136–0142 como fixadas. */
const pr53Range = pr53Pinned(MANIFEST).filter((p) => p.tag !== T0159);
const onTop53: DrizzleJournal = {
  ...alone,
  entries: [
    ...alone.entries,
    ...pr53Range.map((p) => ({ idx: p.idx, version: '7', when: p.when, tag: p.tag, breakpoints: true })),
  ].sort((a, b) => a.idx - b.idx),
};
const onTop53Sha = new Map([...realSha].filter(([t]) => aloneTags.has(t)).concat(pr53Range.map((p) => [p.tag, p.sha256] as const)));

const run = (over: Partial<Parameters<typeof integratePr53Successor>[0]> = {}) =>
  integratePr53Successor({
    journal: onTop53,
    fileSha256: onTop53Sha,
    frozenSql: BODY,
    releaseManifest: RELEASE,
    manifest: MANIFEST,
    ...over,
  });
const refusal = (over: Partial<Parameters<typeof integratePr53Successor>[0]>) => {
  try {
    run(over);
  } catch (e) {
    expect(e).toBeInstanceOf(Integrate0159Error);
    return (e as Error).message;
  }
  throw new Error('deveria recusar');
};

describe('integração da 0159 do #53 (ordem real #53 → #56 → #55)', () => {
  it('sobre o #53, insere a 0159 entre a 0158 e a 0160 com a linha do release-manifest; journal contíguo', () => {
    const out = run();
    expect(out.changed).toBe(true);
    expect(out.sql).toBe(BODY);
    const e = out.journal.entries;
    expect(e.find((x) => x.idx === 159)).toEqual(RELEASE.financialEntry);
    expect(e.map((x) => x.idx)).toEqual(Array.from({ length: e.length }, (_, i) => i));
    expect(journalOrderProblems(e)).toEqual([]);
    expect(e.length).toBe(onTop53.entries.length + 1);
  });

  it('é idempotente: com a 0159 certa no lugar, não muda nada', () => {
    const first = run();
    const again = run({ journal: first.journal, fileSha256: new Map([...onTop53Sha, [T0159, sha(BODY)]]) });
    expect(again.changed).toBe(false);
    expect(again.journal).toBe(first.journal);
  });

  it('a branch SOZINHA nunca recebe a 0159 (faltam as 0136–0142 do #53)', () => {
    expect(refusal({ journal: alone, fileSha256: new Map([...realSha].filter(([t]) => aloneTags.has(t))) })).toMatch(
      /só entra com 0136_trial_resource_limits do #53/u,
    );
  });

  it('SQL com um byte diferente, com CR ou fora do release-manifest é recusado', () => {
    expect(refusal({ frozenSql: BODY.replace('1', '2') })).toMatch(/≠ release-manifest do #53/u);
    expect(refusal({ frozenSql: BODY.replace(/\n/gu, '\r\n') })).toMatch(/tem CR/u);
    expect(
      refusal({ releaseManifest: { ...RELEASE, financialSql: { sha256: sha(BODY) }, financialEntry: { ...RELEASE.financialEntry, when: PIN.when + 1 } } }),
    ).toMatch(/difere da fixada/u);
    expect(refusal({ releaseManifest: { ...RELEASE, financialSql: { sha256: sha('outro') } }, frozenSql: 'outro' })).toMatch(
      /≠ fixado no manifesto de composição/u,
    );
  });

  it('migration do #53 alterada depois de aplicada (0138 com outro conteúdo) é recusada', () => {
    expect(refusal({ fileSha256: new Map([...onTop53Sha, ['0138_saas_gateway_bindings', 'outro']]) })).toMatch(
      /0138_saas_gateway_bindings: arquivo ausente ou diferente/u,
    );
  });

  it('idx 159 já ocupado por outra migration, ou arquivo da 0159 sem linha no journal: recusado', () => {
    const squatter = { idx: 159, version: '7', when: PIN.when, tag: '0159_outra_coisa', breakpoints: true };
    expect(
      refusal({ journal: { ...onTop53, entries: [...onTop53.entries, squatter].sort((a, b) => a.idx - b.idx) } }),
    ).toMatch(/idx 159 já ocupado/u);
    expect(refusal({ fileSha256: new Map([...onTop53Sha, [T0159, sha(BODY)]]) })).toMatch(/sem a linha no journal/u);
  });

  it('journal que sairia fora do gate de ordem (migration duplicada) é recusado', () => {
    const e150 = onTop53.entries.find((x) => x.idx === 150)!;
    const dup = { ...onTop53, entries: [...onTop53.entries, { ...e150 }].sort((a, b) => a.idx - b.idx) };
    expect(refusal({ journal: dup })).toMatch(/não passa no gate de ordem/u);
  });
});
