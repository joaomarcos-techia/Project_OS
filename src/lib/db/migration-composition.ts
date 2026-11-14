/**
 * Guarda de COMPOSIÇÃO das migrations entre branches que nasceram da mesma `main` e criaram
 * migrations em paralelo (#53 billing e #55 convênios; coordenacao-migrations §12).
 *
 * Por que existe: o migrador do Drizzle (o mesmo de `drizzle-kit migrate`) não olha o nome nem o
 * `idx` — ele lê o `created_at` da ÚLTIMA linha de `drizzle.__drizzle_migrations` e aplica só as
 * entradas do journal com `when` MAIOR. Uma migration que chega ao journal com `when` menor do que
 * a última aplicada é PULADA EM SILÊNCIO, e o código sobe acreditando num schema que o banco não
 * tem. Foi o risco declarado no ciclo de 14/11: se a 0160 (R54, `when` 1795123373857) for aplicada
 * num banco antes da 0159 do #53 (`when` 1795036973858), a 0159 nunca mais entra.
 *
 * Este módulo é PURO (sem banco, sem disco): recebe o journal com o sha256 de cada arquivo, o
 * ledger lido do banco, o manifesto de composição e a presença dos objetos-sentinela, e devolve a
 * lista de problemas e o que o migrador aplicaria. Quem chama decide: o migrador de produção recusa
 * qualquer problema; o de DEV aceita, explicitamente, uma migration externa já aplicada cujo hash
 * bate com o fixado no manifesto.
 *
 * O hash é o MESMO do Drizzle: sha256 do texto do arquivo `.sql` (drizzle-orm `readMigrationFiles`).
 */

export interface CompositionJournalEntry {
  idx: number;
  when: number;
  tag: string;
  /** sha256 do arquivo `<tag>.sql` (ausente = arquivo não encontrado). */
  sha256?: string | undefined;
}

export interface CompositionLedgerRow {
  hash: string;
  /** `created_at` do ledger do Drizzle (bigint), como texto. */
  createdAt: string;
}

export interface PinnedMigration {
  tag: string;
  idx: number;
  when: number;
  sha256: string;
  /** Branch/PR dono do arquivo. */
  owner: string;
  /** Migrations que precisam estar no journal ANTES desta (por `when`) sempre que esta existir. */
  requires: readonly string[];
  /**
   * Objeto que só existe depois desta migration, para conferir o estado do schema:
   * `relation:<schema>.<nome>` (to_regclass) ou `function:<schema>.<nome>(<tipos>)` (to_regprocedure).
   * Ausente quando a migration só mexe em privilégios ou dados.
   */
  sentinel?: string;
}

export interface CompositionManifest {
  version: 1;
  /**
   * A partir deste idx, linha do ledger com hash diferente do arquivo BLOQUEIA. Antes dele a
   * divergência vira aviso (`warnings`): é história anterior às branches paralelas, que o
   * Drizzle nunca relê (no DEV, 3 linhas batem com o mesmo arquivo em CRLF e 3 com nenhuma
   * variante — ver docs/convenios/coordenacao-migrations.md §13). Fixadas são sempre estritas.
   */
  hashStrictFromIdx: number;
  pinned: readonly PinnedMigration[];
}

export type CompositionProblemCode =
  | 'JOURNAL_DUPLICATE'
  | 'JOURNAL_IDX_MISMATCH'
  | 'JOURNAL_IDX_GAP'
  | 'JOURNAL_WHEN_ORDER'
  | 'JOURNAL_FILE_MISSING'
  | 'PINNED_WHEN_MISMATCH'
  | 'PINNED_HASH_MISMATCH'
  | 'REQUIRED_MISSING'
  | 'DEPENDENCY_ORDER'
  | 'APPLIED_UNKNOWN'
  | 'APPLIED_HASH_MISMATCH'
  | 'WOULD_SKIP'
  | 'SCHEMA_STATE';

export interface CompositionProblem {
  code: CompositionProblemCode;
  /** Migration envolvida (tag do journal/manifesto ou `created_at` do ledger). */
  subject: string;
  detail: string;
}

export interface CompositionPlan {
  problems: CompositionProblem[];
  /** Divergências que não bloqueiam (hash histórico antes de `hashStrictFromIdx`). */
  warnings: CompositionProblem[];
  /** O que o migrador do Drizzle aplicaria (`when` > última linha do ledger), na ordem do journal. */
  pending: string[];
  /** Linhas do ledger reconhecidas no journal, por tag. */
  applied: string[];
  /** `created_at` da última linha do ledger (null = ledger vazio ou ausente). */
  lastAppliedAt: string | null;
}

