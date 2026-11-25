# Resposta do suporte encaminhada pelo founder

Origem: mensagem integral recebida nesta conversa e atribuída a Guilherme, do suporte AbacatePay. Registrada em 10/11/2026. Não foi fornecido número de ticket nem acesso à conversa original do provedor; a transcrição é evidência do conteúdo encaminhado, não uma confirmação adicional da API. Não reenviar contato automaticamente. Os links abaixo são os da mensagem recebida.

> *Guilherme*:
> 1. Renovação no Sandbox (Dev mode)
> Hoje não existe endpoint, comando, fixture ou procedimento assistido para antecipar o próximo ciclo de uma assinatura no Dev mode. O único simulador disponível é o do Pix transparente: `POST /v2/transparents/simulate-payment`, ou `abacatepay payments simulate` pela [CLI](https://docs.abacatepay.com/pages/cli/overview). Ele não cobre renovação, renovação depois de `change-plan`/`record-usage` nem falha com retentativas. Como alternativa, a recomendação é validar o tratamento desses cenários com os payloads documentados dos webhooks `subscription.renewed`, `subscription.payment_failed` e `subscription.cancelled` (https://docs.abacatepay.com/pages/webhooks/events/subscriptions).
>
> 2. Conciliação sem webhook
> Hoje não existe endpoint para listar ou consultar as cobranças de uma assinatura. O objeto da assinatura (`GET /v2/subscriptions/get` e `/list`) traz `id`, `checkoutId` (o da contratação original), `status`, `method`, `amount`, `trialEndsAt` e `retryPolicy`, mas não tem histórico de ciclos ou faturas. O extrato (`GET /v2/bank-statement/list`) traz cada transação com `checkoutId` e `paymentIntentId`, sem campo nem filtro por `subs_`.
>
> O canal oficial para identificar cada cobrança é o webhook:
>
> - `subscription.completed`: a cobrança inicial, com `payment.id` e `receiptUrl`.
> - `subscription.renewed`: cada renovação paga, com um `payment.id` novo. O `checkout.id` do payload é um `bill_` da própria renovação, diferente do `checkoutId` original.
> - `subscription.payment_failed`: cada falha, com `installmentId`, `installmentNumber` e `retryNumber`. É isso que separa a renovação das retentativas.
>
> A recomendação é responder 2xx, guardar o `payment.id` de cada evento e usar o extrato (`paymentIntentId`) para conferir os valores que entraram no saldo.
>
> 3. Checkout individual e invalidação do link
> Não existe configuração de uso único. Um checkout pode gerar várias assinaturas, uma por cliente que pagar, e o `customerId` só pré-preenche os dados do cliente, sem bloquear um segundo pagador ([referência](https://docs.abacatepay.com/pages/subscriptions/reference)). O fluxo mais seguro é criar um checkout por cliente, com `customerId` e `externalId`. Assim que chegar o `subscription.completed`, valide com `GET /v2/subscriptions/list?checkoutId=bill_...`.
>
> Sobre a exclusão (`POST /v2/subscriptions/checkouts/delete`): o checkout deixa de aparecer nas listagens e as assinaturas já geradas continuam ativas. Cancelar a recorrência é outra operação: `POST /v2/subscriptions/cancel` em cada `subs_`. Ainda vou confirmar com o time se o link deixa de aceitar pagamento depois da exclusão e se há algum efeito sobre recibos, extrato, renovações, webhooks e `change-plan`. Faz bem em manter a fixture paga até lá.
>
> 4. Reembolso e disputa de assinatura
> É isso mesmo: o `POST /v2/checkouts/refund` não aceita cobrança de assinatura e não faz reembolso parcial ([referência](https://docs.abacatepay.com/pages/payment/refund)). O reembolso de uma cobrança de assinatura é feito pelo dashboard da AbacatePay, pelo próprio lojista. Também existe o [Portal do cliente](https://docs.abacatepay.com/pages/customer-portal/reference) (`POST /v2/customer-portal/create` com `customerId` e `checkoutId`), em que o próprio cliente pede o reembolso integral automático. Reembolsar uma cobrança de assinatura cancela a assinatura na hora, e disparam os eventos `checkout.refunded` e `subscription.cancelled`. Reembolso parcial não está disponível.
>
> Na disputa, as cobranças de assinatura seguem os mesmos eventos de checkout: `checkout.disputed` quando a contestação é aberta e `checkout.lost` quando a disputa é perdida. O `payerInformation` varia conforme o método. Os payloads estão em [Webhooks de checkout](https://docs.abacatepay.com/pages/webhooks/events/checkout). No extrato (`GET /v2/bank-statement/list`), o bloqueio aparece como movimentação, com o status `UNDER_DISPUTE`. Hoje não há simulador de reembolso ou disputa de assinatura no Dev mode.
