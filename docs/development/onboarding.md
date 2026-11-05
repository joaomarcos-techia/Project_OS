---
title: "Onboarding de desenvolvimento"
description: "Onboarding de desenvolvimento — responsabilidades, fontes e limites da implementação."
docType: "reference"
---

## Status

Reference — roteiro de leitura para quem entra no projeto.

## Dia 1: mapa

1. [Estado atual](/overview/current-state)
2. [Arquitetura](/architecture/overview)
3. [Context map](/architecture/context-map)
4. [Convenções](https://github.com/joaomarcos-techia/Project_OS/blob/af677c00cfb9a4faa8474ddbf1d69d489d8c8849/docs/CONVENTIONS.md)
5. [Setup](/development/setup)

## Dia 2: fluxo de uma mutation

Escolha uma Server Action e siga: schema Zod → auth/permission → idempotência/audit → `withTenant` → repository → outbox → handler/testes. Leia [banco](/database/schema) e [backend](/backend/http-jobs-outbox).

## Dia 3: domínio e validação

Leia a fonte canônica do domínio, execute testes focados, depois os gates de [testing.md](/development/testing). Não use documentos históricos como especificação.
