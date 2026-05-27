/**
 * RLS SQL helpers — single source for the policy patterns used across all
 * tenant-scoped tables. ADR-007 freezes the patterns; this file freezes the
 * SQL text. Changing a helper changes every migration that calls it in C3+.
 *
 * Frozen contracts (see docs/adr/007-rls-implementation-patterns.md):
 *   - FORCE ROW LEVEL SECURITY is the PRINCIPAL defense (D24). It is the
 *     invariant that survives any Supabase / pooler / role change.
 *   - SET LOCAL ROLE authenticated (in withTenant) is HARDENING only.
 *   - Policies always check `current_setting('app.current_clinic')` OR
 *     `current_clinic_id()` (dual-context, D22).
 *   - Policies never enforce RBAC ("which role can edit"). RBAC lives in
 *     the application layer (Server Actions). Only super_admin lives here
 *     because it is the cross-tenant exception (D27).
 *   - Default policies are baseline only (D32). Custom policies are allowed
 *     when marketplace / shared-tenant scenarios appear, with an ADR.
 *
 * Output SQL consumes 3 SQL helper functions installed by migration 0001:
 *   - current_clinic_id()      -> text
 *   - current_platform_role()  -> text
 *   - is_super_admin()         -> boolean
 *
 * This file generates SQL strings; it does NOT execute SQL. It must be safe
 * to import in any layer (it does not import db / postgres / context schemas).
 */

// D23 + D28 + D30: identifier sanitation pipeline.
// Trim blocks whitespace creeping in from YAML/env parsers (D30).
// Lowercase forces canonical form — Postgres "Clinic_Units" != clinic_units
// (D23). Regex rejects anything that could break out of an interpolation
// (D23). Throw early so callers get a precise error, not a SQL parse failure.
const SAFE_SQL_IDENT = /^[a-z_][a-z0-9_]*$/;

export function normalizeAndAssertIdent(
  kind: 'table' | 'column' | 'policy',
  value: string,
): string {
  const lower = value.trim().toLowerCase();
  if (!SAFE_SQL_IDENT.test(lower)) {
    throw new Error(
      `[rls] invalid ${kind} identifier: ${JSON.stringify(value)} ` +
        `(must match ${SAFE_SQL_IDENT} after trim+lowercase)`,
    );
  }
  return lower;
}

/**
 * D28: every helper-generated SQL block carries this fingerprint. Audit
 * tooling greps `GENERATED_BY` to distinguish helper output from manual
 * policies. Versioned so the template can evolve without losing
 * traceability. Bump when the policy text changes.
 */
const FINGERPRINT = '-- GENERATED_BY: defaultTenantPolicy(v1)';

export interface DefaultTenantPolicyOptions {
  /** default: `<table>_tenant_access` */
  policyName?: string;
  /** default: `clinic_id` */
  tenantColumn?: string;
}

/**
 * Emits SQL that:
 *   1. Enables RLS on `table`
 *   2. Forces RLS (so the table owner is subject to policies too)
 *   3. Creates a single FOR ALL policy whose predicate is:
 *        tenant_col matches GUC `app.current_clinic` (jobs/workers)
 *        OR tenant_col matches `current_clinic_id()` (HTTP request JWT)
 *        OR caller is `is_super_admin()`
 *
 * Output includes the GENERATED_BY fingerprint as the first line.
 */
export function defaultTenantPolicy(
  rawTable: string,
  opts: DefaultTenantPolicyOptions = {},
): string {
  const table = normalizeAndAssertIdent('table', rawTable);
  const policy = normalizeAndAssertIdent('policy', opts.policyName ?? `${table}_tenant_access`);
  const col = normalizeAndAssertIdent('column', opts.tenantColumn ?? 'clinic_id');
  return `${FINGERPRINT}
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE  ROW LEVEL SECURITY;
CREATE POLICY ${policy} ON ${table} FOR ALL
  USING (
    ${col}::text = current_setting('app.current_clinic', true)
    OR ${col}::text = current_clinic_id()
    OR is_super_admin()
  )
  WITH CHECK (
    ${col}::text = current_setting('app.current_clinic', true)
    OR ${col}::text = current_clinic_id()
    OR is_super_admin()
  );`;
}

/**
 * Emits the trigger that pins `updated_at` to now() before every UPDATE.
 * Pairs with the generic `set_updated_at()` function installed by migration 0001.
 */
export function setUpdatedAtTrigger(rawTable: string): string {
  const table = normalizeAndAssertIdent('table', rawTable);
  return `CREATE TRIGGER trg_${table}_updated_at BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION set_updated_at();`;
}
