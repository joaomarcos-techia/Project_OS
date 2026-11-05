---
title: "Documentação técnica do Qoro"
description: "Entenda o sistema, encontre a regra vigente e localize decisões, procedimentos e evidências."
sidebarTitle: "Início"
docType: "orientation"
---

O **Qoro**, chamado ClinicaOS no repositório, reúne operação clínica, agenda,
prontuário, financeiro, atendimento por WhatsApp e assinatura SaaS. Esta é a
documentação do sistema para quem o desenvolve, opera e audita.

## Comece pela sua tarefa

| Preciso de… | Leia primeiro | Continue em |
| --- | --- | --- |
| Reconstruir o contexto do projeto | [Estado atual](/overview/current-state) | [Arquitetura](/architecture/overview) e [contextos](/architecture/context-map) |
| Preparar o ambiente | [Setup](/development/setup) | [Variáveis](/development/environment) e [testes](/development/testing) |
| Entender cadastro e contratação | [Cadastro autônomo](/onboarding/signup) | [Planos e acessos](/billing/plans-and-seats) e [assinaturas](/billing/subscriptions) |
| Entender atendimento e dinheiro do paciente | [Agenda e financeiro](/domains/scheduling-financial) | [Política financeira](/domains/financial-policy) |
| Investigar falha ou preparar uma operação | [Runbooks](/runbooks/index) | [Recuperação](/runbooks/disaster-recovery) e [migrations](/runbooks/migrations) |
| Localizar uma decisão ou prova antiga | [Decisões](/adr/index) | [Evidências](/quality/index), [specs](/specs/index) e [catálogo completo](/catalog) |

## Como esta documentação está organizada

- **Visão geral:** estado do repositório, trilhas de leitura e mapa dos documentos.
- **Arquitetura:** fronteiras, persistência, segurança e contratos entre camadas.
- **Domínios:** regras e fluxos do produto, sem misturar cobrança SaaS com dinheiro do paciente.
- **Desenvolvimento:** ambiente, comandos e critérios para alterar o sistema.
- **Operação:** procedimentos executáveis, limitações e localização das evidências.
- **Decisões:** ADRs datados e suas relações com as regras atuais.

Cada assunto possui uma referência principal. Relatórios e checkpoints não
redefinem contratos descritos nos documentos canônicos.

## Ordem de autoridade

1. Código, migrations e configuração versionada da revisão examinada.
2. Testes e evidências executadas, com ambiente, data e limites identificados.
3. Documentação canônica do assunto.
4. Especificações, propostas, auditorias e relatos históricos.

**Implementação no código não comprova ativação ou saúde em Produção.** Uma
evidência de Preview não substitui uma evidência de Produção; um teste com mocks
não comprova entrega de um provedor externo.

## Padrão de manutenção

Esta organização segue as convenções de páginas, metadados, navegação e validação
do Mintlify. A configuração está em `docs.json`, sem dependência de produção no
aplicativo. Veja [como manter a documentação](/engineering/documentation).

O projeto de documentação é técnico e interno. Preparar arquivos compatíveis com
Mintlify não publica este conteúdo nem configura controle de acesso. Não conecte
auditorias, dados operacionais ou o repositório a um site público sem revisar o
conteúdo e a autorização de acesso.
