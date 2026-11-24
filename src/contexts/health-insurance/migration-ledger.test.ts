/**
 * Ordem das migrations na composição real com o #53 (D22, seção E.5 do plano mestre).
 *
 * O Drizzle escolhe o que falta aplicar pelo `when` do journal comparado ao
 * `created_at` da última linha de `drizzle.__drizzle_migrations`, não pelo nome
 * do arquivo. O #53 (billing) e o #55 (convênios) nasceram da mesma `main`
 * (última: 0135) e criaram migrations em paralelo. Este teste fixa o histórico
 * JÁ APLICADO no DEV compartilhado e prova que a união "main + #53 + #55" passa
 * no mesmo critério do gate do #53 (`assertMigrationJournalOrder`: idx contíguo,
 * prefixo = posição, `when` estritamente crescente).
 *
 * Vale nos DOIS estados legítimos do journal (src/lib/db/migration-journal-shape.ts):
 * a branch sozinha (sem as do #53) e a composição integrada (com todas elas, iguais
 * às fixadas). O que está no meio — só parte das do #53, uma delas alterada — é
 * recusado. A coordenação está em docs/convenios/coordenacao-migrations.md.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CompositionJournalEntry } from '@/lib/db/migration-composition';
import { MIGRATION_COMPOSITION_MANIFEST as MANIFEST } from '@/lib/db/migration-composition.manifest';
import { journalShape, pr53Pinned, withPr53 } from '@/lib/db/migration-journal-shape';

type Entry = { idx: number; when: number; tag: string };

const dir = resolve(process.cwd(), 'drizzle/migrations');
const journal: CompositionJournalEntry[] = (
  JSON.parse(readFileSync(resolve(dir, 'meta/_journal.json'), 'utf8')) as { entries: Entry[] }
).entries.map((x) => {
  const file = resolve(dir, `${x.tag}.sql`);
  return {
    idx: x.idx,
    when: x.when,
    tag: x.tag,
    sha256: existsSync(file)
      ? createHash('sha256').update(readFileSync(file).toString()).digest('hex')
      : undefined,
  };
});

/** As 7 migrations do #53, aplicadas no DEV (hash e `created_at` conferidos em 11/11/2026). */
const PR53_APPLIED_IN_DEV: readonly Entry[] = [
  { idx: 136, when: 1794096000000, tag: '0136_trial_resource_limits' },
  { idx: 137, when: 1794168300000, tag: '0137_trial_service_role_privileges' },
  { idx: 138, when: 1794171600000, tag: '0138_saas_gateway_bindings' },
  { idx: 139, when: 1794189600000, tag: '0139_saas_gateway_recontracts' },
  { idx: 140, when: 1794199882765, tag: '0140_saas_recurring_payment_observations' },
  { idx: 141, when: 1794222981810, tag: '0141_saas_scheduled_plan_changes' },
  { idx: 142, when: 1794326400000, tag: '0142_saas_review_replays' },
];
/**
 * A 0159 do #53 (SQL congelado no release-manifest dele) está APLICADA no DEV desde 13/11
 * (sha256 eb00a4e3…, `created_at` = `when` abaixo). Entra no journal na integração do #55 sobre o
 * #53 (scripts/integrate-pr53-0159.ts); por isso a faixa do convênio pula do 158 para o 160.
 */
const PR53_0159_APPLIED_IN_DEV: Entry = {
  idx: 159,
  when: 1795036973858,
  tag: '0159_saas_period_snapshot',
};
/** Última linha do DEV antes da cauda: o catálogo TISS. Número, conteúdo e versão lógica não mudam. */
const TISS_0143_APPLIED_IN_DEV = { idx: 143, when: 1794330000000, tag: '0143_tiss_catalog' };

/** Mesmo critério de `assertMigrationJournalOrder` (scripts/check-migration-safety.ts no #53). */
function orderProblems(entries: readonly Entry[]): string[] {
  const problems: string[] = [];
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    if (e.idx !== i) problems.push(`idx ${e.idx} na posição ${i}`);
    if (!e.tag.startsWith(`${String(i).padStart(4, '0')}_`))
      problems.push(`prefixo de ${e.tag} na posição ${i}`);
    if (prev && e.when <= prev.when)
      problems.push(`when de ${e.tag} não é maior que o de ${prev.tag}`);
  });
  return problems;
}

const shape = journalShape(journal, MANIFEST);
const pr53Tags = new Set(pr53Pinned(MANIFEST).map((p) => p.tag));
/** A união na ordem do DEV (main + #53 + #55): igual nos dois estados do journal. */
const union = withPr53(journal, MANIFEST);
/** A faixa do convênio: do 136 em diante, sem as do #53 (que podem ou não estar no journal). */
const tiss = journal.filter((e) => e.idx >= 136 && !pr53Tags.has(e.tag));

