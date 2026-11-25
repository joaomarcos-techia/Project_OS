# Solicitação ao suporte — homologação de assinaturas V2

## Assunto sugerido

Homologação API V2: renovação Sandbox, conciliação, checkout individual e reembolso de assinaturas

## Mensagem completa ao suporte

Olá, equipe AbacatePay!

Estamos homologando a API V2 em Sandbox para as assinaturas mensais do Qoro, um SaaS para clínicas. Já validamos contratação inicial e cancelamento. Precisamos esclarecer quatro lacunas antes de ativar a integração em produção.

**1. Renovação no Sandbox**

Existe procedimento oficial para antecipar o próximo ciclo mensal, sem aguardar um mês? Precisamos testar renovação efetivamente paga, renovação após alteração de plano/adicionais e falha de renovação seguida de retentativas. Conhecemos `retryPolicy` e os eventos de falha; a dúvida é como provocar esses cenários de forma reproduzível no Sandbox. Há endpoint, comando, fixture ou procedimento assistido? O simulador de Pix transparente documentado não parece cobrir esses casos.

**2. Conciliação quando nenhum webhook de renovação chega**

Como listar ou consultar individualmente as cobranças de uma assinatura e correlacionar, de forma autoritativa, assinatura, ciclo, vencimento e pagamento? O `checkoutId` da assinatura identifica a contratação original; precisamos recuperar também as cobranças de renovação sem depender de um webhook previamente recebido. Qual é o procedimento oficial? Como distinguir cobrança inicial, renovações e retentativas, inclusive quando existem pagamentos de mesmo valor e datas próximas? Se houver histórico de ciclos/faturas ou outro endpoint, poderiam enviar a referência e um exemplo sanitizado da resposta?

**3. Checkout individual e invalidação do link após pagamento**

Sabemos que um checkout pode gerar várias assinaturas e que excluir o checkout não cancela as assinaturas já geradas. Existe configuração de uso único ou vínculo exclusivo a um cliente que impeça duas contratações, inclusive antes da chegada do primeiro webhook? Se não, qual é o fluxo oficialmente recomendado?

A exclusão do checkout já pago é recomendada para invalidar o link? Quais consultas financeiras, pagamentos, recibos e históricos continuam disponíveis após essa exclusão? Ela afeta renovações, webhooks, conciliação ou futuras alterações de plano? Precisamos diferenciar claramente invalidar o link de cancelar a recorrência. Não excluiremos nossa fixture paga enquanto essas garantias não estiverem esclarecidas.

**4. Reembolso e disputa de assinatura V2**

A documentação informa que `/checkouts/refund` não aceita cobranças de assinatura e não oferece reembolso parcial. Qual procedimento suportado atende essas cobranças: painel, suporte ou outro recurso oficial? Existe alternativa suportada para reembolso parcial? Como reembolso, estorno e disputa são refletidos nos eventos e nas consultas da API, inclusive no desfecho da disputa? Como homologar esses cenários no Sandbox?

Pedimos referências atuais, exemplos sanitizados e procedimentos reproduzíveis. Se algum recurso não estiver disponível, pedimos que indiquem essa limitação e a alternativa recomendada. Podemos fornecer identificadores de fixtures de teste posteriormente, por canal seguro, sem credenciais ou dados de clientes.

Obrigado!

## Links de referência

