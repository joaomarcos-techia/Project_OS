/**
 * Formato do journal desta branch em relação às migrations do PR #53 (billing AbacatePay).
 *
 * O journal do #55 existe em DOIS estados legítimos:
 *   - `standalone`: a branch sozinha (base `main`), SEM as 0136–0142 e a 0159 do #53;
 *   - `composed`: depois de integrada na ordem real (#53 → #56 → #55), COM todas elas, cada uma
 *     com o mesmo idx, `when`, tag e sha256 fixados no manifesto de composição (os valores
 *     aplicados no DEV e congelados no `release-manifest.json` do #53).
 *
 * Qualquer outro estado é problema nomeado: só parte das do #53 (composição parcial, por exemplo a
 * branch rebaseada sobre o #53 sem a 0159), entrada do #53 com outro `when`, nome ou conteúdo
 * (histórico alterado), outra migration ocupando um idx do #53, entrada duplicada.
 *
 * Não lê disco nem banco: os testes e os scripts passam o journal (com o sha256 de cada arquivo).
 */
import type { CompositionJournalEntry, CompositionManifest, PinnedMigration } from './migration-composition';

export const PR53_OWNER = 'PR #53 (billing AbacatePay)';

export type JournalShapeMode = 'standalone' | 'composed';

export interface JournalShape {
  /** `null` quando o journal não é nenhum dos dois estados legítimos (ver `problems`). */
  mode: JournalShapeMode | null;
  /** Fixadas do #53 presentes no journal. */
  present: PinnedMigration[];
  /** Fixadas do #53 ausentes do journal (as que a integração com o #53 traz). */
  absent: PinnedMigration[];
  problems: string[];
}

/** As migrations do #53 fixadas no manifesto (0136–0142 e 0159), em ordem de idx. */
export function pr53Pinned(manifest: CompositionManifest): PinnedMigration[] {
  return manifest.pinned.filter((p) => p.owner === PR53_OWNER).sort((a, b) => a.idx - b.idx);
}

export function journalShape(
  journal: readonly CompositionJournalEntry[],
  manifest: CompositionManifest,
): JournalShape {
  const pins = pr53Pinned(manifest);
  const problems: string[] = [];
  const seen = new Map<number, number>();
  for (const e of journal) seen.set(e.idx, (seen.get(e.idx) ?? 0) + 1);
  for (const [idx, n] of seen) if (n > 1) problems.push(`idx ${idx} aparece ${n} vezes no journal`);

  const present: PinnedMigration[] = [];
  const absent: PinnedMigration[] = [];
  for (const p of pins) {
    const byIdx = journal.filter((e) => e.idx === p.idx);
    const byTag = journal.filter((e) => e.tag === p.tag);
    if (byIdx.length === 0 && byTag.length === 0) {
      absent.push(p);
      continue;
    }
    present.push(p);
    const e = byIdx[0] ?? byTag[0]!;
    if (e.tag !== p.tag) problems.push(`idx ${p.idx} é ${e.tag}, mas o #53 fixou ${p.tag}`);
    if (e.idx !== p.idx) problems.push(`${p.tag} está no idx ${e.idx}, fixado no ${p.idx}`);
    if (e.when !== p.when) problems.push(`${p.tag}: when ${e.when} ≠ fixado ${p.when}`);
    if (e.sha256 === undefined) problems.push(`${p.tag}: arquivo ausente`);
    else if (e.sha256 !== p.sha256) problems.push(`${p.tag}: conteúdo diferente do fixado pelo #53`);
  }
  let mode: JournalShapeMode | null = null;
  if (present.length === 0) mode = 'standalone';
  else if (absent.length === 0) mode = 'composed';
  else
    problems.push(
      `composição parcial: tem ${present.map((p) => p.idx).join(', ')} do #53 e falta ${absent
        .map((p) => p.idx)
        .join(', ')} (rode scripts/integrate-pr53-0159.ts depois de integrar o #53)`,
    );
  return { mode: problems.length === 0 ? mode : null, present, absent, problems };
}

/**
 * A união na ordem do DEV: o journal + as fixadas do #53 que ele ainda não tem, com os valores
 * fixados. Para um journal `composed` devolve o próprio journal (ordenado por idx).
 */
export function withPr53(
  journal: readonly CompositionJournalEntry[],
  manifest: CompositionManifest,
): CompositionJournalEntry[] {
  const { absent } = journalShape(journal, manifest);
  return [
    ...journal,
    ...absent.map((p) => ({ idx: p.idx, when: p.when, tag: p.tag, sha256: p.sha256 })),
  ].sort((a, b) => a.idx - b.idx);
}

/** O journal sem nenhuma das fixadas do #53 (o estado da branch sozinha). */
export function withoutPr53(
  journal: readonly CompositionJournalEntry[],
  manifest: CompositionManifest,
): CompositionJournalEntry[] {
  const tags = new Set(pr53Pinned(manifest).map((p) => p.tag));
  const idxs = new Set(pr53Pinned(manifest).map((p) => p.idx));
  return journal.filter((e) => !tags.has(e.tag) && !idxs.has(e.idx));
}
