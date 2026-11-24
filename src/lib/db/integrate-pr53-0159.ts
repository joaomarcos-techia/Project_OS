/**
 * Integração da 0159 do PR #53 (`saas_period_snapshot`) no journal, NA ORDEM REAL (#53 → #56 → #55).
 *
 * Por que aqui e não no #53: a 0159 altera e cria tabelas do schema `billing_gateway` (0136–0142 do
 * #53) e precisa vir DEPOIS da cauda 0143–0158 do #55. Nenhuma branch sozinha a carrega contígua: o
 * gate de ordem do #53 (`assertMigrationJournalOrder`) recusa lacuna, e a cadeia só do #55 não tem o
 * `billing_gateway`. Ela entra quando o #55 é integrado sobre o #53, com os bytes CONGELADOS pelo
 * dono (`docs/decoupling/asaas-to-abacatepay/migrations/saas_period_snapshot.candidate.sql`) e a
 * linha do `release-manifest.json` dele. Nada é renumerado, nada é inventado e o SQL não muda.
 *
 * Recusa (lança `Integrate0159Error`):
 *   - SQL com sha256 diferente do manifesto do #53 ou do fixado no manifesto de composição;
 *   - linha do manifesto do #53 diferente da fixada (idx, tag, `when`);
 *   - journal sem as 0136–0142 do #53 exatamente como fixadas (a branch sozinha nunca recebe a 0159);
 *   - journal sem a 0158 e a 0160 do #55 em volta;
 *   - idx 159 já ocupado por outra coisa (ou pela 0159 com outro conteúdo);
 *   - resultado que não passa no mesmo critério do gate do #53 (idx contíguo, prefixo = posição,
 *     `when` estritamente crescente).
 * Idempotente: com a 0159 certa já no lugar, devolve `changed: false`.
 */
import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { CompositionManifest } from './migration-composition';
import { pr53Pinned } from './migration-journal-shape';

export const T0159 = '0159_saas_period_snapshot';

export class Integrate0159Error extends Error {
  override name = 'Integrate0159Error';
}

export interface DrizzleJournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}
export interface DrizzleJournal {
  version: string;
  dialect: string;
  entries: DrizzleJournalEntry[];
}

const releaseManifestSchema = z.object({
  financialEntry: z.object({
    idx: z.literal(159),
    version: z.string().min(1),
    breakpoints: z.boolean(),
    when: z.number().int().positive(),
    tag: z.literal(T0159),
  }),
  financialSql: z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/u) }),
});

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Mesmo critério do `assertMigrationJournalOrder` do #53. */
export function journalOrderProblems(entries: readonly { idx: number; when: number; tag: string }[]): string[] {
  const out: string[] = [];
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    if (e.idx !== i) out.push(`idx ${e.idx} na posição ${i}`);
    if (!e.tag.startsWith(`${String(i).padStart(4, '0')}_`)) out.push(`prefixo de ${e.tag} na posição ${i}`);
    if (prev && e.when <= prev.when) out.push(`when de ${e.tag} não é maior que o de ${prev.tag}`);
  });
  return out;
}

export function integratePr53Successor(input: {
  journal: DrizzleJournal;
  /** sha256 de cada arquivo `<tag>.sql` presente (para conferir as 0136–0142 e a 0159 já existente). */
  fileSha256: ReadonlyMap<string, string>;
  /** Bytes do SQL congelado do #53 (sem conversão de fim de linha). */
  frozenSql: string;
  /** `release-manifest.json` do #53, já lido. */
  releaseManifest: unknown;
  manifest: CompositionManifest;
}): { journal: DrizzleJournal; sql: string; changed: boolean } {
  const fail = (m: string): never => {
    throw new Integrate0159Error(m);
  };
  const parsed = releaseManifestSchema.safeParse(input.releaseManifest);
  if (!parsed.success) fail(`release-manifest do #53 inválido: ${parsed.error.issues[0]?.message ?? ''}`);
  const rm = parsed.data!;
  const pin = input.manifest.pinned.find((p) => p.tag === T0159) ?? fail('0159 ausente do manifesto de composição');

  const body = input.frozenSql;
  if (body.includes('\r')) fail('o SQL congelado tem CR: o hash do Drizzle mudaria (bytes do #53 são LF)');
  const bodySha = sha(body);
  if (bodySha !== rm.financialSql.sha256) fail(`sha256 do SQL (${bodySha}) ≠ release-manifest do #53`);
  if (bodySha !== pin.sha256) fail(`sha256 do SQL (${bodySha}) ≠ fixado no manifesto de composição`);
  if (rm.financialEntry.when !== pin.when || rm.financialEntry.idx !== pin.idx)
    fail('linha do release-manifest do #53 difere da fixada (idx/when)');

  const entries = input.journal.entries;
  for (const p of pr53Pinned(input.manifest).filter((x) => x.tag !== T0159)) {
    const e = entries.find((x) => x.idx === p.idx);
    if (!e || e.tag !== p.tag || e.when !== p.when)
      fail(`a 0159 só entra com ${p.tag} do #53 no journal, como fixada (integre o #53 antes)`);
    if (input.fileSha256.get(p.tag) !== p.sha256) fail(`${p.tag}: arquivo ausente ou diferente do fixado`);
  }
  for (const idx of [158, 160]) {
    const p = input.manifest.pinned.find((x) => x.idx === idx);
    const e = entries.find((x) => x.idx === idx);
    if (!p || !e || e.tag !== p.tag || e.when !== p.when) fail(`a 0159 precisa da ${p?.tag ?? idx} do #55 em volta`);
  }

  const existing = entries.filter((x) => x.idx === 159 || x.tag === T0159);
  if (existing.length > 0) {
    const e = existing[0]!;
    if (existing.length > 1 || e.tag !== T0159 || e.idx !== 159 || e.when !== pin.when)
      fail(`idx 159 já ocupado: ${existing.map((x) => `${x.idx}:${x.tag}`).join(', ')}`);
    if (input.fileSha256.get(T0159) !== pin.sha256) fail('a 0159 já está no journal com outro conteúdo');
    const order = journalOrderProblems(entries);
    if (order.length > 0) fail(`journal fora do gate de ordem: ${order[0]}`);
    return { journal: input.journal, sql: body, changed: false };
  }
  if (input.fileSha256.has(T0159)) fail('arquivo da 0159 existe sem a linha no journal');

  const next: DrizzleJournalEntry[] = [
    ...entries,
    {
      idx: rm.financialEntry.idx,
      version: rm.financialEntry.version,
      when: rm.financialEntry.when,
      tag: rm.financialEntry.tag,
      breakpoints: rm.financialEntry.breakpoints,
    },
  ].sort((a, b) => a.idx - b.idx);
  const order = journalOrderProblems(next);
  if (order.length > 0) fail(`o journal integrado não passa no gate de ordem: ${order.join('; ')}`);
  return { journal: { ...input.journal, entries: next }, sql: body, changed: true };
}
