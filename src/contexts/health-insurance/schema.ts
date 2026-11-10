/**
 * Schema do context `health-insurance` (convênios e faturamento TISS; ADR-067).
 *
 * Esta primeira fatia (migration 0143) traz só o catálogo GLOBAL: versões de
 * terminologia TUSS, termos e versões de comunicação TISS. Não tem clinic_id:
 * é dado público da ANS, só de leitura para o runtime. As tabelas da clínica
 * (operadoras, contratos, carteirinhas, guias) chegam nas migrations seguintes
 * do plano mestre (P1.4 em diante).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { uuidPk } from '@/lib/db/types';

export const tissTerminologyVersions = pgTable(
  'tiss_terminology_versions',
  {
    id: uuidPk(),
    /** Competência da terminologia, `AAAAMM` (ex.: `202609`). */
    version: text('version').notNull(),
    archiveUrl: text('archive_url').notNull(),
    archiveSha256: text('archive_sha256').notNull(),
    manifestSha256: text('manifest_sha256').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    versionUniq: unique('tiss_terminology_versions_version_uniq').on(t.version),
    versionChk: check('tiss_terminology_versions_version_chk', sql`${t.version} ~ '^[0-9]{6}$'`),
  }),
);

export const tissTerms = pgTable(
  'tiss_terms',
  {
    versionId: uuid('version_id')
      .notNull()
      .references(() => tissTerminologyVersions.id, { onDelete: 'restrict' }),
    /** Número da tabela TUSS (`22`, `24`, `87`…). */
    tableCode: text('table_code').notNull(),
    code: text('code').notNull(),
    term: text('term').notNull(),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    implantationEndsOn: date('implantation_ends_on'),
    /** Colunas próprias da tabela (ex.: `Sigla` da 59). */
    extra: jsonb('extra').$type<Record<string, string>>(),
  },
  (t) => ({
    pk: primaryKey({ name: 'tiss_terms_pk', columns: [t.versionId, t.tableCode, t.code] }),
    lookupIdx: index('tiss_terms_lookup_idx').on(t.tableCode, t.code),
    vigenciaChk: check(
      'tiss_terms_vigencia_chk',
      sql`${t.endsOn} IS NULL OR ${t.startsOn} IS NULL OR ${t.endsOn} >= ${t.startsOn}`,
    ),
  }),
);

export const tissSchemaVersions = pgTable('tiss_schema_versions', {
  /** Versão do Componente de Comunicação (ex.: `4.03.00`). */
  version: text('version').primaryKey(),
  manifestSha256: text('manifest_sha256').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type TissTerminologyVersionRow = typeof tissTerminologyVersions.$inferSelect;
export type TissTermRow = typeof tissTerms.$inferSelect;
export type TissSchemaVersionRow = typeof tissSchemaVersions.$inferSelect;
