import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0143_tiss_catalog.sql'),
  'utf8',
);
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/migrations/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string }> };

const TABLES = ['tiss_terminology_versions', 'tiss_terms', 'tiss_schema_versions'] as const;
/** SQL sem comentários: o cabeçalho cita o rollback ("DROP aprovado") de propósito. */
const statements = migration.replace(/--.*$/gmu, '');

describe('migration 0143 — catálogo global TISS/TUSS (P1.2)', () => {
  it('é aditiva: só cria tabelas, sem DROP, TRUNCATE, DELETE nem UPDATE', () => {
    expect(statements).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w)/iu);
    for (const table of TABLES) expect(migration).toContain(`CREATE TABLE public.${table}`);
  });

  it('não carrega terminologia: dado vem do script de carga, nunca de migration', () => {
    expect(migration).not.toMatch(/INSERT INTO public\.tiss_/u);
  });

  it.each(TABLES)('%s: RLS forçado, só leitura para authenticated', (table) => {
    expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    expect(migration).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);
    expect(migration).toMatch(
      new RegExp(
        `CREATE POLICY ${table}_read_authenticated ON public\\.${table}\\s+FOR SELECT TO authenticated USING \\(true\\)`,
        'u',
      ),
    );
  });

  it('tira o DML padrão do runtime e devolve só SELECT', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON public\.tiss_terminology_versions, public\.tiss_terms, public\.tiss_schema_versions\s+FROM anon, authenticated/u,
    );
    expect(migration).toMatch(
      /GRANT SELECT ON public\.tiss_terminology_versions, public\.tiss_terms, public\.tiss_schema_versions\s+TO authenticated, service_role/u,
    );
    expect(migration).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE|ALL)/u);
  });

  it('o termo não existe sem versão e a vigência é coerente', () => {
    expect(migration).toContain(
      'REFERENCES public.tiss_terminology_versions (id) ON DELETE RESTRICT',
    );
    expect(migration).toContain('PRIMARY KEY (version_id, table_code, code)');
    expect(migration).toContain('ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on');
  });

  it('entra no journal depois da última migration do billing já aplicada no DEV (0142)', () => {
    const entry = journal.entries.find((e) => e.tag === '0143_tiss_catalog');
    expect(entry).toBeDefined();
    // 0142_saas_review_replays (PR #53) foi gravada no DEV com when=1794326400000.
    // O migrador só aplica entradas com `when` maior que a última aplicada.
    expect(entry!.when).toBeGreaterThan(1_794_326_400_000);
    // idx = prefixo do arquivo (regra de migration-journal.test.ts); a 0144 vem depois.
    expect(entry!.idx).toBe(143);
  });

  it('registra a versão de schema', () => {
    expect(migration).toContain(
      "INSERT INTO _schema_version (version) VALUES ('0143-tiss-catalog')",
    );
  });
});
