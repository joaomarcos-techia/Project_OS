# Contexto: Identity

**Responsável por:** Autenticação (Supabase), profiles, roles, RBAC, sessions de login (audit pré-auth), MFA TOTP.
**Não faz:** Cadastro de clínica (tenancy), cobrança (financial), CRUD de paciente (patient).
**Camada onde ganha conteúdo:** C3 (este).
**Comunicação com outros contexts:** outbox (a partir de C4) + custom claims no JWT (`clinic_id`, `role`, `permissions[]`, `claims_version`, `super_admin`).

## Entidades (schema.ts)

- `profiles` — extensão do `auth.users` com `role`, `clinic_id` (nullable só p/ super_admin), `claims_version`, `mfa_enrolled_at`, `ativo`. Policies RLS manuais (não defaultTenantPolicy).
- `permissions` — catálogo canônico (21 codes). Global protected, read-only authenticated.
- `role_permissions` — bundles padrão por role. Global protected. Mudanças exigem logout operacional (ADR-008 D27).
- `user_permission_overrides` — granular per-user grant/deny. Tenant-scoped via defaultTenantPolicy. Trigger bumpa claims_version do user afetado.
- `login_attempts` — audit pre-auth para rate limit dual (IP + email_hash). INSERT exclusivo via SECURITY DEFINER `record_login_attempt()` (D9).

## Decisões frozen (ADR-008)

- JWT é snapshot eventualmente consistente — banco é canônico (P2).
- Hook restrito a claims derivadas de tabelas estáveis (P3) — VIEW `effective_permissions_v` é a única query.
- `requireCachedPermission()` lê JWT; `requireFreshPermission()` revalida no banco para actions críticas (D20).
- `super_admin` é role de plataforma, não tenant-scoped (P7).
- RBAC controla capacidade; ownership/escopo vive em queries de domínio (P6).
- Linha de congelamento pré-C15: sem multi-clinic per user, sem impersonation, sem scoped permissions, sem temporary grants, sem contextual permissions.

Veja [docs/adr/008-identity-patterns.md](../../../docs/adr/008-identity-patterns.md), [009-claims-drift-mitigation.md](../../../docs/adr/009-claims-drift-mitigation.md), [010-security-definer-patterns.md](../../../docs/adr/010-security-definer-patterns.md) e o plano C3 v6.
