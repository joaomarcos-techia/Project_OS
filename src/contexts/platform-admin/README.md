# Contexto: Platform Admin

**Responsável por:** Super admin actions, impersonate, audit events read, métricas operacionais da plataforma, dashboards de saúde.
**Não faz:** Operação de uma clínica específica (cada contexto cuida disso), cobrança ao cliente final (financial), billing da plataforma (tenancy/billing).
**Camada onde ganha conteúdo:** C15.
**Comunicação com outros contexts:** read-only em todos via `dbAdmin` (bypass RLS) com auditoria obrigatória.

Pasta vazia hoje. NÃO adicionar arquivos aqui antes da camada correspondente.
