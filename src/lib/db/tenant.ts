/**
 * `withTenant(clinicId, fn)` — the ONLY way to scope Postgres operations to
 * a single tenant. Sets `app.current_clinic` as a transaction-local GUC so
 * RLS policies (added in C2+) can read it via `current_setting(...)`.
 *
 * Implementation note: set_config vs SET LOCAL
 *   `SET LOCAL app.current_clinic = $1` would be more idiomatic-looking, but
 *   `SET LOCAL` takes a literal — not a bind parameter — so we'd need raw
 *   string interpolation to inject clinicId, which re-introduces SQL
 *   injection risk. `SELECT set_config('app.current_clinic', $1, true)` is
 *   the function form: accepts a bind parameter, scoped to the transaction
 *   (3rd arg = is_local=true). Identical effect for RLS, strictly safer.
 *
 * Critical constraints (frozen in C1):
 *   1. set_config(..., true) ONLY persists inside the active transaction.
 *      Refactoring this helper to be non-transactional silently breaks RLS.
 *   2. Nested `withTenant` calls are NOT supported. Postgres has savepoints,
 *      but Drizzle exposes them awkwardly and the semantics ("which tenant
 *      is current?") get confusing fast. Use one call at the boundary of a
 *      use-case.
 *   3. In C1, no RLS policies consume this GUC yet — helper exists so C2
 *      doesn't have to refactor every caller, only add policies.
 *
 * Transaction policy (frozen in C1):
 *   Only application/use-case layers (Server Actions, route handlers, jobs,
 *   scripts) call `withTenant` or `db.transaction(...)`. Repository-style
 *   helpers receive `tx` as a parameter and NEVER open their own transaction.
 */
import { sql } from 'drizzle-orm';

import { db, type Db } from './index';

type TxArg = Parameters<Parameters<Db['transaction']>[0]>[0];

export async function withTenant<T>(
  clinicId: string,
  fn: (tx: TxArg) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_clinic', ${clinicId}, true)`);
    return fn(tx);
  });
}
