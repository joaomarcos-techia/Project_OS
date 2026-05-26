/**
 * `_schema_version` — the ONLY table created in C1.
 *
 * Purpose: minimal proof that the schema-versioning pipeline (Drizzle generate
 * + drizzle-kit migrate + git-versioned SQL) works end-to-end. Real domain
 * tables (clinics, users, patients, …) arrive in C2+.
 *
 * Why a dedicated table instead of relying on drizzle-kit's `__drizzle_migrations`:
 * - drizzle-kit's table is an implementation detail of the migrator and could
 *   change shape between versions.
 * - `_schema_version` is OUR contract — used later (C2+) to record explicit
 *   "snapshot points" (e.g. version "v2-rls-foundation") that runbooks reference.
 */
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const schemaVersion = pgTable('_schema_version', {
  version: text('version').primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).defaultNow().notNull(),
});
