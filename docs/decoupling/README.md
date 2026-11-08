# Plano de portabilidade do Qoro

**Status: proposta de engenharia, 06/11/2026. Nenhuma migração autorizada por este documento.**

Comece pelo [resumo executivo](01-resumo-executivo.md). Para implementar, siga o [backlog rastreável](03-roadmap-mestre.md), os [gates](09-gates-de-validacao.md) e os procedimentos de [cutover](../runbooks/provider-cutover.md) e [rollback](../runbooks/provider-rollback.md).

Para iniciar a execução com outra IA, use o [prompt de implementação por camadas](../prompts/iniciar-desacoplamento-e-portabilidade-qoro.md). Ele inclui a ordem de leitura, os arquivos por capacidade, os testes e os limites de autorização.

Este pacote é documentação **interna de engenharia**. Não integra a central de ajuda pública do produto.

## Mapa de leitura

| Pergunta                                  | Documento                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| O que foi realmente inspecionado?         | [Contexto, fontes e limites](../architecture/01-contexto-atual.md)                                                                                                       |
| Onde estão as dependências?               | [Inventário](../architecture/02-inventario-de-dependencias.md), [JSON por arquivo/linha](inventario-codigo.json) e [matriz de lock-in](02-matriz-vendor-lock-in.md)      |
| Como os fluxos funcionam?                 | [Diagramas atuais](../architecture/03-diagramas-as-is.md) e [grafo gerado de imports](../architecture/dependency-graph.mmd)                                              |
| Qual arquitetura propor?                  | [Destino](../architecture/04-arquitetura-to-be.md), [contratos](../architecture/05-contratos-e-adaptadores.md), [decisões](../architecture/06-decisoes-arquiteturais.md) |
| O que mudar primeiro e em quais arquivos? | [Roadmap e tarefas](03-roadmap-mestre.md)                                                                                                                                |
| Como sair de cada fornecedor?             | [Supabase](04-plano-supabase.md), [Asaas](05-plano-asaas.md), [Vercel](06-plano-vercel.md)                                                                               |
| Como testar e medir?                      | [Cenários](07-matriz-edge-cases.md), [testes](08-plano-de-testes.md), [gates](09-gates-de-validacao.md), [aceite](13-criterios-de-aceite.md)                             |
| Como evitar perdas e reverter?            | [Riscos](10-matriz-de-riscos.md), [migração](11-plano-de-migracao.md), [rollback](12-plano-de-rollback.md)                                                               |
| Quanto falta e quanto pode custar?        | [Scorecard](14-scorecard-de-portabilidade.md), [cronograma](15-cronograma-e-dependencias.md)                                                                             |

## Convenções

- **CONFIRMADO:** observado no código/configuração versionada ou em comando desta rodada.
- **INFERIDO:** conclusão arquitetural derivada das fontes; não equivale a incidente observado.
- **PENDENTE:** requer ensaio, acesso ou fotografia operacional atual.
- **DECISÃO:** proposta sujeita à aprovação descrita no backlog.

`PASS`, `FAIL`, `BLOCKED` e `CONDITIONAL` são decisões de gates executados. Uma tarefa não iniciada fica **PENDENTE**, sem receber PASS. Os gates de migração não foram executados nesta rodada de planejamento.

## Resultado desta rodada

- Código de produto, preços, contratos, CI/CD, provedores e produção: sem alteração.
- Auditoria estática de app e landing, grafo real de imports e plano: produzidos nesta branch.
- Caracterização local: **12 arquivos / 216 testes aprovados**, detalhados no [plano de testes](08-plano-de-testes.md).
- Execução em outro host, gateway, Auth ou Storage: **não executada**. Não há declaração de independência adquirida.
