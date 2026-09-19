# ADR-010 — Funções privilegiadas

## Status

Accepted — Reference.

## Decision

Use `SECURITY DEFINER` ou `dbAdmin` apenas para uma seam mínima que a arquitetura não pode executar como tenant. A operação deve:

- fixar `search_path` e validar ids/tipos;
- limitar linhas pelo `clinic_id` recebido e contexto autenticado;
- conceder `EXECUTE`/uso ao menor papel;
- auditar a ação na mesma unidade de trabalho;
- ter teste de privilégio/cross-tenant.

Não transformar função privilegiada em repository genérico nem contornar RLS para corrigir uma query comum.
