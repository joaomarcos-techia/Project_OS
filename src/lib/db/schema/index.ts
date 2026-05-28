/**
 * Schema barrel — single import surface for Drizzle.
 *
 * Convention (frozen in C1): each bounded context owns its tables in its own
 * `schema.ts`, and re-exports them here. C2 added the tenancy schema.
 *
 * Why a barrel: drizzle-kit reads `schema: './src/lib/db/schema/*'` in
 * drizzle.config.ts — every file globbed contributes to the migration diff.
 * Re-exporting here keeps `db` (drizzle client) tied to a single schema map.
 *
 * NOTE: this barrel is the one place where src/lib/db/* re-exports across
 * the context boundary. The boundaries lint rule treats lib→context as
 * forbidden; this file is purely declarative (consumed by drizzle-kit to
 * build the migration diff and by the runtime `db` for `db.<table>` typing).
 * Anything more than a re-export here violates the spirit of ADR-001.
 */
export * from './_meta';
export * from '@/contexts/tenancy/schema';
