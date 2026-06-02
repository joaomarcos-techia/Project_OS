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
export * from '@/contexts/identity/schema';
// patient/schema.ts also side-effect-imports './events', so re-exporting it
// here populates the outbox catalog with patient.* schemas wherever the
// producer (publishEvent) transitively imports this barrel.
export * from '@/contexts/patient/schema';
// C6 — Scheduling. schema.ts side-effect-imports './events', registrando os
// schemas scheduling.* no catálogo do outbox onde quer que publishEvent rode.
export * from '@/contexts/scheduling/schema';
// C7 — Clinical. schema.ts side-effect-imports './events', registrando os
// schemas clinical.* no catálogo do outbox.
export * from '@/contexts/clinical/schema';
// C4 infra — cross-cutting tables (outbox, audit_events, super_admin_actions,
// idempotency_keys). Not a bounded context, so not under src/contexts/. The
// drizzle.config.ts glob './src/lib/db/schema/**/*' picks them up.
export * from './infra/outbox';
export * from './infra/audit';
export * from './infra/super-admin';
export * from './infra/idempotency';
