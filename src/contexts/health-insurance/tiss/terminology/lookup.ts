/**
 * Consulta à terminologia TUSS usada pelos validadores de guia.
 *
 * Interface síncrona de propósito: o validador é uma função pura. Quem chama
 * carrega antes o que precisa (as tabelas de domínio são pequenas; da tabela
 * 22 basta o código da guia) e entrega um `TerminologyLookup` pronto.
 */
import type { TerminologyTerm } from './official-sheet';

export interface TerminologyLookup {
  /** Versão da terminologia consultada (`AAAAMM`). */
  readonly version: string;
  /** Termo pelo código, ou `null` se a tabela não tiver o código. */
  term(table: string, code: string): TerminologyTerm | null;
}

/** Vigente na data (`AAAA-MM-DD`): começou e ainda não terminou. */
export function isTermEffectiveOn(term: TerminologyTerm, date: string): boolean {
  if (term.startsOn && date < term.startsOn) return false;
  if (term.endsOn && date > term.endsOn) return false;
  return true;
}

/** Lookup em memória a partir das tabelas já lidas (artefato ou banco). */
export function inMemoryLookup(
  version: string,
  tables: Record<string, readonly TerminologyTerm[]>,
): TerminologyLookup {
  const index = new Map<string, Map<string, TerminologyTerm>>();
  for (const [table, terms] of Object.entries(tables)) {
    index.set(table, new Map(terms.map((t) => [t.code, t])));
  }
  return {
    version,
    term: (table, code) => index.get(table)?.get(code) ?? null,
  };
}
