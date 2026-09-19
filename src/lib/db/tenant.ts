/**
 * `withTenant(clinicId, fn, actorUserId?)` — the ONLY way to scope Postgres operations to
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
 *   3. When a request actor is known, sets `app.current_user` for policies
 *      whose visibility is restricted to their author.
 *   4. Runs `fn(tx)` inside the same transaction. On commit, both the role
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
 *     isolation is LOST — FORCE does not save it. The structural fail-closed fix
 *     is a dedicated non-BYPASSRLS pool role: the CODE is ready and opt-in via
 *     `DATABASE_URL_RUNTIME` ([db/index.ts]); what is missing is provisioning the
 *     role in Postgres. Tracked in PROGRESS §"Dívida técnica pós-C16" — NOT
 *     "deferred to C16": C16 shipped, so that pointer was dangling.
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

/**
 * Role que a transação DEVE assumir. Se ela não assumir, o pool continua com o
 * papel BYPASSRLS e RLS não avalia nada — o cenário que o cabeçalho deste
 * arquivo descreve como "isolamento PERDIDO".
 */
const TENANT_ROLE = 'authenticated';

export class TenantRoleError extends Error {
  constructor(readonly actual: string) {
    super(
      `withTenant: a transação continua como "${actual}", não "${TENANT_ROLE}". ` +
        'RLS não avalia para um papel BYPASSRLS — abortando antes de qualquer leitura.',
    );
    this.name = 'TenantRoleError';
  }
}

export async function withTenant<T>(
  clinicId: string,
  fn: (tx: TxArg) => Promise<T>,
  actorUserId?: string | null,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE authenticated`);
    // V1.4 (auditoria adversarial 2026-09-11, SEC-002) — VERIFICA o role-switch
    // em vez de confiar nele.
    //
    // O comentário do topo deste arquivo já dizia a parte difícil: se o
    // `SET LOCAL ROLE` falhar como erro duro, a transação aborta e está tudo
    // bem; mas se ele **silenciosamente não surtir efeito**, o isolamento some
    // e nada reclama — as queries seguem rodando com um papel que ignora RLS e
    // devolvem dados de todos os tenants com aparência de normalidade. Era a
    // única forma de perder isolamento sem nenhum sinal.
    //
    // A leitura de `current_user` viaja na MESMA ida ao banco que o
    // `set_config` que já existia: custo zero de round-trip nos 162 call sites.
    // Divergiu → lança, a transação aborta, `fn` nunca roda. Fail-closed.
    const [scope] = await tx.execute<{ role: string }>(
      sql`SELECT set_config('app.current_clinic', ${clinicId}, true), current_user AS role`,
    );
    const role = scope?.role;
    if (role !== TENANT_ROLE) throw new TenantRoleError(String(role ?? 'desconhecido'));
    if (actorUserId) {
      await tx.execute(sql`SELECT set_config('app.current_user', ${actorUserId}, true)`);
    }
    return fn(tx);
  });
}
