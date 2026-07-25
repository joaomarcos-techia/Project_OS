# ADR-008 — Identity context patterns

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

**Status:** accepted
**Date:** 2026-05-28

## Context

C3 instala identidade real (Supabase Auth + JWT custom claims + RBAC). Várias decisões aqui se afastam do template default (`defaultTenantPolicy`, invariante #11 do ADR-007) por razões específicas a auth/identity. Esta ADR congela essas exceções e estabelece os princípios canônicos que C4+ devem respeitar.

Sem essa ADR, futuro dev olha o código e pergunta "por que profiles tem policies manuais?", "por que o Hook é SECURITY DEFINER apesar do ADR-007 #11?", "JWT é fonte de verdade?" — e responde errado.

## Decision

### Princípios canônicos (P1-P7)

- **P1 — Banco é fonte de verdade de autorização.** `profiles.role`, `role_permissions`, `user_permission_overrides`. Sempre.
- **P2 — JWT é snapshot eventualmente consistente.** `permissions[]` no JWT é cache distribuído com TTL = access_token TTL (15min D12). Não é "verdade atual". Para revogação instantânea, desativar `profiles.ativo` ou forçar `auth.admin.signOut` server-side.
- **P3 — Hook só monta claims derivadas de tabelas estáveis.** Proibido EXECUTE dinâmico, branching contextual (impersonation, time-based), queries profundas. Permitido lookup direto + agregação simples via VIEW.
- **P4 — SECURITY DEFINER é exceção controlada, não pattern padrão.** Regras detalhadas em ADR-010.
- **P5 — Claims drift mitigation, não "auto-heal".** Sistema reduz janela de inconsistência, não cura. Detalhes em ADR-009.
- **P6 — RBAC controla CAPACIDADE; regras clínicas controlam ESCOPO DE DADOS.** Ownership/escopo (doctor vê só seus pacientes) vive em queries de domínio, NUNCA em `permissions[]` ou RLS.
- **P7 — `super_admin` é role de PLATAFORMA, não tenant-scoped.** Sem clinic_id. Sem entry em role_permissions. Hook injeta `super_admin: true` shortcut. Dois universos separados: tenant auth vs platform auth.

### Decisões específicas

- **D9** — `login_attempts` INSERT exclusivo via SECURITY DEFINER `record_login_attempt(text, inet, boolean)`. Mantém ESLint allowlist limpa e RLS sem write policy fraco.
- **D13** — JWT é snapshot eventualmente consistente (P2).
- **D14** — Hook restrito por princípio arquitetural (P3).
- **D20** — `requireFreshPermission()` para ações críticas (lista canônica em `src/lib/auth/policies/critical-actions.ts`). Bypassa JWT, lê banco em runtime.
- **D21 — Hook Complexity Budget.** Max 2 queries SQL principais, 1 agregação de permissions, sem loops PL/pgSQL, sem CTE recursiva, sem acesso a tabelas operacionais clínicas, alvo <20ms p95. Hook roda em login + refresh + renew — gargalo global se crescer.
- **D25 — `permissions[]` no JWT é flat `string[]`, NUNCA objeto.** Scoped grants/temporary grants em C15 usam **claim separada**, não complicam `permissions[]`.
- **D26 — Hook aggregation via VIEW `effective_permissions_v`** (single query). Desacopla Hook da composição RBAC — em C15/C16 pode virar materialized view sem mudar Hook.
- **D27 — Mudanças em `role_permissions` exigem logout operacional** (débito aceito). Trigger de claims_version detecta mudanças em profile/overrides mas NÃO em role_permissions (global). Solução estrutural (auth epoch global) fica para C16.
- **D31 — Self-service profile updates via column-level mutation functions** (`mark_mfa_enrolled` em 0005), NÃO via broad UPDATE policy. Aplicado JÁ em C3: `profiles_self_select FOR SELECT` (sem UPDATE/DELETE). Cada campo editável pelo próprio user exige Server Action explícita + SECURITY DEFINER function controlada.
- **D33 — Helper renomeado `requirePermission` → `requireCachedPermission`.** Nome explícito força escolha consciente entre cached (JWT) e fresh (DB). `requirePermission` é proibido por ESLint.
- **D34 — JWT budget: max 128 permissions efetivas + RAISE EXCEPTION no Hook** se exceder. JWT oversized quebra proxies/headers/edge.
- **D37 — Exceção ao ADR-007 #11 para funções invocadas por managed Supabase roles.** `custom_access_token_hook` é `GRANT EXECUTE TO supabase_auth_admin` apenas (não anon/authenticated/service_role), porque é GoTrue quem chama, e o role do hook é `supabase_auth_admin`. Documentado em 0004.
- **D38 — `sessions` table fora de C3.** Auditoria de login depende de `auth.sessions` (Supabase) no MVP. Auditoria pesada (IP, UA, revocação detalhada) entra em C4 via outbox + `super_admin_actions`. Reduz superfície da camada inicial.

### Frozen surface pré-C15

Esses 6 modelos NÃO podem ser expandidos em C4-C14 sem revisão prévia em janela de "Pre-C15 RBAC freeze review":

| Modelo | Estado em C3 |
|---|---|
| RBAC (roles + permissions + role_permissions + overrides) | Congelado |
| Multi-clinic per user | Não suportado (um user = um clinic_id) |
| Impersonation (super_admin entra como gestor) | Não existe — mecanismo futuro via claim adicional fora do Hook (P3) |
| Scoped permissions (ex: doctor vê só seus pacientes) | Não existe — vive em queries de domínio (P6) |
| Temporary grants (TTL em overrides) | Não existe |
| Contextual permissions (IP/horário/geo) | Não existe |

## Consequences

- C4+ devem usar `requireCachedPermission` por default e `requireFreshPermission` para CRITICAL_ACTIONS. Vitest arch test (em F8) valida.
- Adicionar nova permission canônica = 3 passos: enum em `src/lib/auth/permissions.ts` + seed em migration nova + bundle em role_permissions se aplicável.
- Adicionar SECURITY DEFINER function nova exige checklist ADR-010 + justificativa em PR.
- Mudanças em role_permissions exigem logout operacional manual até C16.
- self-service profile fields (avatar, telefone em C8) exigem novo `mark_*` SECURITY DEFINER function por campo — não reabrir broad UPDATE policy.

## Alternatives

- Hook STABLE em vez de VOLATILE: rejeitado (D32). Hook lê tabelas mutáveis; STABLE assume "mesma entrada → mesmo resultado dentro da statement" e pode dar planner caching incorreto.
- Hook sem cap de permissions: rejeitado (D34). JWT pode crescer sem limite e quebrar proxies/edge.
- profiles com broad UPDATE self-service via policy `FOR ALL`: rejeitado (D31). Bomba-relógio quando avatar/telefone chegarem em C8 — abre UPDATE sem review.
- super_admin populado em role_permissions: rejeitado (P7). Mistura platform auth com tenant auth; explode policy matrix futura.
- Auth epoch global desde já: postergado para C16. Solução estrutural para D27 quando blast radius justificar.

## References

- [PlanoAção.md — CAMADA 3](../PlanoAção.md) §§ 3.1–3.18
- [ADR-007 — RLS implementation patterns](007-rls-implementation-patterns.md) — base estendida por exceção D37
- [ADR-009 — Claims drift mitigation](009-claims-drift-mitigation.md) — par desta
- [ADR-010 — SECURITY DEFINER patterns](010-security-definer-patterns.md) — regras para Hook + record_login_attempt + mark_mfa_enrolled
- [src/contexts/identity/schema.ts](../../src/contexts/identity/schema.ts)
- [src/lib/auth/tenant-context.ts](../../src/lib/auth/tenant-context.ts)
- [drizzle/migrations/0003_identity_core.sql](../../drizzle/migrations/0003_identity_core.sql)
- [drizzle/migrations/0004_identity_hardening.sql](../../drizzle/migrations/0004_identity_hardening.sql)
- [drizzle/migrations/0005_identity_mark_mfa.sql](../../drizzle/migrations/0005_identity_mark_mfa.sql)

## Addendum — Remediation (2026-05-30, pré-C6)

ADRs add-only; este addendum registra mudanças de auth da remediação (ver `docs/Relatorio.md`):

- **F-07 (frozen surface RBAC):** catálogo de permissions vai de 20 → **21** com
  `export:patient` (export LGPD deixa de exigir só `view:patient`). Bundles
  `owner`/`gestor` recebem a nova permission (migration 0013). `role_permissions`
  total 64 → 66. Mudança de superfície congelada feita conscientemente sob o gate
  de remediação (não é expansão de modelo — é least-privilege de uma ação existente).
- **F-17:** `getCurrentUser` passa a usar `supabase.auth.getClaims()` (verifica o
  JWT — JWKS local p/ chaves assimétricas, round-trip ao Auth server p/ simétricas
  — e retorna as custom claims). Remove o `getSession()` + decode base64 manual e o
  respectivo `eslint-disable`. Comportamento de segurança preservado (sempre validado).
- **F-18:** middleware revoga a sessão server-side (`signOut({scope:'global'})`) no
  path `disabled` (usuário inativo/deletado) — não só limpa o cookie. Revoga 1×
  (guard via cookie `_healed`). Drift continua só limpando cookie (re-login renova).
- **F-06:** `forgot-password` ganha rate-limit (IP + email_hash) espelhando o login.
- **F-08:** rate-limit do login/reset é **fail-open + alerta + fallback in-memory**
  se o Upstash cair. **Limitação documentada:** o fallback é per-instância → com N
  instâncias o limite efetivo é ~N× o configurado; é proteção PARCIAL durante outage,
  degradação aceita, **NÃO** equivalente ao Upstash (global). Métrica `auth.ratelimit.degraded`.
- **F-14:** `CRITICAL_ACTIONS` deixa de ser stub (`deletePatient`,
  `requestLgpdDelete`, `requestLgpdExport`); arch-test AST exige
  `requireFreshPermission` no nível superior de cada uma (pega código morto).
  Invariante: ação sensível de super_admin SEMPRE via `requireSuperAdmin` (aal2).
