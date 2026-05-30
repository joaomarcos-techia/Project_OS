# lib/auth

Helpers de autenticação e autorização server-side. Único ponto que lê cookies/JWT do Supabase no projeto.

**Status:** C3 implementado.

## Estrutura

- `tenant-context.ts` — porta única de autorização. Exporta `getCurrentUser`, `requireUser`, `requireClinicId`, `requireRole`, `requireCachedPermission`, `requireFreshPermission`, `requireSuperAdmin`. (`auditableAction` foi REMOVIDO em C4; use `idempotentMutation`/`auditedMutation`/`superAdminAction` de `@/lib/idempotency` e `@/lib/audit`.)
- `supabase-server.ts` — `createServerClient()` com adapter `cookies()` async (Next 15). Único caminho de leitura de cookie.
- `supabase-browser.ts` — singleton para client components (forms).
- `supabase-admin.ts` — service_role client, BYPASSA RLS. Apenas em scripts/(admin)/api/admin/.
- `permissions.ts` — catálogo canônico `PERMISSIONS` (20 codes). Zero strings mágicas no resto do código.
- `roles.ts` — Role union + Zod schema + helpers `isRole/assertRole`.
- `claims.ts` — `parseClaims()` + Zod schema do payload JWT custom (clinic_id, role, permissions, claims_version, super_admin, aal).
- `email-hash.ts` — HMAC-SHA256 com `LOGIN_HASH_PEPPER` para `login_attempts`.
- `rate-limit.ts` — Upstash dual sliding window (IP 10/15min + email_hash 5/15min, D15).
- `mfa.ts` — facade `enroll/verify/challenge/unenroll/getAal/listFactors`.
- `policies/` — pure functions (D23): `mfa-policy.ts`, `routing-policy.ts`, `critical-actions.ts`.

## Convenções (frozen em ADR-008)

- **NUNCA** chamar `supabase.auth.getSession()` (ESLint bloqueia — não valida signature). Use `getCurrentUser()` ou `requireUser()`.
- **NUNCA** usar `requirePermission` (renomeado D33, ESLint bloqueia). Escolha consciente:
  - `requireCachedPermission(perm)` — JWT (rápido, stale até 60s + TTL).
  - `requireFreshPermission(perm)` — banco (lento ~5ms, garantia forte). Obrigatório para `CRITICAL_ACTIONS`.
- `requireSuperAdmin()` exige AAL2 (MFA verificado) — D6.
- Middleware NÃO é enforcement primário (D22). Toda Server Action revalida aqui.

Veja `docs/adr/008-identity-patterns.md`, `009-claims-drift-mitigation.md`, `010-security-definer-patterns.md`.
