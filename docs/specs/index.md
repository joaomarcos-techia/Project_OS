---
title: "Especificações e progresso"
description: "Onde encontrar propostas e decisões de produto e como confrontá-las com a implementação atual."
docType: "index"
---

Uma especificação pode misturar proposta aprovada, implementação parcial e
checkpoints históricos. Seus marcadores de progresso devem ser lidos junto do
código e das evidências, e não como garantia de recurso ativo em Produção.
O [catálogo](/catalog) lista todos os arquivos desta coleção.

## Fontes de referência por assunto

| Assunto | Referência de implementação atual | Material de projeto |
| --- | --- | --- |
| Planos, médicos e equipe | [Planos e acessos](/billing/plans-and-seats) | `specs/decisoes-oferta-e-precificacao-2026-10.md` |
| Assinaturas e mudança de plano | [Billing SaaS](/billing/subscriptions) | Decisões da oferta e runbooks da janela correspondente |
| Bruto, taxas, crédito e repasse | [Política financeira](/domains/financial-policy) | `specs/politica-financeira-camadas.md` |
| Cadastro e confirmação | [Cadastro autônomo](/onboarding/signup) | ADRs de onboarding e registros do funil |
| Arquitetura e fronteiras | [Arquitetura](/architecture/overview) | [Decisões](/adr/index) |

## Documentos extensos

`qorov2.md`, `discovery-log.md`, `desing_novo.md` e a especificação financeira
preservam detalhes e histórico. A leitura inicial deve começar pelas páginas
focadas acima. Não extraia de um checkpoint antigo uma regra comercial que já
foi substituída; por exemplo, preço diferente por Pix/cartão não integra a regra
atual descrita na referência financeira.

## Antes de implementar uma proposta

Identifique a decisão aprovada, a dependência, os contratos afetados e o teste de
aceite. Ausência de implementação não autoriza inventar regra, preço ou permissão.
Uma proposta não pode alterar contratos legados por consequência de documentação.
