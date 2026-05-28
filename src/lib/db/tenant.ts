/**
 * `withTenant(clinicId, fn)` — the ONLY way to scope Postgres operations to
 * a single tenant from jobs / workers / scripts (no JWT context).
 *
 * What it does, in order, inside a single transaction:
 *   1. `SET LOCAL ROLE authenticated` — switches the current role to one
 *      without BYPASSRLS so FORCE RLS policies actually evaluate against the
 *      caller (D24 hardening).
 *   2. `set_config('app.current_clinic', $1, true)` — sets the GUC that
 *      tenant-scoped RLS policies read via `current_setting('app.current_clinic')`.
 *   3. Runs `fn(tx)` inside the same transaction. On commit, both the role
 *      and the GUC evaporate — the next query on this pooled connection is
 *      back to the pool's default role (test 2.6.11 pool reuse safety).
 *
 * Frozen contracts (see docs/adr/007-rls-implementation-patterns.md):
 *   - FORCE ROW LEVEL SECURITY in the schema is the PRINCIPAL defense (D24).
 *     SET ROLE here is hardening. If a future Supabase change revokes the
 *     pool role's privilege to switch to `authenticated`, isolation continues
 *     to work via FORCE + dual-context policies; only defense-in-depth degrades.
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
 *   `qoro-dev`. If this stops being true in any environment, the C2 hardening
 *   degrades but isolation remains intact via FORCE + dual-context.
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
