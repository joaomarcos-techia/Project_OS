# Contexto: Tenancy

**Responsável por:** Clínicas, unidades, slugs reservados, status do tenant.
**Não faz:** Cobrança/billing (financial — C13), usuários (identity — C3), pacientes (patient — C5), domínios/subdomain routing (vai para C3 middleware ou C13 custom domains).
**Status:** ✅ implementado em C2.
**Comunicação com outros contexts:** sem outbox em C2 (placeholder até C13 emitir `clinic.created` / `clinic.suspended`).

## Superfície pública ([index.ts](index.ts))

Schema entities + helper. Outros contexts importam SOMENTE de `@/contexts/tenancy`:

| Export | Origem | Uso |
|---|---|---|
| `clinics` | [schema.ts](schema.ts) | Tabela raiz do tenant |
| `clinicUnits` | [schema.ts](schema.ts) | Sub-unidades (multi-unidade Pro) |
| `reservedSlugs` | [schema.ts](schema.ts) | Slugs reservados (global protected) |
| `clinicStatus` | [schema.ts](schema.ts) | Enum: trial / active / suspended_readonly / suspended / cancelled |
| `tenantIdRef()` | [schema.ts](schema.ts) | FK helper para tabelas C3+ tenant-scoped (NOT NULL + ON DELETE CASCADE) |

`api.ts` e `events.ts` ficam ausentes até C13/C15 — não há consumidor cross-context ainda.

## Regras congeladas em C2

- Toda tabela tenant-scoped de C3+ usa `tenantIdRef()` daqui (FK + cascade).
- Toda tabela tenant-scoped de C3+ declara `index(...)` em `clinic_id` (D9 — Postgres não cria automático).
- RLS é habilitado e FORÇADO na MESMA migration do `CREATE TABLE` (ADR-002 + ADR-007).
- `clinics` mutações (UPDATE/INSERT/DELETE) são `super_admin` only em C2 (D31). Edição funcional vem em C3.
- `_reserved_slugs` mutações exclusivamente via `dbAdmin` — sem write policy (D34).
- Hard delete de `clinics` apenas via flows super_admin com confirmação dupla + audit (D26).

## Operações

- Helper RLS: [src/lib/db/rls.ts](../../lib/db/rls.ts) (`defaultTenantPolicy()`)
- Helper tenant context (jobs/workers): [src/lib/db/tenant.ts](../../lib/db/tenant.ts) (`withTenant()`)
- Migration de fundação: [drizzle/migrations/0001_tenancy_foundation.sql](../../../drizzle/migrations/0001_tenancy_foundation.sql)
- ADR: [docs/adr/007-rls-implementation-patterns.md](../../../docs/adr/007-rls-implementation-patterns.md)
- Runbook de validação: [docs/runbooks/c2-validation.md](../../../docs/runbooks/c2-validation.md)
