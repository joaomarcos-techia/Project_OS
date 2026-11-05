---
title: "Validação e evidências"
description: "Como localizar e interpretar provas de testes, auditorias e operações sem tratá-las como estado atual do serviço."
docType: "index"
---

Relatórios nesta coleção são registros de uma execução. Uma evidência é válida
para a revisão, o ambiente e o cenário informados; não é uma declaração permanente
de saúde de Produção. Consulte os arquivos pelo [catálogo](/catalog).

## Como interpretar um resultado

| Estado | Significado |
| --- | --- |
| `PASS` | Cenário executado e comportamento esperado observado |
| `FAIL` | Cenário executado e problema confirmado |
| `PARTIAL` | Parte da implementação ou da validação foi comprovada |
| `BLOCKED` | Uma dependência identificada impede executar ou concluir |
| `NOT RUN` / `NOT TESTED` | Não houve execução suficiente para avaliar |
| `SKIP` | O runner ignorou o caso; não conta como aprovação |

## O que conferir

1. Data, SHA ou versão, ambiente e identidade sintética da fixture.
2. Comando, resultado e origem da evidência.
3. Diferença entre teste unitário com mock, banco isolado, integração com provedor
   e entrega externa observada.
4. Limites: o que foi ignorado, bloqueado, simulado ou não inspecionado.
5. Limpeza das fixtures e preservação de dados e contratos reais.

Não some resultados de revisões diferentes para afirmar que o código atual passou
em uma única execução. Um Checkout aceito pelo provedor não demonstra por si só
webhook recebido, persistência, cota liberada ou tela correta.

## Coleções relacionadas

- `quality/`: relatórios de engenharia e validação.
- `audits/`, `achados/`, `evidence/`: auditorias e evidências com escopo próprio.
- `c16/`: observabilidade e material da etapa correspondente.
- `security/acoes.md`: inventário gerado; não editar manualmente.
- [Testes e comandos](/development/testing): como produzir novas evidências.

Esses arquivos permanecem no repositório. Os relatórios brutos não são publicados
automaticamente como manual vigente pelo portal local.