export interface CompositionInput {
  journal: readonly CompositionJournalEntry[];
  manifest: CompositionManifest;
  /** Ledger do banco-alvo; omitido = só a checagem do journal (sem banco). */
  ledger?: readonly CompositionLedgerRow[];
  /** Sentinelas do manifesto que existem no banco; omitido = não confere o schema. */
  presentSentinels?: ReadonlySet<string>;
}

/** Exceção EXPLÍCITA para o DEV: migration de outra branch já aplicada com o hash fixado. */
export interface CompositionAllowance {
  tag: string;
  codes: readonly CompositionProblemCode[];
}

const pad4 = (n: number) => String(n).padStart(4, '0');

export function planComposition(input: CompositionInput): CompositionPlan {
  const { journal, manifest } = input;
  const problems: CompositionProblem[] = [];
  const warnings: CompositionProblem[] = [];
  const add = (code: CompositionProblemCode, subject: string, detail: string) =>
    problems.push({ code, subject, detail });

  // 1. O journal em si: único, idx = prefixo, contíguo, `when` estritamente crescente.
  const seenTag = new Set<string>();
  const seenIdx = new Set<number>();
  const seenWhen = new Set<number>();
  journal.forEach((e, i) => {
    if (seenTag.has(e.tag) || seenIdx.has(e.idx) || seenWhen.has(e.when)) {
      add('JOURNAL_DUPLICATE', e.tag, `tag, idx ou when repetido (idx ${e.idx}, when ${e.when})`);
    }
    seenTag.add(e.tag);
    seenIdx.add(e.idx);
    seenWhen.add(e.when);
    if (!e.tag.startsWith(`${pad4(e.idx)}_`)) {
      add('JOURNAL_IDX_MISMATCH', e.tag, `idx ${e.idx} não casa com o prefixo do arquivo`);
    }
    if (e.sha256 === undefined) add('JOURNAL_FILE_MISSING', e.tag, 'entrada sem arquivo .sql');
    const prev = journal[i - 1];
    if (prev) {
      if (e.idx <= prev.idx) {
        add('JOURNAL_IDX_GAP', e.tag, `idx ${e.idx} depois de ${prev.idx} (${prev.tag})`);
      }
      // Um problema por número ausente; o sujeito é a migration fixada com aquele idx (exceção
      // nomeável no DEV) ou o próprio número.
      for (let missing = prev.idx + 1; missing < e.idx; missing += 1) {
        const pinned = manifest.pinned.find((p) => p.idx === missing);
        add(
          'JOURNAL_IDX_GAP',
          pinned?.tag ?? `idx ${pad4(missing)}`,
          `falta ${pad4(missing)} entre ${prev.tag} e ${e.tag}`,
        );
      }
      if (e.when <= prev.when) {
        add(
          'JOURNAL_WHEN_ORDER',
          e.tag,
          `when ${e.when} não é maior que ${prev.when} (${prev.tag})`,
        );
      }
    }
  });

  const byTag = new Map(journal.map((e) => [e.tag, e]));
  const byWhen = new Map(journal.map((e) => [String(e.when), e]));
  const pinnedByTag = new Map(manifest.pinned.map((p) => [p.tag, p]));
  const pinnedByWhen = new Map(manifest.pinned.map((p) => [String(p.when), p]));

  // 2. Ledger do banco (quando lido).
  const ledger = input.ledger ?? [];
  const appliedWhen = new Set(ledger.map((r) => r.createdAt));
  const applied: string[] = [];
  for (const row of ledger) {
    const entry = byWhen.get(row.createdAt);
    if (!entry) {
      const pinned = pinnedByWhen.get(row.createdAt);
      add(
        'APPLIED_UNKNOWN',
        pinned?.tag ?? row.createdAt,
        pinned
          ? `aplicada no banco (${pinned.owner}, hash ${pinned.sha256 === row.hash ? 'igual ao fixado' : 'DIFERENTE do fixado'}) mas fora deste journal`
          : `linha do ledger com created_at ${row.createdAt} sem entrada no journal`,
      );
      continue;
    }
    applied.push(entry.tag);
    if (entry.sha256 !== undefined && entry.sha256 !== row.hash) {
      const strict = entry.idx >= manifest.hashStrictFromIdx || pinnedByTag.has(entry.tag);
      const problem = {
        code: 'APPLIED_HASH_MISMATCH' as const,
        subject: entry.tag,
        detail: strict
          ? 'o arquivo mudou depois de aplicado (hash do ledger ≠ arquivo)'
          : `hash histórico divergente (antes da ${pad4(manifest.hashStrictFromIdx)}): não bloqueia`,
      };
      (strict ? problems : warnings).push(problem);
    }
  }
  const lastAppliedAt =
    ledger.length > 0
      ? ledger.reduce(
          (m, r) => (BigInt(r.createdAt) > BigInt(m) ? r.createdAt : m),
          ledger[0]!.createdAt,
        )
      : null;
  const last = lastAppliedAt === null ? null : BigInt(lastAppliedAt);
  const pending: string[] = [];
  for (const e of journal) {
    if (last === null || BigInt(e.when) > last) {
      pending.push(e.tag);
    } else if (!appliedWhen.has(String(e.when))) {
      add(
        'WOULD_SKIP',
        e.tag,
        `when ${e.when} ≤ última aplicada (${lastAppliedAt}) e ausente do ledger: o Drizzle a pularia em silêncio`,
      );
    }
  }

  // 3. Manifesto: o que estiver presente (journal ou banco) precisa bater com o fixado e trazer
  //    as dependências antes dele.
  for (const p of manifest.pinned) {
    const entry = byTag.get(p.tag);
    const inDb = appliedWhen.has(String(p.when));
    if (entry) {
      if (entry.when !== p.when)
        add('PINNED_WHEN_MISMATCH', p.tag, `when ${entry.when} ≠ fixado ${p.when}`);
      if (entry.idx !== p.idx)
        add('PINNED_WHEN_MISMATCH', p.tag, `idx ${entry.idx} ≠ fixado ${p.idx}`);
      if (entry.sha256 !== undefined && entry.sha256 !== p.sha256) {
        add('PINNED_HASH_MISMATCH', p.tag, `sha256 do arquivo ≠ fixado (${p.owner})`);
      }
    }
    if (!entry && !inDb) continue;
    for (const dep of p.requires) {
      const d = byTag.get(dep);
      if (!d) {
        add(
          'REQUIRED_MISSING',
          dep,
          `${p.tag} exige ${dep} (${pinnedByTag.get(dep)?.owner ?? 'outra branch'}) no journal antes dela`,
        );
      } else if (d.when >= (entry?.when ?? p.when)) {
        add('DEPENDENCY_ORDER', dep, `${dep} precisa de when menor que ${p.tag}`);
      }
    }
  }

  // 4. Estado do schema: sentinela presente ⇔ migration fixada aplicada.
  if (input.presentSentinels && input.ledger) {
    for (const p of manifest.pinned) {
      if (!p.sentinel) continue;
      const inDb = appliedWhen.has(String(p.when));
      const present = input.presentSentinels.has(p.sentinel);
      if (inDb && !present) {
        add('SCHEMA_STATE', p.tag, `aplicada no ledger, mas ${p.sentinel} não existe`);
      } else if (!inDb && present) {
        add('SCHEMA_STATE', p.tag, `${p.sentinel} existe sem a linha da migration no ledger`);
      }
    }
  }

  return { problems, warnings, pending, applied, lastAppliedAt };
}

/** Problemas que sobram depois das exceções explícitas. */
export function blockingProblems(
  plan: CompositionPlan,
  allowances: readonly CompositionAllowance[] = [],
): CompositionProblem[] {
  return plan.problems.filter(
    (p) => !allowances.some((a) => a.codes.includes(p.code) && problemTouches(p, a.tag)),
  );
}

function problemTouches(p: CompositionProblem, tag: string): boolean {
  return p.subject === tag;
}

export class MigrationCompositionError extends Error {
  constructor(readonly problems: readonly CompositionProblem[]) {
    super(
      `composição de migrations recusada (${problems.length}):\n` +
        problems.map((p) => `  - ${p.code} ${p.subject}: ${p.detail}`).join('\n'),
    );
    this.name = 'MigrationCompositionError';
  }
}

export function assertComposition(
  plan: CompositionPlan,
  allowances: readonly CompositionAllowance[] = [],
): void {
  const blocking = blockingProblems(plan, allowances);
  if (blocking.length > 0) throw new MigrationCompositionError(blocking);
}