describe('ordem das migrations na composição com o #53 (D22)', () => {
  it('o journal é a branch sozinha OU a composição inteira; as do #53 presentes são as fixadas', () => {
    expect(shape.problems).toEqual([]);
    expect(['standalone', 'composed']).toContain(shape.mode);
    // As fixadas do #53 são as aplicadas no DEV, com os mesmos números, nomes e `when`.
    expect(pr53Pinned(MANIFEST).map(({ idx, when, tag }) => ({ idx, when, tag }))).toEqual([
      ...PR53_APPLIED_IN_DEV,
      PR53_0159_APPLIED_IN_DEV,
    ]);
  });

  it('a faixa do convênio começa na 0143 e é contígua, pulando só a 0159 do #53', () => {
    const expected = Array.from({ length: tiss.length + 1 }, (_, i) => 143 + i).filter(
      (idx) => idx !== 159,
    );
    expect(tiss.map((e) => e.idx)).toEqual(expected);
    // Exceções nominais: a 0155 corrige a função compartilhada do livro (R38, autorizada pelo
    // fundador em 12/11 nesta branch) e a 0160 guarda a evidência do estorno feito direto no
    // Asaas (R54, autorizada no ciclo de 14/11: "criar migrations necessárias").
    expect(tiss.filter((e) => !/^01\d\d_(?:tiss|hi)_/u.test(e.tag)).map((e) => e.tag)).toEqual([
      '0155_ledger_payment_sum_by_clinic',
      '0160_patient_external_refunds',
    ]);
  });

  it('a 0143 é a que está aplicada no DEV: mesmo número, nome e versão lógica', () => {
    expect(tiss[0]).toMatchObject(TISS_0143_APPLIED_IN_DEV);
  });

  it('a união main + #53 + #55 passa no gate de ordem do #53', () => {
    expect(orderProblems(union)).toEqual([]);
    expect(union).toHaveLength(journal.length + shape.absent.length);
  });

  it('sem a 0159 do #53 a união quebraria: a integração precisa trazê-la', () => {
    expect(orderProblems(union.filter((e) => e.idx !== 159)).length).toBeGreaterThan(0);
  });

  it('migration do convênio depois da 0159 nasce DEPOIS do que o DEV já aplicou', () => {
    for (const e of tiss.filter((x) => x.idx > 159)) {
      expect(e.when).toBeGreaterThan(PR53_0159_APPLIED_IN_DEV.when);
    }
  });

  it('nenhuma migration do convênio "nasce no passado" em relação ao DEV', () => {
    // Uma entrada com `when` <= último `created_at` do DEV seria ignorada pelo migrador.
    for (const e of tiss.slice(1)) expect(e.when).toBeGreaterThan(TISS_0143_APPLIED_IN_DEV.when);
    expect(TISS_0143_APPLIED_IN_DEV.when).toBeGreaterThan(PR53_APPLIED_IN_DEV.at(-1)!.when);
  });

  it('uma migration nova do #53 com número da faixa do convênio quebraria a ordem', () => {
    // Exemplo do risco: o #53 cria "0143_x" hoje (when atual) sem trazer a faixa do convênio.
    const collision = { idx: 143, when: Date.UTC(2026, 10, 11, 15), tag: '0143_saas_example' };
    const withCollision = [...union.filter((e) => e.idx < 143), collision, ...union.filter((e) => e.idx >= 143)];
    expect(orderProblems(withCollision).length).toBeGreaterThan(0);
  });
});

describe('o gate continua pegando os erros reais (mutações da união real)', () => {
  const at = (idx: number) => union.find((e) => e.idx === idx)!;

  it('migration ausente (a 0150 some do journal)', () => {
    expect(orderProblems(union.filter((e) => e.idx !== 150))).toContain('idx 151 na posição 150');
  });

  it('migration duplicada (a 0150 aparece duas vezes)', () => {
    const dup = [...union.filter((e) => e.idx <= 150), at(150), ...union.filter((e) => e.idx > 150)];
    expect(orderProblems(dup).length).toBeGreaterThan(0);
    expect(journalShape(dup, MANIFEST).problems).toContain('idx 150 aparece 2 vezes no journal');
  });

  it('sequência inválida (a 0151 com `when` igual ao da 0150)', () => {
    const bad = union.map((e) => (e.idx === 151 ? { ...e, when: at(150).when } : e));
    expect(orderProblems(bad)).toContain(
      `when de ${at(151).tag} não é maior que o de ${at(150).tag}`,
    );
  });

  it('alteração histórica de uma migration do #53 (outro `when`, outro conteúdo, outro nome)', () => {
    const when = union.map((e) => (e.idx === 138 ? { ...e, when: e.when + 1 } : e));
    expect(journalShape(when, MANIFEST).problems).toEqual([
      `0138_saas_gateway_bindings: when ${at(138).when + 1} ≠ fixado ${at(138).when}`,
    ]);
    const content = union.map((e) => (e.idx === 159 ? { ...e, sha256: 'outro' } : e));
    expect(journalShape(content, MANIFEST).problems).toEqual([
      '0159_saas_period_snapshot: conteúdo diferente do fixado pelo #53',
    ]);
    const renamed = union.map((e) => (e.idx === 159 ? { ...e, tag: '0159_outra_coisa' } : e));
    expect(journalShape(renamed, MANIFEST).problems).toContain(
      'idx 159 é 0159_outra_coisa, mas o #53 fixou 0159_saas_period_snapshot',
    );
  });

  it('composição parcial (o #53 integrado sem a 0159) não é estado legítimo', () => {
    const partial = union.filter((e) => e.idx !== 159);
    const s = journalShape(partial, MANIFEST);
    expect(s.mode).toBeNull();
    expect(s.problems.join(' ')).toMatch(/composição parcial: tem 136, 137, 138, 139, 140, 141, 142 do #53 e falta 159/u);
  });
});
