---
title: "Limites e validações por ambiente"
description: "Separe limites de implementação, dependências externas e achados históricos antes de decidir uma mudança."
docType: "reference"
reviewedAt: "2026-11-05"
---

## Limites da implementação revisada

| Assunto | Limite ou condição | Referência |
| --- | --- | --- |
| Nova oferta | Até 5 médicos e até 3 acessos administrativos; sem compra online do quarto administrativo | [Planos e acessos](/billing/plans-and-seats) |
| Anual novo | Default de vendas desativado; contratos e código anual preservados | [Assinaturas](/billing/subscriptions) |
| Uso de IA | Referência com avisos, sem cobrança automática de excedente ou bloqueio por essa franquia | [Planos e acessos](/billing/plans-and-seats) |
| Estorno de paciente | Sem novas solicitações automáticas; decisão e ação da clínica, com fatos reconciliados | [Política financeira](/domains/financial-policy) |
| Documento fiscal | Comprovante de pagamento não equivale a NF ou recibo fiscal | [Política financeira](/domains/financial-policy) |
| IA | Provedor funcional Gemini; integração e capacidade dependem da configuração do ambiente | [Agente](/ai/agent) |
| Mensageria | Caminho funcional Meta Cloud API; presença de um adaptador não comprova outro provedor operacional | [Provedores](/integrations/providers) |
| Assinatura de URL | Uma URL já emitida pode continuar válida até TTL/cache; preferir os caminhos autenticados existentes | [Segurança](/security/model) |
| Agregado de caixa | Estorno fora da janela de recálculo pode exigir operação ampliada autorizada | [Agenda e financeiro](/domains/scheduling-financial) |

## O que exige evidência no ambiente alvo

- Revisão publicada, flags e segredos configurados no deployment.
- Journal e hashes de migrations, grants, RLS, role runtime e pools.
- Buckets privados, políticas, arquivos recuperáveis e configurações Auth.
- Webhooks, templates, opt-in, janela de envio e aceite/entrega Meta.
- Correspondência entre o provedor de pagamento e a persistência local.
- Widget/domínio e validação real do Turnstile no caminho de risco aplicável.
- Projeto, tier, faturamento e capacidade do Gemini, sem teste com dados clínicos.
- Crons, heartbeats, alertas e recuperação operacional.

Esses itens não recebem `FAIL` apenas porque não foram consultados nesta tarefa.
Uma revisão documental não deve repetir operações financeiras nem ampliar acesso.

## Achados de versões anteriores

A versão anterior desta página misturava limites estruturais com leituras remotas
datadas: 80 migrations, drift de `0051`, grants DEV, templates Meta e bounces de
e-mail. Esses registros continuam no histórico do Git e nos relatórios do
[catálogo](/catalog), mas **não são aqui reapresentados como situação atual**.
Também há provas de recuperação posteriores aos antigos marcadores “restore
pendente”; use o relatório correspondente, com seu ambiente e alcance.

Antes de reproduzir um achado histórico, confira se a mesma revisão, configuração
e condição ainda existem. Registre certeza e limite da evidência.

## Não inferir funcionalidade

Presença em especificação, placeholder ou nome de rota não comprova API pública,
failover de provedor, transcrição de áudio, editor visual de workflow, NF ou
recurso externo contratado. Consulte implementação, testes e configuração antes
de anunciar qualquer entrega.
