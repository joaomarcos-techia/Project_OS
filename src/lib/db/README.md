# lib/db

Cliente Drizzle, helpers de tenant context, conexão Postgres via Supabase.

**Status:** vazio. **Camada:** C1 preenche.

C1 vai criar:
- `index.ts` com `db` (anon RLS) e `dbAdmin` (service role)
- `tenant.ts` com helper `withTenant(clinicId, fn)`
- `schema/` re-exportando schemas dos contexts
- `types.ts` com convenções (uuid, timestamptz, snake_case)
