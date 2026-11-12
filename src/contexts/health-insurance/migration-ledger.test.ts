/**
 * Ordem das migrations depois do merge do #53 (D22, seção E.5 do plano mestre).
 *
 * O Drizzle escolhe o que falta aplicar pelo `when` do journal comparado ao
 * `created_at` da última linha de `drizzle.__drizzle_migrations`, não pelo nome
 * do arquivo. O #53 (billing) e o #55 (convênios) nasceram da mesma `main`
 * (última: 0135) e criaram migrations em paralelo. Este teste fixa o histórico
 * JÁ APLICADO no DEV compartilhado (lido em 11/11/2026, somente leitura: 144
 * linhas, hash e `created_at` iguais aos journals) e prova que a união
 * "main + #53 + #55" passa no mesmo critério do gate do #53
 * (`assertMigrationJournalOrder`: idx contíguo, prefixo = posição, `when`
 * estritamente crescente).
 *
 * Se o #53 criar outra migration antes do merge, o número dela colide com a
 * faixa do convênio (0143–0147): a coordenação está em
 * docs/convenios/coordenacao-migrations.md.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type Entry = { idx: number; when: number; tag: string };

const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/migrations/meta/_journal.json'), 'utf8'),
) as { entries: Entry[] };

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
/** Última linha do DEV: o catálogo TISS. Número, conteúdo e versão lógica não mudam. */
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

const base = journal.entries.filter((e) => e.idx <= 135);
const tiss = journal.entries.filter((e) => e.idx >= 136);

describe('ordem das migrations depois do merge do #53 (D22)', () => {
  it('esta branch só acrescenta a faixa do convênio, começando na 0143', () => {
    expect(tiss.map((e) => e.idx)).toEqual(Array.from({ length: tiss.length }, (_, i) => 143 + i));
    // Exceção única e nominal: a 0155 corrige a função compartilhada do livro (R38, autorizada
    // pelo fundador em 12/11 nesta branch, porque redefine o corpo que a 0153 estendeu).
    expect(tiss.filter((e) => !/^01\d\d_(?:tiss|hi)_/u.test(e.tag)).map((e) => e.tag)).toEqual([
      '0155_ledger_payment_sum_by_clinic',
    ]);
  });

  it('a 0143 é a que está aplicada no DEV: mesmo número, nome e versão lógica', () => {
    expect(tiss[0]).toMatchObject(TISS_0143_APPLIED_IN_DEV);
  });

  it('a união main + #53 + #55 passa no gate de ordem do #53', () => {
    expect(orderProblems([...base, ...PR53_APPLIED_IN_DEV, ...tiss])).toEqual([]);
  });

  it('nenhuma migration do convênio "nasce no passado" em relação ao DEV', () => {
    // Uma entrada com `when` <= último `created_at` do DEV seria ignorada pelo migrador.
    for (const e of tiss.slice(1)) expect(e.when).toBeGreaterThan(TISS_0143_APPLIED_IN_DEV.when);
    expect(TISS_0143_APPLIED_IN_DEV.when).toBeGreaterThan(PR53_APPLIED_IN_DEV.at(-1)!.when);
  });

  it('uma migration nova do #53 com número da faixa do convênio quebraria a ordem', () => {
    // Exemplo do risco: o #53 cria "0143_x" hoje (when atual) sem trazer a faixa do convênio.
    const collision = { idx: 143, when: Date.UTC(2026, 10, 11, 15), tag: '0143_saas_example' };
    const union = [...base, ...PR53_APPLIED_IN_DEV, collision, ...tiss];
    expect(orderProblems(union).length).toBeGreaterThan(0);
  });
});
