# Desenvolvimento assistido por IA

## Status

Reference — uso seguro da documentação por agentes.

## Contexto mínimo

Leia [README](../README.md), [CURRENT-STATE](../CURRENT-STATE.md), o documento canônico do domínio e o código ao redor. Documentos `Historical` são pistas, não requisitos.

## Execução

- procure símbolos, callers, schema/migrations e testes antes de editar;
- preserve worktree do usuário;
- não invente tabela, endpoint, env ou provider;
- use implementação observável para resolver conflito documental;
- rode teste focado e gates proporcionais;
- reporte código/local/CI/deploy/provider separadamente.

## Documentação automática

Mudança arquitetural atualiza [VisãoGeral](../VisãoGeral.md) ou [context map](../architecture/context-map.md). Regra de domínio atualiza sua fonte canônica. Variável atualiza [environment](../development/environment.md). Cron/rota atualiza [backend](../backend/http-jobs-outbox.md) e os arquivos verificados por `check:observability`. Decisão duradoura atualiza [ADRs](../adr/README.md).

Não crie relatório de implementação permanente quando um diff/teste/CHANGELOG já preserva o histórico.
