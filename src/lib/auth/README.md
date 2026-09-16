# lib/auth

Helpers de autenticação e autorização. Requests e actions tomam a decisão autoritativa no servidor;
access e refresh tokens Supabase permanecem em cookies HttpOnly e são renovados no servidor.

**Status:** C3 implementado.

## Estrutura

- `tenant-context.ts` — porta única de autorização. Exporta `getCurrentUser`, `requireUser`, `requireClinicId`, `requireRole`, `requireCachedPermission`, `requireFreshPermission`, `requireSuperAdmin`. (`auditableAction` foi REMOVIDO em C4; use `idempotentMutation`/`auditedMutation`/`superAdminAction` de `@/lib/idempotency` e `@/lib/audit`.)
- `supabase-server.ts` — `createServerClient()` com adapter `cookies()` async (Next 15), usado na autorização e renovação server-side; `clearSupabaseSessionSelector()` desvincula a geração ativa.
- `supabase-session-cookie.ts` — atributos HttpOnly, geração da sessão, identificação de fragmentos legados/órfãos e detecção de renovação próxima do vencimento. O middleware expira legado/órfãos e roteia; `/auth/session-refresh` valida no Auth e grava somente cookies da própria geração.
- `supabase-admin.ts` — service_role client, BYPASSA RLS. Apenas em scripts/(admin)/api/admin/.
- `permissions.ts` — catálogo canônico `PERMISSIONS` (28 codes). Zero strings mágicas no resto do código.
- `roles.ts` — Role union + Zod schema + helpers `isRole/assertRole`.
- `claims.ts` — `parseClaims()` + Zod schema do payload JWT custom (clinic_id, role, permissions, claims_version, super_admin, aal).
- `email-hash.ts` — HMAC-SHA256 com `LOGIN_HASH_PEPPER` para `login_attempts`.
- `rate-limit.ts` — Upstash dual sliding window (IP 10/15min + email_hash 5/15min, D15).
- `mfa.ts` — facade `enroll/verify/challenge/unenroll/getAal/listFactors`.
- `policies/` — pure functions (D23): `mfa-policy.ts`, `routing-policy.ts`, `critical-actions.ts`.

## Convenções (frozen em ADR-008)

- **NUNCA** chamar `supabase.auth.getSession()` (ESLint bloqueia — não valida signature). Use `getCurrentUser()` ou `requireUser()`.
- **NUNCA** usar `requirePermission` (renomeado D33, ESLint bloqueia). Escolha consciente:
  - `requireCachedPermission(perm)` — permissão do JWT, com profile/epoch conferido no banco a cada request.
  - `requireFreshPermission(perm)` — relê as fontes de permissão linha a linha como defesa em profundidade. Obrigatório para `CRITICAL_ACTIONS`.
- `requireSuperAdmin()` exige AAL2 (MFA verificado) — D6.
- Middleware NÃO é enforcement primário (D22). Toda Server Action revalida aqui.

## Transporte da sessão (emenda de 14–15/09/2026 à ADR-037)

A sessão usa `sb-<project>-auth-token-v2-<geração>`, com geração de 32 caracteres hexadecimais,
e o seletor `qoro-auth-session`; ambos são `HttpOnly`, `SameSite=Lax` e `Secure` em produção.
Login, OTP e login final de `/join` usam `newSession: true`: criam uma geração nova e gravam o
seletor depois dos fragmentos. Contextos que mudam a sessão Auth usam `cookieWrites: 'required'`; a
escrita somente leitura é tolerada apenas nos Server Components. Refresh usa a geração atual e
nunca grava ou apaga o seletor, mesmo em falha. Logout, troca de conta e reset removem o seletor;
OTP desvincula a identidade anterior antes de verificar o token, inclusive se ele for inválido.

O middleware nunca copia a sessão recebida nem reemite cookies ativos: expira o nome legado e
as gerações órfãs. O cutover exige uma nova autenticação. `/convite` valida sessão/perfil no
servidor; o Consultório consulta `getBoard` por Server Action com polling de 20 s na aba visível.

`pnpm security:browser-session`, com `playwright.httponly.config.ts`, exercita Chromium real
contra o build Next isolado. O teste do convite usa o SDK SSR instalado sobre Auth HTTP sintético
em loopback. Não é prova de GoTrue/Supabase externo; rollout e revogação pelo provedor permanecem
**NOT TESTED**. A geração impede refresh antigo de selecionar outra identidade no navegador,
sem alegar correção da janela entre incremento de epoch e `signOut` no logout.

Veja `docs/adr/008-identity-patterns.md`, `009-claims-drift-mitigation.md`, `010-security-definer-patterns.md`.
