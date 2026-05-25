# ADR-002 — RLS Postgres como defesa de isolamento de tenant

**Status:** accepted
**Date:** 2026-05-25

## Context

No V1 (Firestore), isolamento de tenant era feito via `where clinicId == X` manual em CADA query. Resultado: 537 ocorrências do filtro espalhadas, zero garantia que alguma estava faltando, primeira vez que esquecemos = vazamento de dados entre clínicas. Em saúde, isso é catastrófico (LGPD, multa, perda de licença para operar).

V2 precisa de uma defesa que **NÃO depende de disciplina do desenvolvedor**. Precisa ser falha-segura: o default é "ninguém vê nada", e cada policy abre acesso explícito. Postgres tem isso nativo: Row Level Security.

## Decision

**Toda tabela tenant-scoped tem RLS habilitada no MESMO migration do `CREATE TABLE`.** Sem exceção, sem "depois eu adiciono", sem "essa tabela é interna".

Pattern aplicado em toda tabela com `clinic_id`:

```sql
ALTER TABLE <X> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant access" ON <X>
  FOR ALL
  USING (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = (auth.jwt() ->> 'clinic_id')
    OR (auth.jwt() ->> 'role') = 'super_admin'
  )
  WITH CHECK (
    clinic_id::text = current_setting('app.current_clinic', true)
    OR clinic_id::text = (auth.jwt() ->> 'clinic_id')
    OR (auth.jwt() ->> 'role') = 'super_admin'
  );
```

Em rotas autenticadas, o tenant vem do JWT (`auth.jwt() ->> 'clinic_id'`). Em workers/jobs, o tenant é setado explicitamente via `SET LOCAL app.current_clinic = $clinicId` dentro de uma transação (helper `withTenant()` em `src/lib/db/tenant.ts`).

Dois clients Drizzle convivem (`src/lib/db/`):
- `db` — usa `authenticated` role do Supabase, sujeito a RLS. **Default.**
- `dbAdmin` — usa `service_role`, bypass de RLS. Permitido SOMENTE em: workers, scripts CLI, rotas super_admin.

## Consequences

- Defesa em profundidade: mesmo se um endpoint esquecer de filtrar por clínica, o banco bloqueia.
- `dbAdmin` precisa de auditoria obrigatória (registrar TODA leitura/escrita feita com ele — vem em C4).
- Custo de cada query: RLS adiciona ~5-10% overhead. Aceito.
- Migration mais verbosa (uma policy por tabela). Mitigado por helper `defaultTenantPolicy(tableName)` em C2.
- Test obrigatório a cada novo contexto: criar 2 clínicas, garantir que clínica A não vê dados de B.

## Alternatives

- **`WHERE clinic_id = X` manual no app (V1):** rejeitada — gerou o desastre que motivou V2.
- **Middleware app-level que injeta `where` automaticamente:** rejeitada — abstrações ORM costumam vazar (raw SQL, transactions); RLS é uma camada que não vaza.
- **Postgres schemas por tenant (`schema_clinica_X`):** rejeitada — não escala para 1000 clínicas (catalog bloat, migration complexa), e cross-clinic admin query vira pesadelo.
- **RLS habilitado depois (em C2/C3):** rejeitada — abre precedente. Primeira tabela sem RLS = todas as próximas viram "também não precisam".

## References

- `Documentação/PlanoAção.md` seções 1.3, 2.1, 2.2 (C2 RLS Foundation)
- ADR-001 (Bounded Contexts) — RLS é a defesa de baixo nível que protege o contrato
- ADR-005 (Supabase) — Supabase Auth alimenta `auth.jwt()`
