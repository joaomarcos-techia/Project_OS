# Troca de plano SaaS e cobrança recorrente — 17/10/2026

## Falha encontrada

No upgrade, o webhook do pagamento proporcional trocava `subscriptions.plan_id` e
`price_id` no Qoro, mas não alterava `value` da assinatura no Asaas. O cliente
ganhava o plano novo e continuava pagando a mensalidade antiga. No downgrade, o
cron alterava o valor recorrente com `updatePendingPayments: false` e trocava o
plano local, deixando uma parcela do novo ciclo já emitida com o preço antigo.
O Asaas pode emitir a cobrança até 40 dias antes do vencimento. Cobranças antigas
pagas não devem ser apagadas; uma dívida vencida do ciclo anterior também não deve
ser reprecificada pelo novo plano.

Havia dois desvios adicionais: Pro → Clínica era bloqueado com mais de um usuário,
apesar da cota atual de cinco; e uma campanha sem preço no plano de destino caía
silenciosamente no preço de tabela, podendo eliminar um desconto vitalício.

## Regra implementada

- A troca de preço só é aplicada no banco após releitura do Asaas confirmar a
  assinatura ativa e o valor recorrente de destino. O valor anterior remoto deve
  corresponder ao contrato local, ou já ser o destino de uma tentativa anterior.
- Todas as parcelas emitidas são paginadas. As do ciclo novo ainda abertas são
  atualizadas individualmente, preservando método e vencimento; a parcela vencida
  de ciclo anterior conserva o valor. O fluxo relê cada parcela e a listagem final.
- Parcela do novo ciclo já paga por valor diferente, em análise, sem vínculo ou
  listagem incompleta bloqueia a aplicação automática para revisão. Não há
  estorno, exclusão ou reemissão automática de histórico pago.
- Falha intermediária deixa o pedido pendente. Reentrega do webhook e o cron
  diário retomam a sincronização, sem repetir PUT confirmado. O cron também é
  backstop para upgrade pago cujo webhook se perdeu.
- Downgrade consulta `plan_limits.users` no pedido, antes de chamar o Asaas no
  cron, na aplicação transacional e na tela. A regra é `1 ≤ usuários ativos ≤
  limite do destino`, não “exatamente um”.
- Campanha com desconto exige preço vigente da mesma campanha no destino. Sem
  preço correspondente, o destino não aparece no catálogo de troca e o pedido é
  recusado; a assinatura atual permanece intacta.
- Upgrade com rateio zero não gera pedido `pending_payment` impossível de quitar.

## Evidência executada

- Antes da correção: 73/73 testes direcionados passaram, apesar da divergência
  entre Qoro e Asaas; o caso não era coberto.
- Depois: testes direcionados de provider, sincronização, webhook, cron, regra de
  campanha e capacidade passaram. Os testes incluem falha parcial, retry,
  readback divergente, parcela já paga e dívida antiga intacta.
- Suíte integral padrão: 5.512/5.512 testes em 524 arquivos, `exit 0`.
- Build otimizado Next 15.5.24 em cópia isolada, TypeScript, ESLint e Prettier:
  `exit 0`. O build não herdou `.env.local` nem credenciais reais.
- Asaas Sandbox, duas fixtures isoladas em 17/10/2026: uma assinatura BOLETO
  e uma CREDIT_CARD com cartão fictício da documentação do Sandbox. Em cada
  uma, upgrade 197 → 397, repetição idempotente e downgrade 397 → 197 foram
  confirmados por GET da assinatura e da parcela emitida. A parcela aberta foi
  removida, a assinatura cancelada, o cliente excluído, com readback das
  cobranças abertas. `exit 0` nas duas execuções do runner
  `scripts/security/subscription-plan-change-sandbox.ts`.
- A primeira tentativa de criar a fixture CREDIT_CARD recebeu HTTP 400,
  código `invalid_creditCard`. Nenhuma assinatura foi criada; o cliente foi
  excluído. Com os dados sintéticos do titular e o IP de teste ajustados, a
  segunda execução passou. O teste não atribui causalidade isolada a um campo.

## Limites da prova e rollout

Em 17/10/2026, `qoro.dev/precos` e `origin/main` da landing anunciam a oferta
contratável no app: Solo R$ 149, Clínica R$ 349, Pro R$ 699 e sete dias de teste
no cadastro autônomo. O PR #2 da landing já alinhou a descrição das integrações
e das condições atuais. A proposta Consultório/Clínica, adicionais por assento
e trial novo seguem nos PRs draft #40 (app) e #1 (landing); as telas de Preview
não mudam o catálogo nem autorizam anunciar esses valores como contratáveis.

O Sandbox testou cobranças já emitidas de assinatura BOLETO e CREDIT_CARD,
mas não o pagamento real de rateio, a entrega de webhook no Qoro nem dívida
antiga vencida externa. Esta última condição tem teste determinístico, mas não
PASS externo. Para assinatura com cartão, o Asaas exige a funcionalidade de
tokenização habilitada ao alterar valor ou vencimento; o PASS no Sandbox não
comprova que ela esteja habilitada para toda conta de produção.
Também não houve mudança de contrato real ou banco de produção. Até existir
evidência de upgrade/downgrade de uma fixture Qoro em Preview/DEV com webhook,
o round trip completo **banco → Asaas → webhook → banco → UI** fica parcial.

Ao publicar, observar `billing.plan_change.apply_error` e
`billing.plan_change.upgrade_reconcile_error`. Pedido bloqueado por cobrança do
novo ciclo já paga com valor antigo requer revisão humana da diferença; não
apagar uma cobrança paga nem fazer estorno automático para “limpar” a divergência.

Referências do provedor: [alterar assinatura](https://docs.asaas.com/reference/atualizar-assinatura-existente),
[alterar cobrança](https://docs.asaas.com/reference/update-existing-payment) e
[FAQ de assinaturas](https://docs.asaas.com/docs/faq-assinaturas).
