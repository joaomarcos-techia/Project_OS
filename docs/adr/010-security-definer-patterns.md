# ADR-010 — SECURITY DEFINER patterns

> **Verificação (2026-07-23)** — Decisão: ACTIVE · Implementação: IMPLEMENTED
> _Base: em produção (C0–C16 fechadas); confirmação por domínio na Onda 3._

**Status:** accepted
**Date:** 2026-05-28

## Context

C3 introduz 4 funções SECURITY DEFINER no banco:
- `custom_access_token_hook(event jsonb)` — Hook do Supabase Auth
- `auth_hook_selftest()` — healthcheck
- `record_login_attempt(text, inet, boolean)` — INSERT em login_attempts
- `mark_mfa_enrolled(boolean)` — self-service UPDATE em profiles.mfa_enrolled_at

ADR-007 invariante #11 estabeleceu pattern de REVOKE PUBLIC + GRANT explícito. Mas SECURITY DEFINER abre riscos adicionais que C4+ vão multiplicar (cada novo helper, audit function, ou stored procedure). Sem regras explícitas, alguém em C8/C15 vai escrever `EXECUTE 'SELECT ...'` ou esquecer `SET search_path` — ambos bugs catastróficos (CVE-pattern, search_path hijack).

Esta ADR congela 8 regras + checklist obrigatório para toda nova SECURITY DEFINER function em C4+.

## Decision

### 8 regras (checklist obrigatório em PR)

Toda função SECURITY DEFINER em C3+ DEVE satisfazer:

1. **`SET search_path = public, pg_temp`** obrigatório no `CREATE FUNCTION`. Sem isso, atacante com privilege para criar funções em outro schema pode hijack via `search_path = malicious_schema, public`.
2. **`REVOKE EXECUTE ... FROM PUBLIC`** na mesma migration. `CREATE FUNCTION` default grant a PUBLIC — sem revoke, qualquer role nova adicionada em C4+ herda EXECUTE silenciosamente.
3. **`GRANT EXECUTE`** explícito apenas para roles necessárias. Nunca PUBLIC, nunca por inferência.
4. **Proibido `EXECUTE` dinâmico** dentro do corpo. Sem `EXECUTE 'SELECT ...'`, sem `format(...)` para construir SQL. Toda lógica em SQL estático.
5. **Proibido concatenar SQL com inputs do usuário.** Trivialmente injection. Usar parâmetros tipados PG sempre.
6. **Obrigatório schema-qualified refs** (`public.profiles`, não `profiles`). Defesa em profundidade contra search_path hijack caso a regra #1 falhe (downgrade Postgres, ALTER FUNCTION malicioso, etc.).
7. **Owner = `postgres`** (default da Supabase). Jamais `ALTER FUNCTION ... OWNER TO` para role tenant-scoped — perde o ponto de SECURITY DEFINER (rodar com privilege do owner).
8. **Volatility declarada explicitamente** (D30). `STABLE` para read-only sem side effects (lê tabela mas resultado é determinístico no statement). `VOLATILE` para mutações (INSERT/UPDATE/DELETE) OU leituras que dependem de estado mutável visível por outras transações (Hook lê tabelas que outros workflows mutam concorrentemente). Nunca implícito — Postgres assume VOLATILE por default e planner não inline → cache incorreto e bugs sutis.

### Checklist para PR template (copy/paste em C4+ que adiciona SECURITY DEFINER)

```markdown
### SECURITY DEFINER checklist (ADR-010)

Função nova: `<name>(<args>)`. Marque todas:

- [ ] 1. `SET search_path = public, pg_temp` no CREATE FUNCTION
- [ ] 2. `REVOKE EXECUTE ... FROM PUBLIC` na mesma migration
- [ ] 3. `GRANT EXECUTE` explícito apenas para roles necessárias (lista justificada)
- [ ] 4. Zero `EXECUTE` dinâmico no corpo (grep -i "execute '" no arquivo)
- [ ] 5. Zero concatenação de SQL com input externo
- [ ] 6. Todas as refs a tabelas/funções são `schema.name` (não bare names)
- [ ] 7. Owner é `postgres` (default — não há `ALTER FUNCTION ... OWNER TO`)
- [ ] 8. Volatility declarada (`STABLE` ou `VOLATILE`) explicitamente

Justifique POR QUE precisa de SECURITY DEFINER (vs SECURITY INVOKER). Default
é SECURITY INVOKER. Use DEFINER apenas quando:
- A função precisa bypassar RLS para mutar tabela protegida (e essa mutação é
  semanticamente autorizada para todos callers da função).
- A função é callback de hook managed por Supabase (Auth Hook).
- A função é trigger function que precisa privilégios do owner para escrever
  em tabelas restritas.
```

### Inventário C3

| Função | Volatility | Justificativa SECURITY DEFINER |
|---|---|---|
| `custom_access_token_hook` | VOLATILE | Hook do Supabase Auth chama com role `supabase_auth_admin`. Precisa SELECT em `profiles`/`effective_permissions_v` que RLS bloqueia para essa role. |
| `auth_hook_selftest` | VOLATILE | Wraps `custom_access_token_hook` — mesma razão. |
| `record_login_attempt` | VOLATILE | Insert em login_attempts que tem RLS sem write policy (segurança: anon/authenticated não podem injetar arbitrariamente). |
| `mark_mfa_enrolled` | VOLATILE | UPDATE em profiles.mfa_enrolled_at sem broad self-update policy (D31). auth.uid() interno valida que é o próprio user. |
| `bump_profile_claims_version` | (trigger fn) | Trigger function — VOLATILE implícito por ser trigger. |
| `bump_overrides_claims_version` | (trigger fn) | idem |
| `propagate_profile_clinic_to_overrides` | (trigger fn) | idem |

## Consequences

- PR template em C4+ tem checklist obrigatório.
- Code review humano + revisão SQL antes de merge para qualquer função SECURITY DEFINER.
- Grep periódico (sugestão C16): `grep -r "SECURITY DEFINER" drizzle/migrations/` deve casar com inventário documentado aqui.

## Alternatives

- SECURITY DEFINER livre sem checklist: rejeitado. Risco compounding.
- Lint custom para SECURITY DEFINER em SQL: postergado — SQL não tem AST padrão fácil de lintar; grep no PR template é suficiente para MVP.
- Mover toda lógica para application layer (sem SECURITY DEFINER): rejeitado. Hook do Supabase Auth DEVE ser SQL function (constraint do GoTrue). E inserts em login_attempts via app layer abrem RLS write policy fraca.

## References

- [ADR-007 — RLS implementation patterns](007-rls-implementation-patterns.md) — invariante #11 base
- [ADR-008 — Identity context patterns](008-identity-patterns.md) — D37 exceção para Hook
- [drizzle/migrations/0003_identity_core.sql](../../drizzle/migrations/0003_identity_core.sql) — Hook, selftest, record_login_attempt
- [drizzle/migrations/0004_identity_hardening.sql](../../drizzle/migrations/0004_identity_hardening.sql) — GRANTs explícitos
- [drizzle/migrations/0005_identity_mark_mfa.sql](../../drizzle/migrations/0005_identity_mark_mfa.sql) — mark_mfa_enrolled
