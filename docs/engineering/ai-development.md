---
title: "Desenvolvimento assistido por IA"
description: "Desenvolvimento assistido por IA — responsabilidades, fontes e limites da implementação."
docType: "reference"
---

## Status

Reference — uso seguro da documentação por agentes.

## Contexto mínimo

Leia [README](/index), [CURRENT-STATE](/overview/current-state), o documento canônico do domínio e o código ao redor. Documentos `Historical` são pistas, não requisitos.

## Execução

- procure símbolos, callers, schema/migrations e testes antes de editar;
- preserve worktree do usuário;
- não invente tabela, endpoint, env ou provider;
- use implementação observável para resolver conflito documental;
- rode teste focado e gates proporcionais;
- reporte código/local/CI/deploy/provider separadamente.

## Documentação automática

Mudança arquitetural atualiza [VisãoGeral](/architecture/overview) ou [context map](/architecture/context-map). Regra de domínio atualiza sua fonte canônica. Variável atualiza [environment](/development/environment). Cron/rota atualiza [backend](/backend/http-jobs-outbox) e os arquivos verificados por `check:observability`. Decisão duradoura atualiza [ADRs](/adr/index).

Não crie relatório de implementação permanente quando um diff/teste/CHANGELOG já preserva o histórico.