- [Simulador de pagamento transparente](https://docs.abacatepay.com/pages/transparents/simulate-payment).
- [Eventos de assinaturas e retentativas](https://docs.abacatepay.com/pages/webhooks/events/subscriptions).
- [Referência de assinaturas](https://docs.abacatepay.com/pages/subscriptions/reference).
- [Listagem de assinaturas](https://docs.abacatepay.com/pages/subscriptions/list).
- [Exclusão de checkout — fonte oficial](https://github.com/AbacatePay/documentation/blob/main/pages/subscriptions/checkouts-delete.mdx).
- [Limitações de reembolso](https://docs.abacatepay.com/pages/payment/refund).

## Resumo das respostas esperadas

1. Procedimento oficial para produzir renovação paga, alteração de plano e falha/retry em Sandbox, ou confirmação de indisponibilidade.
2. Consulta/correlação autoritativa cobrança–assinatura–ciclo sem webhook, ou limitação e procedimento de recuperação.
3. Garantia de uso único ou contenção recomendada, mais as consultas e operações preservadas após invalidar um checkout pago.
4. Procedimento suportado de reembolso/disputa para assinatura V2, eventos/readbacks e ensaio Sandbox.

## Controle da solicitação

Preparada em 09/11/2026; referências oficiais consultadas nessa data. No checkpoint `75fe1e74`, foi apresentada no chat e salva, sem envio pela engenharia.

**Checkpoint anterior:** o proprietário enviou a solicitação. **Atualização de 09/11/2026: resposta recebida de Guilherme, encaminhada pelo proprietário no chat.** Não reenviar a solicitação. O estado atual está abaixo; a mensagem original permanece como histórico, não como lista de quatro perguntas ainda sem resposta. Não foi informado um número de ticket.

O texto acima fica preservado como registro da solicitação original. Registrar eventual número de ticket posteriormente, sem chaves, tokens, payloads, dados pessoais ou cartão.

## Resposta recebida e consequência técnica — 09/11/2026

| Gate | Informação confirmada pelo suporte | Estado da homologação e próxima ação |
|---|---|---|
| E1 — renovação Sandbox | Não existe acelerador de ciclo, fixture ou procedimento assistido. O simulador transparente não cobre recorrência, mudança de plano nem falha/retry. | Limitação confirmada. Fixtures de webhooks validam o código local, não uma renovação financeira externa. Manter observação temporal separada e submeter eventual aceite de risco ao founder. Não pedir outro endpoint de simulação. |
| E2 — ausência de todos os webhooks | Não há consulta de cobranças/ciclos por assinatura. A assinatura expõe somente o checkout original. O extrato não traz vínculo `subs_`. | Limitação confirmada. Persistir `payment.id` recebido e comparar com `paymentIntentId` do extrato; não inferir vínculo por preço/data/cliente. Recuperação do inbox recebido existe; descoberta de uma renovação nunca recebida não é garantida e exige procedimento operacional/aceite explícito. |
| E3 — checkout reutilizável | Não existe uso único. `customerId` só preenche dados. Criar checkout por cliente com `externalId` e conferir assinaturas pelo checkout após conclusão. Excluir o checkout preserva assinaturas. | **Ainda pendente de confirmação do time do provedor:** se a URL deixa de aceitar pagamento e quais efeitos existem nas consultas, recibos, extrato, renovações, eventos e mudança de plano. Não excluir a fixture paga nem declarar que o monitor impede um segundo pagamento externo. |
| E4 — refund/disputa | Refund integral pelo painel ou portal; a API de refund avulso não atende assinatura. Refund cancela a assinatura imediatamente e emite `checkout.refunded` + `subscription.cancelled`. Disputa emite `checkout.disputed` e, se perdida, `checkout.lost`. Sem simulador recorrente. | Procedimento esclarecido; execução externa ainda NOT RUN. Preservar ADR-071: não revogar o período pago automaticamente, registrar/revisar. Não oferecer reembolso parcial nem publicar portal sem revisar seus efeitos. |

Eventos de renovação paga têm um novo `payment.id` e um `checkout.id` da própria renovação. A falha possui `installmentId`, `installmentNumber` e `retryNumber`, que distinguem ciclos e tentativas. O inbox atual preserva IDs financeiros e deduplica pelo evento; os detalhes de tentativa não são persistidos no DTO mínimo e não são usados para cobrar, conceder acesso ou contar um novo ciclo. Não afirmar visibilidade por tentativa que ainda não foi implementada.

O receptor só confirma aceitação após persistência segura; responder 2xx antes de gravar o inbox perderia essa proteção. O código não usa o webhook isolado para conceder direitos sem as provas de vínculo/pagamento/ciclo existentes.

Referências oficiais conferidas: [assinaturas](https://docs.abacatepay.com/pages/subscriptions/reference), [eventos recorrentes](https://docs.abacatepay.com/pages/webhooks/events/subscriptions), [eventos de checkout](https://docs.abacatepay.com/pages/webhooks/events/checkout), [refund](https://docs.abacatepay.com/pages/payment/refund) e [portal](https://docs.abacatepay.com/pages/customer-portal/reference). A confirmação direta de Guilherme complementa as limitações documentadas; não representa um teste externo executado pelo Qoro.
