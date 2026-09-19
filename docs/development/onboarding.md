# Onboarding de desenvolvimento

## Status

Reference — roteiro de leitura para quem entra no projeto.

## Dia 1: mapa

1. [Estado atual](../CURRENT-STATE.md)
2. [Arquitetura](../VisãoGeral.md)
3. [Context map](../architecture/context-map.md)
4. [Convenções](../CONVENTIONS.md)
5. [Setup](setup.md)

## Dia 2: fluxo de uma mutation

Escolha uma Server Action e siga: schema Zod → auth/permission → idempotência/audit → `withTenant` → repository → outbox → handler/testes. Leia [banco](../database/schema.md) e [backend](../backend/http-jobs-outbox.md).

## Dia 3: domínio e validação

Leia a fonte canônica do domínio, execute testes focados, depois os gates de [testing.md](testing.md). Não use documentos históricos como especificação.
