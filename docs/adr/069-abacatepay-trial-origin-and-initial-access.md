# ADR-069 — origem financeira, trial e primeiro período de acesso

Status: candidata Sandbox, decisão inicial de 08/11/2026, atualizada pela decisão expressa do founder em 12/11: permitir contratação durante o trial. Sem autorização de ativação em produção. A [ADR-068](068-abacatepay-upgrade-policy.md) registra o upgrade no próximo ciclo pago.

## Jornada e período

O cadastro confirmado cria o tenant e um trial Qoro de 14 dias exatos desde `Auth.created_at`. Não cria cliente, checkout ou assinatura externa. Um claim pseudônimo e transacional impede reiniciar a avaliação com outro Auth para o mesmo beneficiário; ele não concede acesso entre contas. Convites, legados e drafts que já iniciaram cobrança Asaas mantêm sua jornada original.

Durante ou após o trial, o titular pode abrir um checkout mensal com o preço resolvido no servidor e produto correspondente. Contratar antes do prazo é opcional; não há cobrança por iniciar a avaliação. A primeira ativação exige consulta autenticada à loja, assinatura, checkout e lista de assinaturas daquele checkout: conta, ambiente, cliente, produto único, quantidade, moeda, valor integral, estado pago e ausência de trial nativo precisam corresponder ao snapshot persistido. Outra assinatura/cliente no mesmo checkout impede a concessão automática. Redirecionamento e `ACTIVE` isolado não provam pagamento.

O primeiro mês de **acesso do Qoro** começa em `subscription.createdAt` retornado pelo provedor, somente depois da confirmação financeira acima. O mês é de calendário, com ajuste do último dia. Para a primeira conversão, a data mínima passa a ser a criação original no Auth, comprovada pelo claim privado da mesma clínica/titular/trial. Timestamp ausente, futuro, anterior a essa origem ou cujo primeiro mês já terminou vai para revisão. Não usar `updatedAt`, data de recebimento do webhook ou data atual para renovar um pagamento antigo. A recontratação mantém a restrição da ADR-070: somente após o fim do período pago anterior. O calendário interno não deve ser apresentado como vencimento confirmado pelo provedor. A documentação atual do GET já informa campos de período/próxima cobrança; eles são tratados pelos leitores de renovação, sem substituir a prova financeira.

Exemplo: trial termina em 20/11; titular contrata e paga em 15/11; a assinatura externa é criada em 15/11. O Qoro reconhece o primeiro mês desde 15/11, após verificar o pagamento, sem esperar 20/11. Contratar em 22/11 continua permitido, sem abrir outro trial. Nenhuma data interna é apresentada como vencimento externo sem readback correspondente.

## Persistência e privilégio

A migration aditiva 0138 registra `subscriptions.billing_provider`, com default Asaas para preservar contratos existentes. A origem não pode mudar; IDs Asaas são recusados em contratos AbacatePay. O schema privado `billing_gateway` conserva conta/ambiente, binding, snapshot de checkout, operação durável, inbox minimizado, claim de trial e pagamento inicial aplicado. Chaves compostas impedem misturar tenant/conta; privilégios são explícitos, FORCE RLS e nenhuma policy para anon/authenticated. Não há DELETE/TRUNCATE para service_role.

As quatro exceções administrativas são exatas e espelhadas em ESLint e `arch:db-check`, sem desativar os guards: `signup-free-trial.ts` resolve uma identidade Auth confirmada pré-tenant; `deferred-checkout.ts` opera no tenant autorizado pelo servidor e binding; `abacatepay-processing.ts` é worker com lease e readback, não aceita evidência financeira de browser; a rota webhook exige secret e HMAC antes da aceitação durável. Nenhuma conexão ou pool novo é criado.

## Concorrência e recuperação

Claim, provisionamento, binding e consumo do draft são atômicos. O journal reserva o comando por contrato/tipo/chave de negócio antes de POST. Resultado desconhecido não é autorização para tentar novamente nem para trocar de gateway. Snapshot de produto/preço não muda em retries. Inbox deduplica por conta/evento e hash; processamento usa lease, transação de aplicação e unicidade do checkout pago. Uma falha faz rollback de invoice, período, vínculo e liberação das cotas.

O período pago não é infinito: o gate de escrita observa o fim e a tolerância de inadimplência já existente (15 dias). Login e leitura continuam sob a política atual. Isso é proteção de contingência, não substitui renovação/dunning completos; atores de sistema mantêm as exceções existentes. O lançamento financeiro continua bloqueado até fechar a gestão do ciclo de vida.

## Limites e validação

**Atualização de 09/11 — renovação candidata.** O founder aprovou manter o aniversário mensal original e revisar ciclos ambíguos. O [plano de renovação](../decoupling/asaas-to-abacatepay/PLANO-CONTINUIDADE-RENOVACAO-E-HOMOLOGACAO.md) registra o leitor específico, histórico privado 0140 e aplicação transacional do período. Há prova local com PostgreSQL/HTTP sintético; não há comprovação de renovação temporal externa. O pagamento inicial continua sem provar mensalidades posteriores. As pendências históricas descritas abaixo devem ser lidas com esse recorte, sem receber PASS externo.

