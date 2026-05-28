// Public surface of the `tenancy` context.
// Other contexts may import ONLY from this file (enforced by eslint-plugin-boundaries).
//
// C2 exports:
//   - Schema entities: clinics, clinicUnits, reservedSlugs
//   - Enum: clinicStatus
//   - FK helper: tenantIdRef() — used by every tenant-scoped table in C3+
//
// C13 / C15 will add api.ts (cross-context calls) and events.ts (outbox).
export {
  clinicStatus,
  clinics,
  clinicUnits,
  reservedSlugs,
  tenantIdRef,
} from './schema';
