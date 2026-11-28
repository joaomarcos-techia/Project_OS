# ADR-068 — alteração de plano na AbacatePay

## Complemento — Pix Automático, 24/11/2026

A alternativa C abaixo continua sendo a mudança dentro da **mesma assinatura no cartão**. Para Pix Automático, a autorização bancária tem valor fixo; a AbacatePay só admite `change-plan` sem mudança de valor. Uma mensalidade diferente exige cancelar a renovação vigente e criar uma nova assinatura com autorização bancária, conforme [ADR-070](070-abacatepay-cancellation-and-recontract.md). O Qoro conserva o período já pago e só oferece o novo checkout após o seu término. Nenhum novo plano ou médico é liberado antes do pagamento integral confirmado. A implementação candidata está no PR #53, commit `8f8cd606`; não foi publicada nem altera Asaas.

Status: **alternativa C aprovada pelo founder; implementada e validada localmente em 09/11/2026; homologação externa pendente**. Decisão de 08/11/2026. Aplica-se somente às futuras assinaturas SaaS AbacatePay. Não muda Asaas, contratos antigos ou pagamentos dos pacientes.

## Evidência e problema

A [API V2 change-plan](https://docs.abacatepay.com/pages/subscriptions/change-plan) agenda o novo produto para o próximo ciclo, devolve um pedido `PENDING` e substitui uma alteração pendente anterior. Não foi localizada uma consulta documentada desse pedido que comprove o próximo valor e sua data efetiva. `ACTIVE` da assinatura não comprova pagamento, preço futuro ou período pago. O [GET da assinatura](https://docs.abacatepay.com/pages/subscriptions/get) documenta identificadores, valor/estado atual e trial, mas não promete início/fim do período nem próximo vencimento. Não inventar esses campos.

No Asaas, o Qoro libera upgrade após confirmar o proporcional e sincronizar a recorrência. Conservar o mesmo critério na AbacatePay exige comprovação adicional. O comando candidato retorna somente `pending/next_cycle`.

## Alternativas

| Alternativa                                                  | Suporte e implementação                                                                                                           | Experiência e diferenças                                                                    | Riscos e recuperação                                                                                                                                 | Testes e condição de ativação                                                                                                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: imediato com proporcional e recorrência comprovada        | Rateio Qoro já existe; API aceita mudança futura, sem readback documentado da pendência                                           | Mais vagas após confirmação das duas obrigações; nenhum direito antecipado                  | Proporcional pago sem confirmação da recorrência exige revisão; não repetir POST nem reembolsar automaticamente                                      | Pagamento do proporcional, lookup autoritativo, falhas parciais e concorrência; BLOCKED até suporte/readback equivalente                                                    |
| B: imediato com complementar separado e recorrência agendada | Dois comandos e duas evidências; requer aprovar que aceite remoto `PENDING` é suficiente para liberar a cota atual após pagamento | Vaga imediata depois de pagar diferença; recorrência passa ao valor maior no ciclo seguinte | Outro change-plan pode substituir a pendência; divergência na renovação; reservar operação única, impedir mudanças simultâneas e alertar/reconciliar | Saga com fixture, pagamento recusado/duplicado, cancelamento concorrente, renovação com preço errado e revisão; aprovação comercial expressa e âncora de ciclo obrigatórias |
| C: agendado para próximo ciclo                               | Usa change-plan nativo sem cobrança complementar; maior cota só após renovação paga do novo valor/produto                         | Menor complexidade; médico adicional não fica disponível imediatamente                      | Mudança pendente sem consulta continua exigindo monitoramento; se renovar errado, manter cota anterior e revisão, sem inventar pagamento             | Próxima cobrança paga com item/valor/tenant corretos, retries, ocupação/downgrade, cancelamento e mudança substituída; aprovação comercial expressa                         |

Alternativa escolhida pelo founder para o piloto: **C**, por reduzir a saga financeira e não depender de um proporcional separado. É diferente do upgrade imediato Asaas. A decisão comercial está aprovada; sua ativação continua dependendo de implementação e homologação. A e B ficam como registro da comparação, não como caminhos ativos.

## Infraestrutura comum e limites

Binding persistido por conta/ambiente, preço em centavos resolvido no servidor, operação durável com chave de negócio, bloqueio de mudanças simultâneas, envelope de eventos minimizado, readback e transação de direitos são comuns às alternativas. Nenhum desses componentes autoriza liberar vaga por redirect, pedido PENDING ou callback isolado.

Na candidata Sandbox, a intenção e o comando de alteração de plano foram implementados; invoice, plano e cota só mudam atomicamente depois de comprovar a renovação integral correspondente. A migration 0141 reserva também o teto de um downgrade pendente no servidor. Esses recortes passaram em PostgreSQL real com HTTP sintético, não como renovação externa. A oferta pública continua indisponível até a homologação. Asaas legado preservado. Downgrade não apaga dados nem reduz cota antes do período pago terminar e da ocupação ser elegível. Anual novo continua fechado; troca de ciclo requer capacidade e política aprovadas. Evidências e limites no [relatório final](../decoupling/asaas-to-abacatepay/RELATORIO-HOMOLOGACAO-FINAL.md).

## Rollback

Parar novas originações, conservar binding, invoices, comandos e inbox. Reconsultar o provedor antes de reenviar ou tentar outro gateway. Reverter código não desfaz uma cobrança nem cancela a recorrência; não fazer DOWN destrutivo, reembolso ou migração de contratos por efeito colateral.

Decisão do founder em 08/11/2026: **C — agendar a nova cota para a próxima renovação paga, sem cobrança proporcional separada**. Homologação real: **NOT RUN**. A decisão define a regra, não prova que a renovação já pode ser conciliada pela API. Este documento não reduz critérios de aceite nem autoriza publicação.

## Consequência da decisão aprovada

O comando `change-plan` aceito não libera médicos, permissões ou cota. O contrato atual permanece até comprovar uma nova renovação paga, no novo produto e valor, vinculada à mesma conta/assinatura/cliente. Falha, timeout, substituição de pedido, pagamento antigo ou divergência permanecem em revisão. Não emitir cobrança proporcional. Downgrade também exige ocupação compatível e não apaga dados. A oferta mensal e os contratos Asaas continuam com suas regras atuais.

## Contratação inicial — decisão complementar de 10/11/2026

O founder aprovou **escolher de 2 a 5 médicos já no primeiro pagamento AbacatePay**, com a mensalidade integral correspondente: R$ 397/544/691/838. Consultório permanece R$ 197 para 1 médico. Todos conservam até 3 acessos administrativos incluídos. Essa é a seleção inicial de um contrato ainda não pago; não é um `change-plan` nem uma cobrança proporcional.

O cadastro da candidata deve listar essas variantes e conservar o ID escolhido; o servidor resolve preço, produto e quantidade antes de criar o checkout após o trial de 14 dias desde Auth. Um SKU de plano representa o total contratado e vai como um item de quantidade 1. O primeiro pagamento integral libera a cota desse plano. Após um contrato já pago, a alternativa C acima continua valendo: aumento ou redução somente na próxima renovação paga correspondente.

A aquisição Asaas publicada e os contratos antigos permanecem com os filtros e regras anteriores. A UI do outro agente consome o mesmo protocolo de plano; não houve reimplementação visual nem merge amplo. [Provas locais, catálogo Sandbox e limites](../decoupling/asaas-to-abacatepay/evidencias/contratacao-inicial-catalogo-20261110.json). Não há autorização de go-live nem outra cobrança nesta decisão.
