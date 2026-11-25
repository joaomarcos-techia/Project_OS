/**
 * Leitura do journal (com o sha256 de cada arquivo, igual ao do Drizzle) e do banco-alvo (ledger
 * `drizzle.__drizzle_migrations` + sentinelas do manifesto) para o guarda de composição puro
 * (`src/lib/db/migration-composition.ts`).
 *
 * Só LEITURA no banco. Usado pelo migrador de produção, pelo aplicador limitado do DEV e pelo
 * harness descartável `migration-composition-db.ts`. Recebe a conexão de quem chama (estrutural,
 * `unsafe`), sem abrir pool próprio.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  type CompositionAllowance,
  type CompositionJournalEntry,
  type CompositionLedgerRow,
  type CompositionManifest,
  type CompositionPlan,
  assertComposition,
  planComposition,
} from '@/lib/db/migration-composition';

/** O mínimo de um cliente postgres-js que o guarda usa. */
export interface ReadOnlySql {
  unsafe(query: string, params?: unknown[]): PromiseLike<readonly Record<string, unknown>[]>;
}

export function readJournalWithHashes(folder: string): CompositionJournalEntry[] {
  const journal = JSON.parse(readFileSync(path.join(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: { idx: number; when: number; tag: string }[];
  };
  return journal.entries.map((e) => {
    const file = path.join(folder, `${e.tag}.sql`);
    return {
      idx: e.idx,
      when: e.when,
      tag: e.tag,
      // Mesmo cálculo do drizzle-orm (`readMigrationFiles`): sha256 do texto do arquivo.
      sha256: existsSync(file)
        ? createHash('sha256').update(readFileSync(file).toString()).digest('hex')
        : undefined,
    };
  });
}

export async function readLedger(sql: ReadOnlySql): Promise<CompositionLedgerRow[]> {
  const [exists] = await sql.unsafe(
    `select to_regclass('drizzle.__drizzle_migrations') is not null as ok`,
  );
  if (!exists?.ok) return [];
  const rows = await sql.unsafe(
    `select hash, created_at::text as created_at from drizzle.__drizzle_migrations order by created_at, id`,
  );
  return rows.map((r) => ({ hash: String(r.hash), createdAt: String(r.created_at) }));
}

export async function readPresentSentinels(
  sql: ReadOnlySql,
  manifest: CompositionManifest,
): Promise<Set<string>> {
  const present = new Set<string>();
  for (const p of manifest.pinned) {
    if (!p.sentinel) continue;
    const m = /^(relation|function):(.+)$/u.exec(p.sentinel);
    if (!m) throw new Error(`sentinela inválida no manifesto: ${p.sentinel}`);
    const fn = m[1] === 'relation' ? 'to_regclass' : 'to_regprocedure';
    const [r] = await sql.unsafe(`select ${fn}($1) is not null as ok`, [m[2]]);
    if (r?.ok) present.add(p.sentinel);
  }
  return present;
}

export interface CompositionCheck {
  folder: string;
  manifest: CompositionManifest;
  /** Sem conexão = só o journal (pré-voo sem banco). */
  sql?: ReadOnlySql;
  allowances?: readonly CompositionAllowance[];
}

/**
 * Limites do pré-voo contra um banco real. `SET LOCAL` vale só dentro da transação: nada fica na
 * sessão do pooler (o vazamento de `SET` de sessão já aconteceu em 29/09).
 */
export const READ_ONLY_CHECK_LIMITS = {
  statementTimeout: '15s',
  lockTimeout: '2s',
  idleInTransactionTimeout: '30s',
} as const;

/** Rótulo da conexão do pré-voo (aparece em `pg_stat_activity`, para interromper com segurança). */
export const READ_ONLY_CHECK_APPLICATION_NAME = 'qoro-migrate-composition-check';

/**
 * O guarda contra o banco-alvo DENTRO de uma transação `READ ONLY` aberta por quem chama
 * (`client.begin('READ ONLY', (tx) => checkCompositionInReadOnlyTx(tx, ...))`).
 *
 * Fail-closed: confere `transaction_read_only = on` antes de qualquer leitura e recusa se não
 * estiver; com isso o PRÓPRIO Postgres recusa qualquer escrita (SQLSTATE 25006), não só o código
 * deste guarda. As únicas consultas são as de `readLedger` e `readPresentSentinels` (SELECT,
 * `to_regclass`/`to_regprocedure`) e os `SET LOCAL` dos limites acima.
 */
export async function checkCompositionInReadOnlyTx(
  tx: ReadOnlySql,
  check: Omit<CompositionCheck, 'sql'>,
): Promise<CompositionPlan> {
  const [mode] = await tx.unsafe(`select current_setting('transaction_read_only') as ro`);
  if (mode?.ro !== 'on') {
    throw new Error('pré-voo de composição fora de transação READ ONLY: recusado');
  }
  await tx.unsafe(`set local statement_timeout = '${READ_ONLY_CHECK_LIMITS.statementTimeout}'`);
  await tx.unsafe(`set local lock_timeout = '${READ_ONLY_CHECK_LIMITS.lockTimeout}'`);
  await tx.unsafe(
    `set local idle_in_transaction_session_timeout = '${READ_ONLY_CHECK_LIMITS.idleInTransactionTimeout}'`,
  );
  return checkComposition({ ...check, sql: tx });
}

/** Lê tudo, planeja e RECUSA (lança) se sobrar problema depois das exceções explícitas. */
export async function checkComposition(check: CompositionCheck): Promise<CompositionPlan> {
  const journal = readJournalWithHashes(check.folder);
  const plan = check.sql
    ? planComposition({
        journal,
        manifest: check.manifest,
        ledger: await readLedger(check.sql),
        presentSentinels: await readPresentSentinels(check.sql, check.manifest),
      })
    : planComposition({ journal, manifest: check.manifest });
  assertComposition(plan, check.allowances);
  return plan;
}

/**
 * Exceções do DEV para migrations de OUTRA branch já aplicadas no banco e ainda fora deste journal
 * (as 0136–0142 e a 0159 do #53 enquanto o #55 não as compõe). Cada exceção só é concedida se o
 * ledger tiver a linha com o `when` E o sha256 fixados no manifesto; uma fixada ausente do journal
 * e do banco continua bloqueando (REQUIRED_MISSING). Nunca usada no migrador de produção.
 */
export async function allowExternalApplied(
  sql: ReadOnlySql,
  manifest: CompositionManifest,
  folder: string,
): Promise<CompositionAllowance[]> {
  const local = new Set(readJournalWithHashes(folder).map((e) => e.tag));
  const ledger = await readLedger(sql);
  const allowances: CompositionAllowance[] = [];
  for (const pinned of manifest.pinned.filter((p) => !local.has(p.tag))) {
    const row = ledger.find((r) => r.createdAt === String(pinned.when));
    if (!row) continue;
    if (row.hash !== pinned.sha256) {
      throw new Error(`${pinned.tag} aplicada no banco com hash diferente do fixado`);
    }
    allowances.push({
      tag: pinned.tag,
      codes: ['JOURNAL_IDX_GAP', 'REQUIRED_MISSING', 'APPLIED_UNKNOWN'],
    });
  }
  return allowances;
}
