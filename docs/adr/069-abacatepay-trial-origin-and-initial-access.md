# ADR-069 — origem financeira, trial e primeiro período de acesso

Status: decisão técnica para a candidata Sandbox, 08/11/2026. O founder delegou a escolha da âncora mais segura; não autorizou ativação em produção. A [ADR-068](068-abacatepay-upgrade-policy.md) registra o upgrade no próximo ciclo pago.

## Jornada e período

O cadastro confirmado cria o tenant e um trial Qoro de 14 dias exatos desde `Auth.created_at`. Não cria cliente, checkout ou assinatura externa. Um claim pseudônimo e transacional impede reiniciar a avaliação com outro Auth para o mesmo beneficiário; ele não concede acesso entre contas. Convites, legados e drafts que já iniciaram cobrança Asaas mantêm sua jornada original.

Após o trial, o titular abre um checkout mensal com o preço resolvido no servidor e produto correspondente. A primeira ativação exige consulta autenticada à loja, assinatura, checkout e lista de assinaturas daquele checkout: conta, ambiente, cliente, produto único, quantidade, moeda, valor integral, estado pago e ausência de trial nativo precisam corresponder ao snapshot persistido. Outra assinatura/cliente no mesmo checkout impede a concessão automática. Redirecionamento e `ACTIVE` isolado não provam pagamento.

O primeiro mês de **acesso do Qoro** começa em `subscription.createdAt` retornado pelo provedor, somente depois da confirmação financeira acima. O mês é de calendário, com ajuste do último dia. Timestamp ausente, futuro, anterior ao fim do trial ou cujo primeiro mês já terminou vai para revisão. Não usar `updatedAt`, data de recebimento do webhook ou data atual para renovar um pagamento antigo. Esse período **não afirma qual será o próximo vencimento na AbacatePay**: o GET documentado não garante essa data.

Exemplo: trial termina em 20/11; titular contrata e paga em 22/11; a assinatura externa é criada em 22/11. O Qoro reconhece o primeiro mês desde 22/11, após verificar o pagamento. Não abre outro trial nem apresenta 22/12 como vencimento confirmado pelo provedor.

## Persistência e privilégio

A migration aditiva 0138 registra `subscriptions.billing_provider`, com default Asaas para preservar contratos existentes. A origem não pode mudar; IDs Asaas são recusados em contratos AbacatePay. O schema privado `billing_gateway` conserva conta/ambiente, binding, snapshot de checkout, operação durável, inbox minimizado, claim de trial e pagamento inicial aplicado. Chaves compostas impedem misturar tenant/conta; privilégios são explícitos, FORCE RLS e nenhuma policy para anon/authenticated. Não há DELETE/TRUNCATE para service_role.

As quatro exceções administrativas são exatas e espelhadas em ESLint e `arch:db-check`, sem desativar os guards: `signup-free-trial.ts` resolve uma identidade Auth confirmada pré-tenant; `deferred-checkout.ts` opera no tenant autorizado pelo servidor e binding; `abacatepay-processing.ts` é worker com lease e readback, não aceita evidência financeira de browser; a rota webhook exige secret e HMAC antes da aceitação durável. Nenhuma conexão ou pool novo é criado.

## Concorrência e recuperação

Claim, provisionamento, binding e consumo do draft são atômicos. O journal reserva o comando por contrato/tipo/chave de negócio antes de POST. Resultado desconhecido não é autorização para tentar novamente nem para trocar de gateway. Snapshot de produto/preço não muda em retries. Inbox deduplica por conta/evento e hash; processamento usa lease, transação de aplicação e unicidade do checkout pago. Uma falha faz rollback de invoice, período, vínculo e liberação das cotas.

O período pago não é infinito: o gate de escrita observa o fim e a tolerância de inadimplência já existente (15 dias). Login e leitura continuam sob a política atual. Isso é proteção de contingência, não substitui renovação/dunning completos; atores de sistema mantêm as exceções existentes. O lançamento financeiro continua bloqueado até fechar a gestão do ciclo de vida.

## Limites e validação

Um checkout pago inicial nunca prova a segunda mensalidade. `subscription.renewed`, falha, cancelamento, reembolso e disputa ainda exigem readback específico antes de efeitos. Eventos não implementados ficam em revisão, sem renovar nem conceder nova cota. O extrato V2 contém movimentos e referências de checkout/charge, mas sua equivalência com cada renovação, valor bruto e ambiente ainda precisa de prova; não preencher lacunas com campos inventados.

Somente Sandbox é aceito nesta composição. Presença de chave ou alteração de flag não habilita produção. Migrations remotas, configuração do Preview e um pagamento Sandbox integral ainda são gates separados. Anual novo permanece fechado; Asaas legado e cobranças de pacientes não mudam.

Fontes oficiais consultadas em 08/11/2026: [assinaturas](https://docs.abacatepay.com/pages/subscriptions/reference), [GET da assinatura](https://docs.abacatepay.com/pages/subscriptions/get), [webhooks](https://docs.abacatepay.com/pages/webhooks/security), [extrato](https://docs.abacatepay.com/pages/bank-statement/list). Evidências executadas no [diário de continuidade](../decoupling/asaas-to-abacatepay/PLANO-EXECUCAO-CONTINUIDADE.md).
