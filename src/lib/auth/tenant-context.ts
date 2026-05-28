/**
 * Tenant context resolution — public contract frozen in C2; bodies arrive
 * in C3 (Identity + Auth + Custom Claims + RBAC).
 *
 * Purpose:
 *   - Anchors the API surface that Server Actions / route handlers will use
 *     starting in C3. Existing now so callers can be written against a stable
 *     contract; the throws guarantee no one accidentally builds a flow that
 *     reads tenant context before C3 lands.
 *   - The Role enum is the canonical platform role list (matches
 *     PlanoAção §4.1 + ADR-007 D27 carve-out for super_admin).
 *
 * Implementation notes for C3 (do NOT implement here):
 *   - `requireClinicId` / `requireRole` / `requireSuperAdmin` will read the
 *     Supabase JWT claims (`clinic_id`, `role`) injected by the Auth Hook
 *     (PlanoAção §3.2). Until then, every call throws.
 *   - RLS does NOT depend on these helpers. The dual-context policies (D22)
 *     keep working from the GUC alone for jobs/workers/scripts.
 */

export type Role =
  | 'super_admin'
  | 'gestor'
  | 'doctor'
  | 'attendant'
  | 'financial'
  | 'owner';

export async function requireClinicId(): Promise<string> {
  throw new Error('[auth] requireClinicId not implemented until C3 (Identity)');
}

export async function requireRole(_allowed: Role[]): Promise<Role> {
  throw new Error('[auth] requireRole not implemented until C3 (Identity)');
}

export async function requireSuperAdmin(): Promise<void> {
  throw new Error('[auth] requireSuperAdmin not implemented until C3 (Identity)');
}
