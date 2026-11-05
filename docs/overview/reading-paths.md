---
title: "Trilhas de leitura"
description: "Percursos curtos para retomar o projeto, desenvolver, operar ou auditar um fluxo."
docType: "orientation"
---

## Retomar o projeto sem o histórico da conversa

1. Leia o [estado atual](/overview/current-state) e a revisão de código que ele descreve.
2. Reconstrua as fronteiras pela [arquitetura](/architecture/overview) e pelo
   [mapa de contextos](/architecture/context-map).
3. Localize a regra do domínio no [índice](/index).
4. Confira a implementação indicada e as evidências datadas. Não use um checkpoint
   antigo como prova de que uma funcionalidade ainda está pendente.
5. Antes de mudar comportamento, leia os ADRs relacionados e os
   [critérios de mudança](/engineering/decision-guide).

## Alterar cadastro ou cobrança SaaS

Leia [cadastro autônomo](/onboarding/signup),
[convites](/onboarding/invitations), [planos e acessos](/billing/plans-and-seats)
e [assinaturas](/billing/subscriptions). Depois siga os contratos de rota,
reservas e reconciliação no código. O sucesso do checkout não deve ser confundido
com pagamento confirmado ou clínica provisionada.

## Investigar uma conversa ou agendamento

Leia [agente](/ai/agent), [agenda](/domains/scheduling-financial) e
[WhatsApp](/whatsapp-connection-flow). Separe mensagem gerada, aceite do
provedor, confirmação de entrega, chamada de ferramenta e alteração persistida.

## Investigar dinheiro do paciente

Leia [política financeira](/domains/financial-policy) e os ADRs de pagamentos.
Separe sinal, crédito antecipado, recebível, taxa do provedor e repasse ao médico.
Uma promessa da IA ou um redirecionamento de checkout não comprovam liquidação.

## Preparar uma publicação ou recuperação

Comece pelos [runbooks](/runbooks/index). Confirme revisão, ambiente e
autorização da operação. Use o procedimento de recuperação adequado a banco,
Storage e configuração de Auth: esses três elementos não são o mesmo backup.

## Auditar evidências

Use o [catálogo](/catalog) e o [índice de qualidade](/quality/index).
Registre `PASS`, `FAIL`, `PARTIAL`, `BLOCKED` ou `NOT TESTED` com a evidência que
sustenta o estado. Limite conclusões ao ambiente e ao cenário efetivamente testados.
