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

Preparada em 09/11/2026; referências oficiais consultadas nessa data. **Não enviada pela engenharia; nenhuma resposta do suporte recebida.** O founder deve copiar o assunto e a mensagem acima para o canal oficial. Não incluir chaves, tokens, payloads, dados pessoais ou cartão. A resposta e o número do ticket devem ser registrados sem credenciais.
