/**
 * `withTenant(clinicId, fn)` — the ONLY way to scope Postgres operations to
 * a single tenant from jobs / workers / scripts (no JWT context).
 *
 * What it does, in order, inside a single transaction:
 *   1. `SET LOCAL ROLE authenticated` — switches the current role to one
 *      without BYPASSRLS so FORCE RLS policies actually evaluate against the
 *      caller. This role-switch is the PRINCIPAL runtime isolation defense
 *      (ADR-007 Correction F-01) — not mere hardening: the `db` pool connects
 *      with a BYPASSRLS role, so WITHOUT this switch FORCE does NOT stop
 *      cross-tenant reads/writes.
 *   2. `set_config('app.current_clinic', $1, true)` — sets the GUC that
 *      tenant-scoped RLS policies read via `current_setting('app.current_clinic')`.
 *   3. Runs `fn(tx)` inside the same transaction. On commit, both the role
 *      and the GUC evaporate — the next query on this pooled connection is
 *      back to the pool's default role (test 2.6.11 pool reuse safety).
 *
 * Frozen contracts (see docs/adr/007-rls-implementation-patterns.md):
 *   - Correct hierarchy per ADR-007 **Correction F-01**, which supersedes the
 *     older "FORCE-principal"/D24 framing (empirically confirmed false — the
 *     pool role has `rolbypassrls=true`, see connection-origin-guard.ts): the
 *     `SET LOCAL ROLE authenticated` above is the PRINCIPAL runtime defense for
 *     the `db` pool. FORCE ROW LEVEL SECURITY is defense-in-depth — it
 *     constrains a non-bypass owner/role and is a second layer AFTER the
 *     role-switch; it does NOT, by itself, isolate the BYPASSRLS pool role. If
 *     the role-switch ever fails as a HARD error, the transaction aborts
 *     (fail-closed). If it silently no-ops or `withTenant` is bypassed,
 *     isolation is LOST — FORCE does not save it. The structural fail-closed
 *     fix (dedicated non-BYPASSRLS pool role) is deferred to C16.
 *   - `set_config(..., true)` is the function form of SET LOCAL — accepts a
 *     bind parameter (no string interpolation, no injection risk) and is
 *     scoped to the active transaction.
 *   - Nested `withTenant` calls are NOT supported. Open one at the boundary
 *     of a use-case. Repositories receive `tx` and never open their own.
 *   - This helper operates on `db` (RLS-enforcing). For super_admin
 *     cross-tenant work, use `dbAdmin` directly (RLS bypass, allowlisted).
 *
 * Pre-implementation gate (Test G, see docs/runbooks/c2-validation.md):
 *   Validated empirically that `SET LOCAL ROLE authenticated` is permitted
 *   for the Supabase Transaction Pooler role `postgres.<projectref>` against
 *   `qoro-dev`. If this stops being true in any environment, the role-switch
 *   must RAISE (fail-closed / abort the transaction) — isolation is NOT
 *   preserved by FORCE alone for the BYPASSRLS pool role (ADR-007 Correction
 *   F-01). Re-evaluate operationally; do not rely on FORCE as a backstop.
 */
import { sql } from 'drizzle-orm';

import { db, type Db } from './index';

type TxArg = Parameters<Parameters<Db['transaction']>[0]>[0];

export async function withTenant<T>(
  clinicId: string,
  fn: (tx: TxArg) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE authenticated`);
    await tx.execute(sql`SELECT set_config('app.current_clinic', ${clinicId}, true)`);
    return fn(tx);
  });
}
