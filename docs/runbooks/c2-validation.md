# Validação C2 — tenancy e RLS

## Status

Reference — checklist atual.

## Checks automatizados

1. rode `pnpm arch:db-check`, `pnpm check:migrations` e testes de `src/lib/db`/tenancy;
2. em banco autorizado, crie/identifique tenants A/B com fixtures não sensíveis;
3. prove A lê/escreve A e não lê/escreve B por `withTenant`;
4. prove ausência de GUC falha fechada no papel runtime;
5. prove `FORCE ROW LEVEL SECURITY`, policies e grants nas tabelas alteradas;
6. limpe somente fixtures identificadas.

## Test G — role switch no Transaction Pooler

Em cada ambiente, execute uma transação real pela mesma connection string do runtime e prove que `SET LOCAL ROLE authenticated` funciona, que o GUC é local à transação e que a conexão reutilizada volta ao papel/contexto padrão. Erro no role switch deve abortar a transação; `FORCE RLS` isoladamente não protege um papel com `BYPASSRLS`.

Não use `dbAdmin` para simular request tenant nem conclua isolamento apenas por inspeção de policy.
