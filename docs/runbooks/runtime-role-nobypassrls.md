# Role runtime sem BYPASSRLS

## Status

Reference — DEV validado em 2026-08-18; produção permanece `REQUIRES_MANUAL_VALIDATION`.

## Objetivo

`DATABASE_URL_RUNTIME` deve autenticar como papel de login `NOBYPASSRLS` capaz de `SET LOCAL ROLE authenticated`. Sem `withTenant`, policies resolvem sem clinic GUC e retornam zero/negam em vez de herdar o poder de `postgres`.

`dbAdmin` e `dbWorker` continuam no papel privilegiado por desenho.

## Validação obrigatória

No ambiente autorizado, prove separadamente:

1. role existe, pode login e `rolbypassrls = false`;
2. conexão real pelo mesmo host/porta/usuário do Transaction Pooler funciona;
3. role pode assumir `authenticated` e tem grants/default privileges necessários;
4. query tenant sem GUC retorna zero/nega;
5. `withTenant(A)` vê A e não B;
6. login/navegação do candidato funcionam após configurar env/redeploy.

## Evidência DEV — 2026-08-18

Pelo mesmo Transaction Pooler usado pelo localhost:

- `qoro_runtime`: `LOGIN`, `NOBYPASSRLS`, sem superuser, create role/database ou create no schema;
- membership em `authenticated`, DML sem privilégios DDL e timeouts 30s/15s;
- conexão direta sem GUC e conexão após `SET LOCAL ROLE authenticated` sem GUC viram zero pacientes;
- duas clínicas com pacientes foram alternadas em transações independentes; cada uma viu somente suas próprias linhas.

Isso aprova DEV, não o role/env do deploy de produção.

Não documente host, project ref ou senha reais. Monte a URL a partir da connection string funcional do mesmo ambiente, mudando apenas o usuário/credencial; Supavisor é regional.

## Rollback operacional

Se o login do papel falhar após deploy, remova/reverta `DATABASE_URL_RUNTIME` e redeploy conforme procedimento da plataforma. Isso volta ao fallback privilegiado e perde fail-closed adicional; trate como contenção temporária, não resolução.