Um checkout pago inicial nunca prova a segunda mensalidade. `subscription.renewed`, falha, cancelamento, reembolso e disputa ainda exigem readback específico antes de efeitos. Eventos não implementados ficam em revisão, sem renovar nem conceder nova cota. O extrato V2 contém movimentos e referências de checkout/charge, mas sua equivalência com cada renovação, valor bruto e ambiente ainda precisa de prova; não preencher lacunas com campos inventados.

Somente Sandbox é aceito nesta composição. Presença de chave ou alteração de flag não habilita produção. Migrations remotas, configuração do Preview e um pagamento Sandbox integral ainda são gates separados. Anual novo permanece fechado; Asaas legado e cobranças de pacientes não mudam.

Fontes oficiais consultadas em 08/11/2026: [assinaturas](https://docs.abacatepay.com/pages/subscriptions/reference), [GET da assinatura](https://docs.abacatepay.com/pages/subscriptions/get), [webhooks](https://docs.abacatepay.com/pages/webhooks/security), [extrato](https://docs.abacatepay.com/pages/bank-statement/list). Evidências executadas no [diário de continuidade](../decoupling/asaas-to-abacatepay/PLANO-EXECUCAO-CONTINUIDADE.md).

## Extensão técnica — recuperação incremental, 12/11/2026

Estado: implementada e testada localmente; schema candidato fora do journal, sem aplicação remota. Não altera trial, preço, calendário, direitos de contratos ou a política de eventos negativos da [ADR-071](071-abacatepay-refunds-and-review.md).

O leitor limitado a cinco páginas fica como compatibilidade N-1. Com o schema aprovado, `billing_gateway.statement_scans` e `statement_scan_items` formam um cache durável por conta, mês brasileiro e finalidade. `card_approved` conserva comprovantes imutáveis de valor bruto; `adjustments` conserva observações atuais de refund/reversal. Movimentos de ajuste podem mudar sob identidade estável; o histórico processado permanece no inbox e em `billing_events`. Mudança de loja, identidade, checkout, pagamento, data ou cliente gera conflito e revisão. Um fluxo nunca serve como prova do outro.

Essas tabelas são **globais protegidas**, privadas do worker financeiro, não tabelas consultáveis pelo tenant. Não possuem policy/grant para `anon`, `authenticated` ou `qoro_runtime`; exigem ENABLE/FORCE RLS e concedem apenas SELECT/INSERT/UPDATE ao serviço, sem DELETE. Chaves compostas vinculam conta e finalidade ao scan. O leitor só retorna a evidência do checkout e cliente já vinculados no servidor; o browser não fornece provas financeiras.

Uma página e seu checkpoint são a unidade atômica. HTTP acontece fora do lock. Lease com fencing, geração, cursor opaco, backoff e rotação entre partições permitem retomada sem teto acumulado de 500. Cache parcial nunca comprova pagamento ou estorno. Atualização de topo evita varrer toda a loja por clínica; revisão integral periódica alcança backfills e mudanças profundas. Nenhum desses mecanismos cria cobrança ou estende acesso por presunção.

O worker usa o tick existente de outbox para inbox, primeira contratação e recuperação de renovação, sem novo scheduler/configuração externa. Os trabalhos independentes terminam antes da resposta de falha. Reads compartilham deadline, e o acesso privilegiado permanece no seam de billing autorizado, sem novo pool ou ampliação da allowlist de banco. A consulta de renovação resolve o contrato pelos índices de origem antes de ler snapshots e obter seu lock, evitando uma junção por todas as clínicas da conta.

Antes de uma varredura global Sandbox, a composição exige o produto de prova configurado, identidade correta e `devMode=true`; o id da loja isolado não atesta ambiente. Production continua recusada. Crons Vercel não executam automaticamente em Preview: a prova futura de runtime exige operação autenticada e restrita, sem disparar o outbox global de outras clínicas. Não exportar segredos sensíveis para contornar essa restrição.

Validação: PostgreSQL isolado com mais de 10 mil registros por finalidade, interrupção/retomada, cursor inválido, lease antiga, 429, dois workers, reversão e isolamento; provas de contratos/trial, ordem composta com TISS e migrator Drizzle real. Métricas locais não são capacidade do provedor ou SLA Production. Renovação temporal, readbacks após fechar checkout, composição live e autorizações de aplicação permanecem gates separados. Fontes e resultados no [relatório §48](../decoupling/asaas-to-abacatepay/RELATORIO-HOMOLOGACAO-FINAL.md#48-inbox-de-minuto-estornos-e-tiss-até-0158--12112026) e no [runbook](../runbooks/abacatepay-operacao.md).
