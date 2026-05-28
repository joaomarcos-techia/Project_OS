# lib/db

Cliente Drizzle, helpers de tenant context, conexão Postgres via Supabase.

**Status:** ✅ implementado em C1.

## Surface

- [index.ts](index.ts) — `db` (runtime), `dbAdmin` (admin). Pools fisicamente
  distintos. Em C1 mesma URL; em C2 service-role separa. Este é o ÚNICO arquivo
  do repo que importa `postgres` driver — ESLint enforça.
- [tenant.ts](tenant.ts) — `withTenant(clinicId, fn)` define
  `app.current_clinic` GUC dentro de uma transação. RLS policies de C2+ leem.
- [schema/index.ts](schema/index.ts) — barrel re-exportando schemas. Em C1 só
  `_meta` (`_schema_version`). Em C2+ re-exporta `tenancy/schema`, etc.
- [types.ts](types.ts) — helpers `uuidPk`, `tenantId`, `timestampsPattern`,
  `deletedAt`. Convenções congeladas (uuid PK, timestamptz, snake_case DB).

## Regras congeladas (C1)

- `dbAdmin` só pode ser importado de `src/app/(admin)/`,
  `src/app/api/admin/`, ou `scripts/`. ESLint bloqueia o resto.
- Apenas application/use-case abre transação. Repositories recebem `tx`.
- `withTenant` é a única forma de aplicar tenant scope no Postgres.

## Operações

Veja [docs/runbooks/migrations.md](../../../docs/runbooks/migrations.md) para
criar/aplicar migrations, fazer backup, rollback e troubleshooting.
