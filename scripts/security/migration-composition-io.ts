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
