# ADR-007 — Padrão de RLS

## Status

Accepted — Reference. Detalhes canônicos em [database/schema.md](../database/schema.md).

## Decision

- Tabela tenant-scoped recebe `clinic_id`, `ENABLE RLS` e `FORCE RLS`.
- Request tenant usa `withTenant`, `SET LOCAL ROLE authenticated` e GUCs dentro da mesma transação/conexão.
- Repository recebe `Tx`; abrir pool paralelo perde o contexto e é proibido.
- Policies usam contexto de backend/claims de forma explícita e InitPlan quando aplicável.
- Tabelas globais/plataforma não recebem policy tenant artificial.
- Produção deve preferir papel runtime `NOBYPASSRLS` em `DATABASE_URL_RUNTIME`.

## Consequence

Autorização de aplicação continua obrigatória. RLS limita linha/tenant, não substitui permission nem workflow de negócio.
