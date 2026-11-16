/**
 * Guarda de composição das migrations (#53 × #55): unidade do planejador puro e o estado REAL do
 * journal desta branch. A prova contra Postgres descartável com o migrador real do Drizzle está em
 * scripts/security/migration-composition-db.ts.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type CompositionJournalEntry,
  type CompositionManifest,
  MigrationCompositionError,
  assertComposition,
  blockingProblems,
  planComposition,
} from './migration-composition';
import { MIGRATION_COMPOSITION_MANIFEST } from './migration-composition.manifest';

const M: CompositionManifest = {
  version: 1,
  hashStrictFromIdx: 1,
  pinned: [
    {
      tag: '0002_c',
      idx: 2,
      when: 300,
      sha256: 'h2',
      owner: 'A',
      requires: [],
      sentinel: 'relation:public.c',
    },
    {
      tag: '0003_d',
      idx: 3,
      when: 400,
      sha256: 'h3',
      owner: 'B',
      requires: ['0002_c'],
      sentinel: 'relation:public.d',
    },
    {
      tag: '0004_e',
      idx: 4,
      when: 500,
      sha256: 'h4',
      owner: 'A',
      requires: ['0003_d'],
      sentinel: 'relation:public.e',
    },
  ],
};
const e = (idx: number, when: number, sha256 = `h${idx}`): CompositionJournalEntry => ({
  idx,
  when,
  tag: `${String(idx).padStart(4, '0')}_${'abcde'[idx]}`,
  sha256,
});
const FULL = [e(0, 100), e(1, 200), e(2, 300), e(3, 400), e(4, 500)];
const row = (when: number, hash: string) => ({ createdAt: String(when), hash });
const codes = (p: ReturnType<typeof planComposition>) =>
  p.problems.map((x) => `${x.code}:${x.subject}`);

describe('planComposition — journal', () => {
  it('journal completo e coerente: nada a reclamar, tudo pendente num banco vazio', () => {
    const plan = planComposition({ journal: FULL, manifest: M, ledger: [] });
    expect(plan.problems).toEqual([]);
    expect(plan.pending).toEqual(FULL.map((x) => x.tag));
  });

  it('migration ausente (lacuna de idx) nomeia a fixada e a dependência faltante', () => {
    const plan = planComposition({
      journal: [e(0, 100), e(1, 200), e(2, 300), e(4, 500)],
      manifest: M,
    });
    expect(codes(plan)).toEqual(['JOURNAL_IDX_GAP:0003_d', 'REQUIRED_MISSING:0003_d']);
  });

  it('ordem incorreta de `when` e dependência fora de ordem', () => {
    const plan = planComposition({
      journal: [e(0, 100), e(1, 200), e(2, 300), e(3, 600), e(4, 500)],
      manifest: M,
    });
    expect(codes(plan)).toEqual(
      expect.arrayContaining([
        'JOURNAL_WHEN_ORDER:0004_e',
        'PINNED_WHEN_MISMATCH:0003_d',
        'DEPENDENCY_ORDER:0003_d',
      ]),
    );
  });

  it('hash divergente do fixado e arquivo ausente', () => {
    const plan = planComposition({
      journal: [
        e(0, 100),
        e(1, 200),
        e(2, 300),
        e(3, 400, 'outro'),
        { ...e(4, 500), sha256: undefined },
      ],
      manifest: M,
    });
    expect(codes(plan)).toEqual(['JOURNAL_FILE_MISSING:0004_e', 'PINNED_HASH_MISMATCH:0003_d']);
  });

  it('idx que não casa com o prefixo e duplicata', () => {
    const plan = planComposition({
      journal: [
        e(0, 100),
        { ...e(1, 200), tag: '0009_b' },
        e(2, 300),
        e(3, 400),
        e(4, 500),
        { ...e(4, 600), idx: 5 },
      ],
      manifest: M,
    });
    expect(codes(plan)).toEqual(
      expect.arrayContaining(['JOURNAL_IDX_MISMATCH:0009_b', 'JOURNAL_DUPLICATE:0004_e']),
    );
  });
});

describe('planComposition — contra o ledger do banco', () => {
  it('composição correta aplicada até 0002: pendentes 0003 e 0004', () => {
    const plan = planComposition({
      journal: FULL,
      manifest: M,
      ledger: [row(100, 'h0'), row(200, 'h1'), row(300, 'h2')],
      presentSentinels: new Set(['relation:public.c']),
    });
    expect(plan.problems).toEqual([]);
    expect(plan.pending).toEqual(['0003_d', '0004_e']);
    expect(plan.applied).toEqual(['0000_a', '0001_b', '0002_c']);
  });

  it('composição INCORRETA: 0004 aplicada antes da 0003 → o Drizzle pularia a 0003 em silêncio', () => {
    const plan = planComposition({
      journal: FULL,
      manifest: M,
      ledger: [row(100, 'h0'), row(200, 'h1'), row(300, 'h2'), row(500, 'h4')],
      presentSentinels: new Set(['relation:public.c', 'relation:public.e']),
    });
    expect(codes(plan)).toEqual(['WOULD_SKIP:0003_d']);
    expect(plan.pending).toEqual([]);
    expect(() => assertComposition(plan)).toThrow(MigrationCompositionError);
  });

  it('linha do ledger fora do journal, hash aplicado diferente e schema inesperado', () => {
    const plan = planComposition({
      journal: [e(0, 100), e(1, 200), e(2, 300)],
      manifest: M,
      ledger: [row(100, 'h0'), row(200, 'mudou'), row(300, 'h2'), row(400, 'h3')],
      presentSentinels: new Set(['relation:public.c', 'relation:public.e']),
    });
    expect(codes(plan)).toEqual(
      expect.arrayContaining([
        'APPLIED_HASH_MISMATCH:0001_b',
        'APPLIED_UNKNOWN:0003_d',
        'SCHEMA_STATE:0003_d',
        'SCHEMA_STATE:0004_e',
      ]),
    );
  });

  it('hash divergente ANTES de hashStrictFromIdx vira aviso; depois dele bloqueia', () => {
    const plan = planComposition({
      journal: FULL,
      manifest: M,
      ledger: [row(100, 'crlf'), row(200, 'h1'), row(300, 'h2')],
    });
    expect(plan.problems).toEqual([]);
    expect(plan.warnings.map((x) => `${x.code}:${x.subject}`)).toEqual([
      'APPLIED_HASH_MISMATCH:0000_a',
    ]);
    const strict = planComposition({
      journal: FULL,
      manifest: { ...M, hashStrictFromIdx: 0 },
      ledger: [row(100, 'crlf')],
    });
    expect(codes(strict)).toEqual(['APPLIED_HASH_MISMATCH:0000_a']);
  });

  it('a exceção do DEV só cobre os códigos e a migration nomeados', () => {
    const plan = planComposition({
      journal: [e(0, 100), e(1, 200), e(2, 300), e(4, 500)],
      manifest: M,
      ledger: [row(100, 'h0'), row(200, 'h1'), row(300, 'h2'), row(400, 'h3')],
      presentSentinels: new Set(['relation:public.c', 'relation:public.d']),
    });
    const allow = [
      { tag: '0003_d', codes: ['JOURNAL_IDX_GAP', 'REQUIRED_MISSING', 'APPLIED_UNKNOWN'] as const },
    ];
    expect(blockingProblems(plan, allow)).toEqual([]);
    expect(plan.pending).toEqual(['0004_e']);
    expect(blockingProblems(plan, [{ tag: '0002_c', codes: allow[0]!.codes }])).toHaveLength(3);
  });
});

describe('journal REAL desta branch', () => {
  const dir = resolve(process.cwd(), 'drizzle/migrations');
  const raw = JSON.parse(readFileSync(resolve(dir, 'meta/_journal.json'), 'utf8')) as {
    entries: { idx: number; when: number; tag: string }[];
  };
  const journal: CompositionJournalEntry[] = raw.entries.map((x) => {
    const file = resolve(dir, `${x.tag}.sql`);
    return {
      ...x,
      sha256: existsSync(file)
        ? createHash('sha256').update(readFileSync(file).toString()).digest('hex')
        : undefined,
    };
  });
  const pinned = (tag: string) => MIGRATION_COMPOSITION_MANIFEST.pinned.find((p) => p.tag === tag)!;
  const local = new Set(journal.map((x) => x.tag));
  const external = MIGRATION_COMPOSITION_MANIFEST.pinned.filter((p) => !local.has(p.tag));
  /** A união na ordem do DEV: esta branch + as fixadas do #53 (0136–0142 e 0159) com o hash fixado. */
  const composed = (): CompositionJournalEntry[] =>
    [
      ...journal,
      ...external.map((p) => ({ idx: p.idx, when: p.when, tag: p.tag, sha256: p.sha256 })),
    ].sort((a, b) => a.idx - b.idx);
  const externalAllowances = external.map((p) => ({
    tag: p.tag,
    codes: ['JOURNAL_IDX_GAP', 'REQUIRED_MISSING', 'APPLIED_UNKNOWN'] as const,
  }));

  it('as externas fixadas são exatamente as do #53 (0136–0142 e 0159)', () => {
    expect(external.map((p) => p.idx)).toEqual([136, 137, 138, 139, 140, 141, 142, 159]);
    expect(new Set(external.map((p) => p.owner))).toEqual(new Set(['PR #53 (billing AbacatePay)']));
  });

  it('as migrations fixadas desta branch não mudaram desde aplicadas no DEV (sha256)', () => {
    for (const tag of [
      '0143_tiss_catalog',
      '0158_hi_copay_charge',
      '0160_patient_external_refunds',
      '0161_hi_guide_consulta_overrides',
      '0162_hi_permission_matrix',
      '0163_hi_payout_reviews',
      '0164_hi_module_switch_guard',
    ]) {
      expect(journal.find((x) => x.tag === tag)?.sha256, tag).toBe(pinned(tag).sha256);
    }
  });

  it('a cauda 0143–0158 do #55 (a que o release do #53 congela) está fixada inteira e encadeada', () => {
    const tail = MIGRATION_COMPOSITION_MANIFEST.pinned.filter((p) => p.idx >= 143 && p.idx <= 158);
    expect(tail.map((p) => p.idx)).toEqual(Array.from({ length: 16 }, (_, i) => 143 + i));
    for (const [i, p] of tail.entries()) {
      expect(journal.find((x) => x.tag === p.tag)?.sha256, p.tag).toBe(p.sha256);
      if (i > 0) expect(p.requires, p.tag).toEqual([tail[i - 1]!.tag]);
    }
  });

  it('editar uma migration do MEIO da cauda (0150) é recusado já no journal, antes de qualquer banco', () => {
    const edited = composed().map((x) =>
      x.idx === 150 ? { ...x, sha256: createHash('sha256').update('-- editada').digest('hex') } : x,
    );
    const plan = planComposition({ journal: edited, manifest: MIGRATION_COMPOSITION_MANIFEST });
    expect(codes(plan)).toEqual([
      `PINNED_HASH_MISMATCH:${journal.find((x) => x.idx === 150)!.tag}`,
    ]);
  });

  it('SOZINHA, a branch é recusada: faltam as 0136–0142 e a 0159 do #53 (nunca migrar assim)', () => {
    const plan = planComposition({ journal, manifest: MIGRATION_COMPOSITION_MANIFEST });
    expect(codes(plan)).toEqual([
      ...external.map((p) => `JOURNAL_IDX_GAP:${p.tag}`),
      'REQUIRED_MISSING:0142_saas_review_replays',
      'REQUIRED_MISSING:0159_saas_period_snapshot',
    ]);
  });

  it('composta com as externas fixadas (ordem do DEV), passa sem exceção', () => {
    expect(
      planComposition({ journal: composed(), manifest: MIGRATION_COMPOSITION_MANIFEST }).problems,
    ).toEqual([]);
  });

  it('o ledger do DEV (externas com o hash fixado) passa só com as exceções explícitas', () => {
    const ledger = composed().map((x) => ({ createdAt: String(x.when), hash: x.sha256! }));
    const plan = planComposition({
      journal,
      manifest: MIGRATION_COMPOSITION_MANIFEST,
      ledger,
      presentSentinels: new Set(
        MIGRATION_COMPOSITION_MANIFEST.pinned.flatMap((p) => (p.sentinel ? [p.sentinel] : [])),
      ),
    });
    expect(plan.pending).toEqual([]);
    expect(new Set(blockingProblems(plan).map((x) => x.code))).toEqual(
      new Set(['APPLIED_UNKNOWN', 'JOURNAL_IDX_GAP', 'REQUIRED_MISSING']),
    );
    expect(blockingProblems(plan, externalAllowances)).toEqual([]);
    // Sem a exceção da 0159, ela continua bloqueando.
    expect(
      blockingProblems(
        plan,
        externalAllowances.filter((a) => a.tag !== '0159_saas_period_snapshot'),
      ).map((x) => `${x.code}:${x.subject}`),
    ).toEqual([
      'JOURNAL_IDX_GAP:0159_saas_period_snapshot',
      'APPLIED_UNKNOWN:0159_saas_period_snapshot',
      'REQUIRED_MISSING:0159_saas_period_snapshot',
    ]);
  });

  it('um banco de produção que recebesse a 0160 antes da 0159 ficaria com a 0159 pulada — recusado', () => {
    const union = composed();
    const ledger = union
      .filter((x) => x.tag !== '0159_saas_period_snapshot')
      .map((x) => ({ createdAt: String(x.when), hash: x.sha256! }));
    const plan = planComposition({
      journal: union,
      manifest: MIGRATION_COMPOSITION_MANIFEST,
      ledger,
    });
    expect(codes(plan)).toEqual(['WOULD_SKIP:0159_saas_period_snapshot']);
    expect(plan.pending).toEqual([]);
  });
});
