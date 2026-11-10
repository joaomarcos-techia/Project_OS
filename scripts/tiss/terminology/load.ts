/**
 * Carrega a terminologia TUSS versionada (artefatos de `data/tiss/terminologia`)
 * e as versões de comunicação TISS (manifestos dos XSDs) nas tabelas globais
 * `tiss_*` (P1.3 do QORO_TISS_MASTER_PLAN.md).
 *
 * Garantias:
 *  - confere o SHA-256 de cada arquivo contra o MANIFEST antes de gravar;
 *  - idempotente: rodar de novo não duplica (ON CONFLICT DO NOTHING);
 *  - recusa sobrescrever uma competência já carregada com conteúdo diferente;
 *  - confere as contagens por tabela no fim, dentro da mesma transação;
 *  - só DEV, e só no projeto que o operador nomear (`--expected-ref`).
 *    Produção segue o runbook de publicação (P15.7), nunca este atalho.
 *
 * Por que conexão própria e não `dbAdmin`: o DEV compartilhado fica em outra
 * região e leva ~10–16 s para aceitar conexão daqui; o pool do app tem
 * `connect_timeout` de 10 s e falha antes. Script one-shot e guardado, na
 * lista de exceções do lint e do `arch-db-check` (mesmo padrão do
 * `run-signup-recovery-dev.ts`).
 *
 * Uso:
 *   npx tsx scripts/tiss/terminology/load.ts --version 202609 --expected-ref <ref do projeto DEV>
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import postgres from 'postgres';

import { assertDevContext } from '../../_env';

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

const startedAt = Date.now();
function progress(message: string): void {
  console.log(
    `[tiss:terminology:load] ${((Date.now() - startedAt) / 1000).toFixed(1)}s ${message}`,
  );
}

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Lê e confere os artefatos antes de abrir qualquer conexão. */
function readArtifacts(version: string) {
  const dir = path.resolve('data/tiss/terminologia', version);
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
  const schemasRoot = path.resolve('src/contexts/health-insurance/tiss/schemas');
  const schemas = readdirSync(schemasRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({
      version: e.name,
      manifestSha256: sha256(readFileSync(path.join(schemasRoot, e.name, 'MANIFEST.json'))),
    }));
  return { manifest, manifestSha256: sha256(manifestBytes), tables, schemas };
}

async function main(): Promise<void> {
  const { databaseUrl } = assertDevContext();
  const version = arg('version');
  const expectedRef = arg('expected-ref');
  if (!version || !/^\d{6}$/u.test(version)) throw new Error('--version AAAAMM é obrigatório');
  if (!expectedRef || !/^[a-z0-9]{20}$/u.test(expectedRef)) {
    throw new Error('--expected-ref <ref do projeto Supabase de destino> é obrigatório');
  }
  // No pooler do Supabase o projeto vem no usuário (`postgres.<ref>`); na
  // conexão direta, no host (`db.<ref>.supabase.co`).
  const target = new URL(databaseUrl);
  if (!target.username.endsWith(`.${expectedRef}`) && !target.hostname.includes(expectedRef)) {
    throw new Error('DATABASE_URL não aponta para o projeto informado em --expected-ref');
  }

  const { manifest, manifestSha256, tables, schemas } = readArtifacts(version);
  progress(`artefatos conferidos: ${tables.length} tabelas, ${schemas.length} versão(ões) TISS`);

  const sql = postgres(databaseUrl, {
    prepare: false,
    ssl: 'require',
    max: 1,
    connect_timeout: 45,
    idle_timeout: 30,
  });
  try {
    await sql.begin(async (tx) => {
      progress('conectado; transação aberta');
      await tx`
        INSERT INTO public.tiss_terminology_versions (version, archive_url, archive_sha256, manifest_sha256)
        VALUES (${version}, ${manifest.archive.url}, ${manifest.archive.sha256}, ${manifestSha256})
        ON CONFLICT (version) DO NOTHING`;
      const [row] = await tx<Array<{ id: string; manifest_sha256: string }>>`
        SELECT id, manifest_sha256 FROM public.tiss_terminology_versions WHERE version = ${version}`;
      if (!row) throw new Error('versão não gravada');
      if (row.manifest_sha256 !== manifestSha256) {
        throw new Error(
          `a competência ${version} já existe com outro conteúdo; competência publicada não é sobrescrita`,
        );
      }

      // Um INSERT por tabela, com os termos num único parâmetro jsonb: menos
      // idas ao banco, que custam centenas de ms cada daqui.
      //
      // `sql.json`, nunca `JSON.stringify(...)::jsonb`: o driver descobre que o
      // parâmetro é jsonb e serializa de novo, e a string já serializada vira
      // um escalar JSON ("cannot call jsonb_to_recordset on a non-array",
      // visto na primeira carga de 10/11).
      for (const { table, terms } of tables) {
        await tx`
          INSERT INTO public.tiss_terms
            (version_id, table_code, code, term, starts_on, ends_on, implantation_ends_on, extra)
          SELECT ${row.id}::uuid, ${table}, r.code, r.term,
                 r."startsOn"::date, r."endsOn"::date, r."implantationEndsOn"::date, r.extra
            FROM jsonb_to_recordset(${sql.json(terms as unknown as postgres.JSONValue)})
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
          throw new Error(
            `tabela ${table}: banco tem ${byTable.get(table) ?? 0}, manifesto ${count}`,
          );
        }
      }
      if (byTable.size !== tables.length) throw new Error('há tabelas no banco fora do manifesto');

      for (const s of schemas) {
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
      progress(
        `conferido no banco: ${tables.length} tabelas, ${total} termos; versões TISS ${schemas.map((s) => s.version).join(', ')}`,
      );
    });
    progress('transação confirmada');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('[tiss:terminology:load] FALHOU:', error instanceof Error ? error.message : error);
  process.exit(1);
});
