/**
 * Schema barrel — single import surface for Drizzle.
 *
 * Convention (frozen in C1): each bounded context owns its tables in its own
 * `schema.ts`, and re-exports them here. In C1 only `_meta` exists. In C2+
 * this file grows:
 *
 *   export * from './_meta';
 *   export * from '../../../contexts/tenancy/schema';
 *   export * from '../../../contexts/identity/schema';
 *   ...
 *
 * Why a barrel: drizzle-kit reads `schema: './src/lib/db/schema/*'` in
 * drizzle.config.ts — every file globbed contributes to the migration diff.
 * Re-exporting here keeps `db` (drizzle client) tied to a single schema map.
 */
export * from './_meta';
