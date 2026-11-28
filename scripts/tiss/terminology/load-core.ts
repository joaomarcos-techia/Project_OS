/**
 * Núcleo da carga da terminologia TUSS (P1.3), sem conexão própria: lê e confere os artefatos
 * e grava numa transação que quem chama abre. Usado pelo operador guardado do DEV (`load.ts`)
 * e pela medição de desempenho em Postgres descartável (P14.4). Mesmas garantias: SHA-256 de
 * cada arquivo, idempotência, competência publicada nunca sobrescrita, contagens conferidas.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

interface TerminologyManifest {
  version: string;
  archive: { url: string; sha256: string };
  tables: Record<string, { file: string; sha256: string; count: number }>;
}
interface TableFile {
  table: string;
  terms: Array<{
    code: string;
    term: string;
    startsOn: string | null;
    endsOn: string | null;
    implantationEndsOn: string | null;
    extra?: Record<string, string>;
  }>;
}

/** O mínimo do cliente `postgres` dentro de `sql.begin` (template + `json`). */
export interface TerminologyTx {
  <T = Array<Record<string, unknown>>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  json(value: never): unknown;
}

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

export type TerminologyArtifacts = ReturnType<typeof readTerminologyArtifacts>;

/** Lê e confere os artefatos antes de abrir qualquer conexão. */
export function readTerminologyArtifacts(version: string, root = process.cwd()) {
  const dir = path.resolve(root, 'data/tiss/terminologia', version);
  const manifestBytes = readFileSync(path.join(dir, 'MANIFEST.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as TerminologyManifest;
  if (manifest.version !== version) throw new Error(`manifesto é da versão ${manifest.version}`);
  const tables = Object.entries(manifest.tables).map(([table, info]) => {
    const bytes = readFileSync(path.join(dir, info.file));
    if (sha256(bytes) !== info.sha256) throw new Error(`${info.file}: SHA-256 não confere`);
    const parsed = JSON.parse(bytes.toString('utf8')) as TableFile;
    if (parsed.table !== table || parsed.terms.length !== info.count) {
      throw new Error(`${info.file}: conteúdo não bate com o manifesto`);
    }
    return { table, terms: parsed.terms, count: info.count };
  });
  const schemasRoot = path.resolve(root, 'src/contexts/health-insurance/tiss/schemas');
  const schemas = readdirSync(schemasRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({
      version: e.name,
      manifestSha256: sha256(readFileSync(path.join(schemasRoot, e.name, 'MANIFEST.json'))),
    }));
  return { version, manifest, manifestSha256: sha256(manifestBytes), tables, schemas };
}

/**
 * Grava a competência na transação aberta por quem chama. `onlyTables` restringe as tabelas
 * (medição da TUSS 22 sozinha); sem ele, todas, com a conferência de que nada sobra.
 */
export async function loadTerminologyTx(
  tx: TerminologyTx,
  a: TerminologyArtifacts,
  opts: { onlyTables?: readonly string[]; progress?: (m: string) => void } = {},
): Promise<{ tables: number; terms: number }> {
  const progress = opts.progress ?? (() => {});
  const tables = opts.onlyTables ? a.tables.filter((t) => opts.onlyTables!.includes(t.table)) : a.tables;
  await tx`
    INSERT INTO public.tiss_terminology_versions (version, archive_url, archive_sha256, manifest_sha256)
    VALUES (${a.version}, ${a.manifest.archive.url}, ${a.manifest.archive.sha256}, ${a.manifestSha256})
    ON CONFLICT (version) DO NOTHING`;
  const [row] = await tx<Array<{ id: string; manifest_sha256: string }>>`
    SELECT id, manifest_sha256 FROM public.tiss_terminology_versions WHERE version = ${a.version}`;
  if (!row) throw new Error('versão não gravada');
  if (row.manifest_sha256 !== a.manifestSha256) {
    throw new Error(`a competência ${a.version} já existe com outro conteúdo; competência publicada não é sobrescrita`);
  }

  // Um INSERT por tabela, com os termos num único parâmetro jsonb: menos idas ao banco.
  // `json(...)`, nunca `JSON.stringify(...)::jsonb`: o driver serializaria de novo e a string
  // viraria um escalar JSON ("cannot call jsonb_to_recordset on a non-array", 10/11).
  for (const { table, terms } of tables) {
    await tx`
      INSERT INTO public.tiss_terms
        (version_id, table_code, code, term, starts_on, ends_on, implantation_ends_on, extra)
      SELECT ${row.id}::uuid, ${table}, r.code, r.term,
             r."startsOn"::date, r."endsOn"::date, r."implantationEndsOn"::date, r.extra
        FROM jsonb_to_recordset(${tx.json(terms as never)})
          AS r(code text, term text, "startsOn" text, "endsOn" text, "implantationEndsOn" text, extra jsonb)
      ON CONFLICT DO NOTHING`;
  }
  progress('termos enviados');

  const counts = await tx<Array<{ table_code: string; n: number }>>`
    SELECT table_code, count(*)::int AS n FROM public.tiss_terms
     WHERE version_id = ${row.id} GROUP BY table_code`;
  const byTable = new Map(counts.map((c) => [c.table_code, Number(c.n)]));
  for (const { table, count } of tables) {
    if (byTable.get(table) !== count) {
      throw new Error(`tabela ${table}: banco tem ${byTable.get(table) ?? 0}, manifesto ${count}`);
    }
  }
  if (!opts.onlyTables && byTable.size !== tables.length) throw new Error('há tabelas no banco fora do manifesto');

  for (const s of a.schemas) {
    await tx`
      INSERT INTO public.tiss_schema_versions (version, manifest_sha256)
      VALUES (${s.version}, ${s.manifestSha256})
      ON CONFLICT (version) DO NOTHING`;
    const [existing] = await tx<Array<{ manifest_sha256: string }>>`
      SELECT manifest_sha256 FROM public.tiss_schema_versions WHERE version = ${s.version}`;
    if (existing?.manifest_sha256 !== s.manifestSha256) {
      throw new Error(`versão TISS ${s.version} já existe com outro manifesto`);
    }
  }
  const total = tables.reduce((sum, t) => sum + t.count, 0);
  progress(`conferido no banco: ${tables.length} tabelas, ${total} termos; versões TISS ${a.schemas.map((s) => s.version).join(', ')}`);
  return { tables: tables.length, terms: total };
}
