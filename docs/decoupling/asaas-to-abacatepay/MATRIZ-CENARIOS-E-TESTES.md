> **Estado corrente — janela técnica13/11 concluída:** catálogo live5/5, cinco configurações novas com checkoutsfalse e alerta Production ed622a74 entregue. Release/migrations/checkout live não executados; endpoint financeiro atual404. Fixture de conversão antecipada preparada sem checkout. Ver relatório§54 e authorizedWindowHomologation no JSON canônico. Os checkpoints anteriores são históricos.

# Cenários financeiros e nível real de validação

**Matriz vigente: fechamento live e piloto, 13/11, relatório§53.** Tabelas anteriores são histórico; usar a última seção para a decisão atual.

**Decisão corrente: [matriz G01–G28](#matriz-corrente-g01g28--scanner-incremental-12112026).** As cinco compras iniciais abaixo continuam homologadas; não equivalem à aprovação de produção.

## Recorte atual — cinco primeiras contratações (11/11/2026)

[relatório §38](RELATORIO-HOMOLOGACAO-FINAL.md#38-cinco-contratações-iniciais-homologadas--11112026). Quatro compras pendentes efetivamente pagas e verificadas em DEV/Preview/Sandbox. Clínica2 preservada, sem repetir pagamento. [Evidência consolidada](evidencias/checkouts-lote-20261111.json).

| Jornada mensal | Valor | Checkout / pagamento | Webhook / assinatura / invoice | Médicos + administrativos | UI / segurança | Evidência |
|---|---:|---|---|---|---|---|
| Consultório | R$ 197 | PASS / PAID | PASS / ativa / 1 paga | 1 + até 3 | PASS 1440/390, nova compra 409 | Lote 11/11 |
| Clínica 2 médicos | R$ 397 | PASS histórico; não repetido | PASS histórico / ativa / 1 paga | 2 + até 3 | PASS histórico 1440/390 e 409 | 10/11, seção 33 |
| Clínica 3 médicos | R$ 544 | PASS / PAID | PASS / ativa / 1 paga | 3 + até 3 | PASS 1440/390, nova compra 409 | Lote 11/11 |
| Clínica 4 médicos | R$ 691 | PASS / PAID | PASS / ativa / 1 paga | 4 + até 3 | PASS 1440/390, nova compra 409 | Lote 11/11 |
| Clínica 5 médicos | R$ 838 | PASS / PAID | PASS / ativa / 1 paga | 5 + até 3 | PASS 1440/390, nova compra 409 | Lote 11/11 |

Cada PASS novo inclui correlação remota, um webhook aplicado, invoice/receipt/tentativa/operação únicos, período correto, cotas persistidas e UI paga em nova sessão. Isolamento READ ONLY: 4 leituras próprias e 12 cruzadas negadas. Teto/concorrência de médicos: prova local anterior de 85 checks, não convite externo. Falhas de invoice/quota: 20/20 checks PostgreSQL atuais, zero rede externa. Primeira contratação não comprova renovação temporal. B1–B4/live/cohort seguem no [plano final](PLANO-FINAL-GO-LIVE-ABACATEPAY.md).

**Histórico abaixo:** preservado com suas datas; o checkpoint acima substitui NOT RUN de primeira compra, sem promover casos de renovação, falha, refund ou disputa sem prova.

## Recorte atual — primeira contratação 2–5 médicos (10/11/2026)

**Checkpoint posterior:** [seção37 do relatório](RELATORIO-HOMOLOGACAO-FINAL.md#37-dev-recuperado-inventário-financeiro-e-lote-sob-pedido--10112026). DEV recuperado após o founder habilitar Data API; preflight 144 passou com apêndice TISS exato revisado. CI `fd90ded7` **6.897 testes e 18 E2E PASS, zero SKIP**. A nova regressão dirigida passou 2.247/2.247; CI própria do incremento fica no PR. UI e Turnstile isolados passaram nessa CI; isso não é pagamento externo nem widget real de Production. A primeira compra de 5 médicos ainda **NOT RUN externamente**: última orientação é aguardar **“crie os checkouts”**. O lote contém Consultório 1 e Clínica 3/4/5, sem repetir2 pago. [Inventário completo](INVENTARIO-FLUXOS-FINANCEIROS.md), [variáveis](AUDITORIA-VARIAVEIS-VERCEL.md) e [operação](PROXIMO-CHECKOUT-SANDBOX.md).

Quadro da seção 36, atualizado pelo checkpoint acima: [relatório final, seção 36](RELATORIO-HOMOLOGACAO-FINAL.md#36-fechamento-da-primeira-contratação-e-integração-visual--10112026). Os estados históricos abaixo continuam com suas próprias datas/limites. CI nova e preparo do lote ficam no PR #53; pagamento externo continua pendente da frase combinada.

| Cenário | Esperado | Prova existente / ambiente | Estado e limite |
|---|---|---|---|
| Clínica com 2 médicos | R$ 397, 2 médicos + 3 administrativos após pagamento | Primeiro pagamento real, webhook, invoice e UI: seção 33; casos PostgreSQL inicial/recorrente | PASS Sandbox histórico e local; não repetir cobrança |
| Clínica com 3 médicos | R$ 544 e cota 3+3 | 18 checks de primeiro pagamento e 85 de renovação/cotas; PostgreSQL real/HTTP sintético | PASS local; pagamento externo NOT RUN |
| Clínica com 4 médicos | R$ 691 e cota 4+3 | Mesma matriz, preço/produto exatos e ausência de vagas antecipadas | PASS local; pagamento externo NOT RUN |
| Clínica com 5 médicos | R$ 838 e cota 5+3 | Matriz local aprovada; criação do lote adiada a pedido do founder | PASS local; pagamento externo NOT RUN |
| Clínica com 0/1/fracionário/6 médicos | Código inexistente recusado | Validação do catálogo e contrato de gravação; não há parâmetro de quantidade arbitrário | PASS unitário de rejeição; Consultório com 1 médico/R$ 197 continua válido |
| Preço/quantidade adulterados | Backend recusa sem criar intenção | Corpo estrito das rotas; E2E externo ampliado para HTTP400 antes da primeira compra | PASS unitário; novo externo só após execução |
| Pendente/abandono/refresh | Sem liberação; reutilizar intenção e checkout | Casos de recuperação PostgreSQL; E2E Preview ampliado | PASS local; novo Preview a executar |
| Pago | Uma invoice, uma liberação e cota exata | Primeiro pagamento integral, 6 cliques/uma criação e reaplicação local; real de 2 médicos | PASS nos níveis indicados; 5 médicos depende da nova prova |
| Recusado/incompleto/valor divergente | Não ativar | Leitores, processamento e casos locais de valor insuficiente/divergente | PASS local; recusa real de cartão recorrente NOT RUN |
| Webhook duplicado/fora de ordem | Um efeito, sem reduzir período atual | Inbox/observações e matriz PostgreSQL de renovação | PASS local; não provocar cobrança externa só para forçar evento |
| Rede/API indisponível | Conservar obrigação incerta, sem segundo POST cego | Oito cenários anteriores de recuperação e releitura real após falha temporária | PASS local e recuperação de leitura observada; timeout remoto induzido NOT RUN |
| UI redesenhada | Mesmo plano/preço/CAS; acessível e sem overflow | 39 testes de componente antes dos casos adicionais de catálogo; oito E2E novos no harness isolado | Componente e oito E2E PASS na CI fd90ded7; HTTP controlado |
| Turnstile no build isolado | Dois casos condicionais executados sem chaves reais | Par público oficial no `security:build`; estado resolvido/token e sigilo na página | Dois casos PASS na CI fd90ded7, zero SKIP; não prova chaves Production |


Atualizado em 09/11/2026 UTC e Brasília. Esta tabela complementa a [matriz M01–M18 do plano mestre](PLANO-MESTRE-MIGRACAO-ASAAS-ABACATEPAY.md). A matriz geral de 79 casos continua preservada. A candidata agora tem **um primeiro pagamento integral real no modo de simulação Sandbox**, webhook autenticado aplicado, invoice e UI paga; o cancelamento posterior está discriminado abaixo. Somente os casos identificados recebem esse nível de evidência. A [continuação anterior](CONTINUACAO-2026-11-07.md) é histórica. O [diário atual](PLANO-EXECUCAO-CONTINUIDADE.md) contém SHAs, Preview, fixture, testes e limites. Nenhuma mudança de Produção ou migração de contratos reais foi realizada.

O Qoro provisiona o trial absoluto e só solicita checkout após o prazo. Dois E2E reais partiram de identidades sintéticas confirmadas administrativamente: trial ativo sem checkout e trial vencido com checkout, sem prova de entrega do e-mail ou decurso real de 14 dias. O terceiro conferiu o estado pago após webhook real. As [cotas aprovadas](../../specs/trial-interface-e-cotas-2026-11.md) e os limites permanentes foram preservados.

## Invariantes e convenções

Estado inicial e estímulo estão na segunda coluna. Estado final esperado está na terceira. Efeitos permitidos: somente o resultado indicado, histórico/auditoria e uma notificação se autorizada no futuro. Efeitos proibidos em todas as linhas: segunda cobrança/recorrência da mesma operação, segundo benefício, tenant/conta/ambiente incorretos, repricing legado, segredo/PII em log, sucesso sem efeito durável. Qualquer efeito financeiro fora do Sandbox é proibido nesta rodada.

`billing/` abaixo significa `src/contexts/billing/internal/`; `onboarding/` significa `src/contexts/onboarding/internal/`. Arquivos apontados são pontos de partida existentes, executados quando fazem parte da baseline de 25 arquivos. A existência da suíte não prova a combinação futura no novo adapter. Em cada futuro ensaio registrar: runID, SHA, fixture/limpeza preparados, estado inicial DB/provider, estímulo, HTTP/evento, estado final, efeitos proibidos e resultado observado.

## Casos F01–F24 reaproveitados

| ID  | Pré-condição / ação                                   | Estado final esperado                                    | Ponto de partida / prova atual                                                                                | AbacatePay integrada                                                               |
| --- | ----------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| F01 | Invoice aberta; confirmação legítima                  | Uma invoice quitada e direitos no período correto        | Primeiro pagamento mensal Clínica R$ 397, webhook real, uma invoice e UI paga; diário e fixture identificados | PASS primeiro pagamento Sandbox; não renovação                                     |
| F02 | Evento já aplicado; repetir                           | Dedup durável, sem segundo benefício                     | Webhook Asaas, replay em `subscriptions.test.ts`; baseline local PASS                                         | NOT RUN                                                                            |
| F03 | Invoice paga ou assinatura cancelada; evento atrasado | Sem regressão de paid nem reativação genérica            | `billing/billing-logic.test.ts`, `mark-invoice-paid-cancelled.test.ts`                                        | NOT RUN                                                                            |
| F04 | Webhook chega antes do retorno de criação             | Recuperar a mesma operação/vínculo                       | `onboarding/signup-hosted-checkout.test.ts`; race multigateway ainda sem prova DB                             | NOT RUN                                                                            |
| F05 | Evento perdido; executar reconcile                    | Materializar uma vez o estado autoritativo               | `signup-free-trial-db.ts`: fixture separada sem inbox, GET financeiro, 12 chamadas e uma invoice; 34/34 PG    | PASS local com HTTP sintético; perda externa NOT RUN                               |
| F06 | POST remoto criou recurso; timeout                    | Resultado desconhecido até consulta, sem retry cego      | Comando candidato + journal durável: timeout sintético não repete execução; ensaio DB PASS                    | PARTIAL local; NOT RUN timeout externo                                             |
| F07 | Dois cliques de checkout simultâneos                  | Um efeito cobrante ou pendência explícita                | Journal/PG concorrente e UI bloqueando duplo clique; E2E externo emitiu um checkout e recusou novo após pagar | PARTIAL: corrida externa entre contextos NOT RUN                                   |
| F08 | Duas mudanças de plano                                | Uma mudança elegível/pendente, sem cota dupla            | Journal candidato impede segunda execução da mesma obrigação; mudança retorna pending/next_cycle              | PARTIAL local; NOT RUN mudança externa                                             |
| F09 | Cancelamento durante upgrade                          | Cancelamento auditado, cobranças vivas contabilizadas    | `billing/plan-changes-cancellation.test.ts`, `cancellation-charges.test.ts`                                   | NOT RUN                                                                            |
| F10 | Pagamento após expiração do checkout/trial            | Reconhecer pagamento na origem e aplicar regra de atraso | Trial expirado da fixture, mensalidade integral, período e desbloqueio conferidos no DEV                      | PASS pós-trial Sandbox; checkout expirado NOT RUN                                  |
| F11 | Estorno total/parcial depois de uso                   | Estado de estorno separado, sem fingir liquidação/DONE   | `billing/subscriptions.test.ts`; estorno de paciente não será migrado                                         | NOT RUN no SaaS; paciente fora do escopo                                           |
| F12 | Chargeback após acesso                                | Registrar risco e histórico, sem apagar pagamento        | Casos SaaS do novo provedor precisam especificação de recurso/evento                                          | NOT RUN                                                                            |
| F13 | Trial com deadline antigo; upgrade/adesão             | Não reiniciar 14 dias, sem cobrança antecipada           | Provisionamento real em Preview/DEV, data Auth controlada antes da criação, comparação exata e bloqueio ativo | PASS no prazo simulado; 14 dias reais não observados                               |
| F14 | Downgrade perto do vencimento                         | Elegibilidade e valor/cota remotos convergentes          | `billing/plan-changes.test.ts`, `plan-change-provider-sync.test.ts`                                           | NOT RUN                                                                            |
| F15 | Cartão recusado                                       | Sem acesso pago indevido; erro seguro e retomada         | `onboarding/saga.test.ts`; recusa de cartão V2 não foi induzida                                               | NOT RUN                                                                            |
| F16 | Pix/boleto quitado em atraso                          | Vínculo e período corretos, dívida única                 | Não presumir equivalência Pix Asaas/Pix Automático; boleto sem equivalente documentado                        | BLOCKED para boleto; Pix NOT RUN                                                   |
| F17 | Contrato antigo Asaas; default novo                   | Continua vinculado ao Asaas                              | Namespace unitário e snapshot de contratos sintéticos preservado no PostgreSQL, sem binding automático        | PARTIAL local; NOT RUN coexistência ativa                                          |
| F18 | Recorrência ativa; cobrança futura pendente           | Acesso derivado do contrato/período, não de ACTIVE       | Readers novos não concedem acesso e não inventam próximo vencimento                                           | PARTIAL unitário; NOT RUN integrado                                                |
| F19 | Repasse suspenso após estorno parcial                 | Preservar revisão, motivo, teto e histórico              | `financial` e pagamentos de pacientes permanecem intocados; sem payout no novo adapter                        | Fora do escopo desta migração, sem novo PASS                                       |
| F20 | External ID igual em providers/contas                 | Nenhum vínculo/efeito cruzado                            | Namespace unitário + FKs, unicidade e origem imutável no DDL candidato: PASS PostgreSQL                       | PARTIAL local; NOT RUN produção                                                    |
| F21 | Scheduler antigo emite durante troca                  | Detectar duplicidade antes de outra recorrência          | Nenhuma troca de scheduler ou contrato nesta rodada; ensaio depende de coexistência                           | NOT RUN                                                                            |
| F22 | Refund da origem após novo gateway                    | Continua operável no provider original                   | Política registrada, nenhum contrato movido                                                                   | NOT RUN                                                                            |
| F23 | Evento desconhecido/forjado/grande                    | Recusa ou classificação observável, zero efeito          | HMAC/cap e PG; endpoint Preview recusou secret inválido (401); evento financeiro legítimo aplicado            | PARTIAL externo: secret negativo e primeiro evento PASS; demais ataques sintéticos |
| F24 | Anual existente e vendas novas fechadas               | Preservar contrato e flag, sem abrir venda anual         | `billing/billing-cycle-provider-sync.test.ts`, `plan-changes-cancellation.test.ts`, `proposed-offer.test.ts`  | NOT RUN no novo gateway                                                            |

## Cancelamento e recontratação — ADR-070

A [0139 foi aplicada somente no DEV e o cancelamento autorizado passou no Sandbox](evidencias/cancellation-0139-20261109.json). São provas distintas das mudanças de plano/assentos, de falhas de cartão e de renovação. O ensaio não gerou nova cobrança nem deslocou datas da fixture.

| Caso                                                                | Evidência                                                                                                                                                             | Estado                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Cancelar a renovação paga, repetir e recusar contratação antecipada | Provedor CANCELLED, Qoro ativo até o fim pago, uma operação, invoice/trial intactos; repetição HTTP 200 e novo checkout HTTP 409; UI 1440/390 px                      | PASS DEV/Preview/Sandbox                                        |
| Resultado intermediário e reconciliação por leitura                 | Resposta inicial 409, estado remoto CANCELLED e verificação posterior confirmada sem segunda operação; timeout/resposta perdida induzidos somente no PostgreSQL local | PASS na recuperação observada; timeout externo induzido NOT RUN |
| Terminar o acesso no prazo, sem tolerância adicional                | Relógio/dados sintéticos no PostgreSQL; período real da fixture permanece até 09/12/2026 00:31:10.888 UTC                                                             | PASS local; passagem temporal externa NOT RUN                   |
| Recontratar sem reiniciar trial nem sobrescrever histórico          | Duas gerações locais com webhook autenticado e HTTP sintético, preço/identidade/valor verificados, rollback e concorrência; parte das 47 verificações PostgreSQL      | PASS local; contratação paga externa após o período NOT RUN     |

Não foi comprovada entrega de webhook de cancelamento: a prova externa usa comando/readback autenticados. Os eventos de pagamento da primeira contratação têm evidência própria e não provam renovação futura.

## Renovação mensal — recorte 0140

O [plano de continuidade da renovação](PLANO-CONTINUIDADE-RENOVACAO-E-HOMOLOGACAO.md) registra a decisão aprovada: manter o aniversário mensal original e revisar ambiguidades. Os resultados abaixo usam banco PostgreSQL real isolado e HTTP sintético; **não comprovam uma segunda mensalidade externa nem o calendário efetivo da AbacatePay**. A aprovação de cartão é distinta de liquidação.

| Caso                                                                                        | Evidência                                                                                                                    | Estado                                                                                          |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Nova cobrança vinculada ao contrato, checkout de ciclo diferente da origem e valor integral | Leitor com 43 testes, mais 28 regressões do recibo; consulta de loja, produto, assinatura, checkout e extrato                | PASS unitário/HTTP sintético; externo NOT RUN                                                   |
| Renovação mantém o calendário original, inclusive atraso e fim de mês                       | 15 testes de calendário; constraints SQL em UTC verificadas também com sessão Pacific/Auckland                               | PASS local; correspondência com emissão temporal externa NOT RUN                                |
| Repetição e concorrência                                                                    | Um período e uma invoice; 12 aplicações concorrentes resultam em uma aplicação e 11 duplicatas                               | PASS PostgreSQL sintético                                                                       |
| Outro pagamento no mesmo ciclo e evento fora de ordem                                       | Preserva observação financeira; não duplica benefício nem reduz o período atual; ciclo anterior pode gerar invoice histórica | PASS PostgreSQL sintético                                                                       |
| Falha de API ou de transação após evento recebido                                           | Retry limitado, rollback atômico e aplicação posterior uma vez                                                               | PASS local; falha externa induzida NOT RUN                                                      |
| Cancelamento solicitado, geração antiga, anual ou mudança de plano pendente                 | Nenhuma reativação/cota antecipada por confirmação de pagamento                                                              | PASS local no recorte de renovação; gestão completa de planos/refund/disputa permanece pendente |
| Privilégios, isolamento e imutabilidade                                                     | FORCE RLS, sem anon/authenticated, service_role somente SELECT/INSERT, FKs compostas e snapshots imutáveis                   | PASS local e postflight DEV 0140; dados e privilégios anteriores preservados                    |
| Evento de renovação totalmente ausente                                                      | Não inventa renovação a partir do pagamento inicial ou de cliente/preço parecidos                                            | Sem concessão indevida PASS local; descoberta e recuperação do evento ausente NOT RUN           |

As provas de persistência e processamento acima fazem parte das **22 verificações PostgreSQL novas**. A regressão anterior de trial/cancelamento/recontratação também passou **47/47** com as 141 migrations. Nenhum desses ensaios criou cobrança remota ou alterou a fixture Sandbox retida.

## Casos compostos aplicáveis

| ID          | Preparação/ação                                                          | Esperado                                                                   | Estado                                                            |
| ----------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| C04         | Timeout depois de POST + retry + indisponibilidade                       | Conciliar resultado desconhecido, nenhuma criação cega no outro gateway    | PARTIAL: unknown durável sem retry; NOT RUN timeout remoto        |
| C07         | Novo gateway + refund antigo + conta de origem desativada                | Conservar acesso operacional mínimo/vínculo na origem até fechar obrigação | NOT RUN; contratos antigos não migrados                           |
| C01/C03/C05 | Pagamento durante snapshot, callback no host anterior ou aplicação N/N-1 | Sem perda/dedup quebrado; writer único                                     | NOT RUN; viram obrigatórios antes de migration/cutover aplicáveis |
| C02/C06     | Cutover de identidade ou Storage com operação concorrente                | Autorização/bytes/exclusões íntegros                                       | Adiados: Auth/Storage não estão sendo migrados                    |

## Demais cenários do plano geral

A01–A19 tratam substituição de identidade, sessão, MFA e retomada entre emissores. D01–D16 tratam migração/restore de banco e Storage, criptografia e cópia/delta. H01–H13 tratam outro host, scheduler, proxy/TLS, réplicas e capacidade. **Não se aplicam como ensaio de saída nesta rodada**, porque esses serviços não mudam. Nenhum recebe PASS. As proteções compartilhadas deverão entrar na regressão quando o financeiro passar a usar persistência/rota/jornada nova; não se elimina teste de tenant/autorização por adiar a troca do Supabase.

## Atualização diferencial — 09/11/2026, 0141

O [relatório final](RELATORIO-HOMOLOGACAO-FINAL.md) consolida o estado posterior aos checkpoints históricos acima: recuperação do POST desconhecido por GET único e fingerprint; gestão de plano/médico adicional no próximo ciclo integral; observações financeiras negativas; política de reembolso aprovada na [ADR-071](../../adr/071-abacatepay-refunds-and-review.md). Passaram 8 verificações H3, 47 trial/cancelamento/recontratação e 33 renovação/planos/negativos em PostgreSQL real com HTTP sintético e 142 migrations. A busca H3 também leu o checkout Sandbox já pago, com 4 GETs e zero mutações. Esses resultados não substituem a renovação financeira externa, os desfechos de disputa ou a prova de encerramento do checkout reutilizável.

## Continuidade aguardando suporte — gates S1, L1–L7 e E1–E4

Baseline desta rodada: `14d7f9d4`; os checkpoints anteriores não são sobrescritos. Resultados novos em [relatório, seção 26](RELATORIO-HOMOLOGACAO-FINAL.md#26-continuidade-enquanto-o-suporte-não-responde--09112026). PostgreSQL usa as migrations reais e HTTP sintético; unitários usam mocks quando indicado. Nenhuma nova prova financeira remota foi executada.

| Funcionalidade | Estado atual | Testes existentes | Lacuna | Ação local | Dependência do suporte | Status |
|---|---|---|---|---|---|---|
| Renovação | Calendário, cobrança e histórico atômicos | REN-001–020, leitor/PG | Ciclo externo e descoberta sem evento | Lease interrompido/final e fronteiras UTC | Acelerar ciclo e identificar cobrança | Local validável; externo BLOCKED |
| Upgrade/downgrade/adicionais | Intenção durável; cota só na renovação integral alvo | H4/PG, rota de plano | Renovação alvo externa | Cancelamento durante comando e replay sem cota | Renovação após alteração | Local validável; externo BLOCKED |
| Eventos negativos | Readback/revisão conforme ADR-071 | H2, negative-payment | Vínculo interno conflitante entrava em retry | Filtrar vínculo antes do GET; rollback/lease/provider | Procedimento de refund/disputa de assinatura | Correção local; externo BLOCKED |
| Checkout desconhecido/duplicado | Reserva, fingerprint, descoberta única, sem POST cego | 35 unitários e 8 PG H3 históricos | Provedor permite várias assinaturas pelo link | Preservar guards; não excluir fixture paga | Uso único e consultas após fechar link | Local PASS histórico; garantia externa BLOCKED |
| Recontratação | Geração nova, sem trial, após fim pago | 47 PG históricos e calendário | Instante exato/fuso; decurso real | Quatro casos de limite no calendário | Passagem temporal externa/procedimento oficial | Local ampliado; externo NOT RUN |
| Conciliação/segurança | Inbox durável, lease, limites, review | HMAC/rota/journal/PG | Processo interrompido e auditoria indisponível | Retomar mesma obrigação, sem novos comandos | Correlação sem webhook completamente ausente | Local validável; ausência total BLOCKED |
| Turnstile | Dois cenários ignorados na CI sem chaves | Provas isoladas históricas, seção 15 do relatório | Não comprova CI/Production real | Preservar status; nenhuma configuração alterada | Não depende de suporte AbacatePay | CI 8 PASS / 2 SKIP histórico |
| ID | Estado inicial | Ação | Resultado esperado | Teste | Evidência | Status | Dependência externa |
|---|---|---|---|---|---|---|---|
| S1 | Perguntas anteriores parcialmente respondidas | Conferir fontes e entregar texto único | Somente quatro lacunas, sem segredos | Revisão documental | SOLICITACAO-SUPORTE-HOMOLOGACAO.md | PASS preparação/entrega; não enviado | Founder envia e retorna resposta |
| L1-a | Cobrança de primeiro/segundo ciclo | Pagar/duplicar/atrasar evento sintético | Uma invoice por ciclo, calendário original | REN-001–004/012, H4 segundo ciclo | PG histórico + ensaio afetado | PASS histórico; regressão no fechamento | E1 |
| L1-b | Worker morto com lease vencido | Nova conciliação do mesmo evento | Retomar uma vez; não criar cobrança | Novo check L1 de lease | JSON de execução desta rodada | PASS local; resultado no encerramento | Nenhuma para prova local |
| L1-c | Cliente/tenant/gateway/valor divergentes | Readback/aplicação indevida | Revisão, sem concessão | REN-005–008/017 | Unitário/PG | PASS histórico | Nenhuma para prova local |
| L1-d | Sem webhook de renovação | Consultar contrato inicial pago | Não inventar vínculo ou período | REN-019 | PG histórico | PASS de recusa; recuperação BLOCKED | E2 |
| L1-e | Datas em mês/ano/fuso distintos | Projetar aniversário e tolerância | Mesmo instante, sem drift | renewal-period.test.ts, REN-013–015 | Testes locais | PASS local; resultado no encerramento | Calendário real em E1 |
| L2-a | Plano alvo pendente | Pagar valor antigo/parcial/antecipado | Sem nova cota | H4 de valores | PG histórico | PASS histórico | E1 |
| L2-b | Downgrade e ocupação | Reativar médico na última vaga | Reserva recusa excesso; não apaga usuário | H4 de downgrade | PG histórico | PASS histórico | E1 |
| L2-c | Comando de plano sem resposta | Repetir/solicitar outro alvo | Uma obrigação unknown, sem segundo POST | H4 de lost response | PG histórico | PASS histórico | Conciliação oficial do resultado |
| L2-d | Comando reservado antes do cancelamento | Cancelar antes do ACK; receber alvo pago | Preservar evidência sem mudar plano/cota | Novo check L2 | JSON de execução desta rodada | PASS local; resultado no encerramento | E1 para efeito remoto |
| L3-a | Evento vinculado a outro tenant | Readback negativo conflitante | Revisão sem GET/rebinding | Novo check L3 de vínculo | Falha reproduzida e reteste | PASS local; resultado no encerramento | Nenhuma |
| L3-b | Estorno parcial/integral sintético atual/antigo | Conciliar e repetir | ADR-071; ciclo novo não reduzido | H2 refund/reversal | PG + HTTP sintético | PASS histórico | E4; parcial não implica API suportada |
| L3-c | Auditoria indisponível após cálculo da política | Falhar INSERT; reprocessar | Rollback completo e uma auditoria | Novo check L3 de rollback | JSON de execução desta rodada | PASS local; resultado no encerramento | Nenhuma |
| L3-d | Lease perdido durante readback negativo | Tentar commit e retomar | Worker velho não altera estado | Novo check L3 de lease | JSON de execução desta rodada | PASS local; resultado no encerramento | Nenhuma |
| L3-e | Evento negativo no namespace Asaas | Conciliar por ID | Sem GET/efeito AbacatePay | Novo check L3 de namespace | JSON de execução desta rodada | PASS local; resultado no encerramento | Nenhuma |
| L3-f | Disputa aberta/encerrada sem prova suficiente | Receber notificação/status | Revisão; não inferir vitória/derrota | H2, tipo desconhecido, leitor negativo | PG/fixtures | PASS de segurança; desfecho BLOCKED | E4 |
| L4 | POST de checkout perdido/concorrente | Recuperar por identidade única | Mesma intenção/operação; sem cobrar de novo | H3, journal e initial-payment | 8 PG históricos e unitários | PASS local/readback histórico | Uso único E3 continua BLOCKED |
| L5 | Fim pago em UTC/Brasília | Criar período em -1ms/0/+1ms | Antes recusa; a partir do fim permite | abacatepay-period.test.ts | Testes locais | PASS local; resultado no encerramento | Recontratação temporal externa |
| L6 | Worker final expirou em tentativa 10 | Reconciliar | Revisão sem 11º GET | Novo check L6 | JSON de execução desta rodada | PASS local; resultado no encerramento | Nenhuma |
| L7 | Código/ensaios afetados | TypeScript/lint/testes/CI | Sem regressão, skips explícitos | Gates do projeto | Registro final do novo SHA | PASS local; resultado no encerramento | CI/Preview do SHA novo |
| E1 | Assinatura ativa no Sandbox | Renovar/alterar/retry oficialmente | Ciclo e pagamento reais correlacionados | Não executado nesta rodada | Solicitação A | BLOCKED | Procedimento oficial |
| E2 | Nenhum webhook de renovação entregue | Descobrir cobrança/ciclo | Correlação autoritativa, sem inferência | Não executado | Solicitação B | BLOCKED | API/procedimento oficial |
| E3 | Checkout pago preservado | Invalidar link sem perder histórico | Uso único/recorrência/consultas preservados | Apenas probe não pago histórico | Solicitação C | BLOCKED | Garantia + fixture nova autorizada |
| E4 | Cobrança de assinatura | Reembolsar/contestar oficialmente | Eventos/readback/revisão conhecidos | Fixtures somente | Solicitação D | BLOCKED | Recurso suportado fora do endpoint incompatível |



## Rodada sem espera do suporte — arquitetura e integridade de recorrências

O proprietário informou que já enviou a solicitação; **não reenviar**. A [seção 27 do relatório](RELATORIO-HOMOLOGACAO-FINAL.md#27-continuidade-sem-aguardar-suporte--09112026) contém a implementação e o fechamento. Os IDs L1–L9 abaixo são os desta rodada e não renomeiam o histórico S1/L1–L7 anterior.

| Área | Implementação | Teste local | Sandbox | Dependência suporte | Status |
|---|---|---|---|---|---|
| Renovação | Calendário original, observação/invoice/efeito atômicos | REN/H4 anteriores preservados; regressão PostgreSQL afetada | Contratação inicial anterior não é renovação | E1: ciclo externo; E2: vínculo sem evento | Local implementado; externo BLOCKED — AGUARDANDO SUPORTE |
| Conciliação sem webhook | Recuperação inicial e do checkout desconhecido; integridade periódica sem evento | Journal, inbox, lease, H3, novo monitor | Cinco GETs reais do leitor de integridade; sem mutações | E2 só para cobrança de renovação sem vínculo identificável | Parcial externa; não inventar correlação |
| Uso único do checkout | Intenções/journal e recusa de grants duplicados; novo monitor deduplica incidentes | Duas recorrências sintéticas e 16 monitores concorrentes | Leitura de uma recorrência existente; duplicação externa não criada | E3: garantia/invalidação paga e histórico | Proteção/detecção local; garantia externa BLOCKED |
| Reembolso recorrente | Observação e revisão ADR-071 preservadas; sem comando incompatível | H2/rollback/lease/ciclo antigo anteriores | Sem refund de assinatura executado | E4: procedimento/eventos suportados | BLOCKED — AGUARDANDO SUPORTE no recorte externo |
| Gate atual | Evidência aplicável | Limite |
|---|---|---|
| L1 Arquitetura | Contrato neutro; adapter valida DTO externo; seleção por binding/provider/account | Não migra Asaas nem promete independência completa de toda persistência |
| L2 Renovação | Ciclos, valores, calendário, invoice e idempotência no PG real | Evento/ciclo financeiro externo continua E1/E2 |
| L3 Checkout | Journal/recuperação existentes + monitor de referências/recorrências múltiplas | Não impede uso da URL externa, nem cancela assinatura desconhecida |
| L4 Conciliação | Reserva antes do I/O, backoff, dedup e retomada; lotes parciais visíveis | Cron diário e limite de lote não são SLA de monitoramento |
| L5 Negativos | ADR-071 e observação de cancelamento inesperado sem revogação | Reembolso/disputa reais ainda exigem E4 |
| L6 Planos/adicionais | H4 próximo ciclo integral, cancelamento intercalado e cotas preservados | Não aceita PENDING como pagamento |
| L7 Recontratação | Duas gerações anteriores; monitor inclui checkout antigo e pendente | Sem manipular a fixture remota ou alegar tempo decorrido |
| L8 E2E/segurança | Spec original preservada; tentativa dummy em cópia isolada sem readiness; CI própria | Inicialização local BLOCKED; manter dois SKIP da CI e provas separadas históricas, sem novo PASS |
| L9 Regressão | Gates locais/CI do novo SHA no encerramento | Não herdar totais de outro SHA |

O status executado dos gates locais deve ser lido no encerramento do relatório. Testes ainda em execução não recebem PASS por este mapeamento.

### Histórico preservado da conclusão anterior

Autenticação e ambiente Sandbox têm prova real; a [atestação inicial](SANDBOX-ATTESTATION-2026-11-07.json) de R$ 1 não substitui a mensalidade integral. A fixture atual pagou R$ 397 por cartão fictício na página de simulação do provedor, recebeu webhook real e confirmou direitos no DEV/Preview, sem invoice/evento positivo artificiais. O [snapshot sanitizado](evidencias/continuation-20261108.json) identifica o recorte. O E2E posterior conferiu UI paga, 409 ao contratar novamente e remoção dos bloqueios temporários, sem conectar integrações ou enviar convite. O callback no contexto isolado encontrou SSO da Vercel; a UI final foi testada após login legítimo. Ainda não há renovação temporal, chargeback, liquidação, coexistência financeira ativa ou paridade completa de gestão. Recuperação sem webhook foi testada com HTTP sintético; perda externa não foi induzida. Não repetir o pagamento já concluído nem usar o PAID inicial para renovar acesso.

## Estado após resposta de Guilherme — 09/11/2026

Este quadro substitui somente os estados atuais “aguardando suporte”; os quadros anteriores são históricos.

| Gate | Estado | Evidência | Próxima ação |
|---|---|---|---|
| E1 | PARTIAL — limitação Sandbox confirmada | Suporte: nenhum acelerador; testes locais de ciclos/planos/retries existentes | Observação temporal ou aceite formal do risco; não confundir fixture com renovação externa |
| E2 | PARTIAL — limitação da API confirmada | Suporte: sem endpoint de cobranças/ciclos por assinatura | Reenvio operacional com vínculo autoritativo e decisão de risco para ausência integral de webhook |
| E3 | BLOCKED — confirmação parcial pendente | Checkout não é uso único; customerId só preenche; efeito da URL após delete ainda em apuração | Preservar fixture; aguardar confirmação específica de invalidação e histórico |
| E4 | PARTIAL — procedimento esclarecido, ensaio externo NOT RUN | Dashboard/portal integral; refund cancela assinatura; sem simulador recorrente | Revisão humana ADR-071, procedimento operacional; não usar refund avulso nem oferecer parcial |
| L3-f / checkout.lost | PASS local | 35 testes focados e 51 checks PG com 142 migrations/HTTP sintético | Conferir CI do novo commit; não alegar disputa perdida real |

`checkout.lost` agora segue a observação financeira com auditoria/revisão e preservação do período pago. Replay não repete GET/efeito. `payment_failed` mantém revisão segura; metadados installment/retry ainda não são persistidos. Os IDs de pagamento recebidos são a base da conciliação; não inferir ciclos pela lista de assinaturas ou por valores parecidos.

## Fechamento operacional — 10/11/2026

[Plano final com arquivos, requisitos, riscos e matriz OPS-001–015](PLANO-FINAL-GO-LIVE-ABACATEPAY.md). [Prova 66/66](evidencias/operacao-final-20261110.json), PostgreSQL real/143 migrations, HTTP sintético/zero rede externa. Os 15 novos checks cobrem autorização única sob corrida, prova financeira obrigatória, contador/limite, owner recusado, snapshot/tenant divergente, estados terminais, RLS/grants, monitor concorrente, resolução, exclusões de trial/Asaas, rollback, dois eventos para o mesmo pagamento e quarentena sem associação artificial. Outros 51 checks foram regressão afetada do worker modificado.

O replay administrativo é uma nova leitura de evento **já recebido**, superadmin AAL2/TOTP atual, auditoria atômica e no máximo 3 autorizações/24h. Não reconstrói evento ausente nem permite editar invoice/período. O monitor sinaliza vencimento local sem pagamento conciliado; isso não prova falha do gateway nem pagamento perdido. Cron diário e limites de lote continuam explícitos. Entrega de alerta e jornada admin/MFA real no Preview: NOT RUN; testes de tela/unidade não as substituem. B1/B3 externos continuam bloqueados segundo a resposta recebida, sem repetir compra ou alterar a fixture paga retida.

**Checkpoint anterior — §39, superado pelo incremento abaixo:** a detecção sem evento e 92 checks de ciclo de vida já passaram; o estado atual de recuperação financeira e schema está em §41. Preservar essa prova histórica sem tratá-la como descrição da implementação vigente. [Evidência anterior](evidencias/operacao-continua-20261111.json).

## Recuperação sem webhook e fechamento — incremento de 11/11/2026

Fonte atual: [relatório §41](RELATORIO-HOMOLOGACAO-FINAL.md#41-recuperação-financeira-e-fechamento-preparado--11112026). Os cinco pagamentos iniciais da matriz permanecem homologados; não foram repetidos.

| Grupo | Prova efetivamente executada | Limite |
|---|---|---|
| Recuperação sem evento | Receita de cartão exata + período + dono, origem API privada; zero evento fabricado | HTTP sintético/PG loopback; schema remoto ainda pendente |
| Concorrência/retry | Oito workers, evento posterior/duplicado, invoice ausente, ledger pago/período antigo, falha transacional e retry | Não comprova renovação temporal real |
| Segurança | Cliente/tenant/loja/ambiente/valor/período incoerentes recusados, fonte com hash/FK, RLS e ausência de UPDATE/DELETE | Ambiguidade não concede mês/cota |
| Checkout consumido | Uma operação sob concorrência, timeout unknown sem segundo POST; invoice/binding intactos | Nenhuma exclusão real executada |
| Leituras pós-fechamento | Renovação, completed repetido, plano e refund sem GET do bill removido | Contrato externo dos GETs ainda precisa de prova |
| TISS/schema | 5/5: ambas ordens SQL/rollback, histórico comum e schema/RLS/catálogo preservados | Não é merge nem homologação funcional TISS |

A suíte PG financeira consolidada passou 115/115, incluindo 92 anteriores. Não somar os checks aos testes unitários nem aos pagamentos reais. CI/build/E2E do novo SHA são registrados nos checks do PR53 e na evidência final, sem herdar os resultados da baseline.

## Continuidade com branches independentes — 11/11/2026

[Checkpoint atual §42](RELATORIO-HOMOLOGACAO-FINAL.md#42-continuidade-com-branches-independentes--11112026). Os 120 checks financeiros preservam os 115 anteriores e acrescentam: rollback da nova cota, interrupção depois do commit, prova de ciclo anterior e dois estados de operador revogado. Cinco novos testes unitários da captura financeira passaram (três reproduziram a falha antes da correção); seis testes MFA adicionais passaram. O recorte de dez arquivos de autenticação/recuperação passou 101/101; esses números se sobrepõem e não devem ser somados.

A CI de `b6965447` concluiu na tentativa 2 com 7.005 testes e 22 E2E/zero SKIP. A CI da correção nova é vinculada ao seu próprio SHA no PR53. Não houve pagamento/probe/fechamento externo. A 0149 TISS em elaboração não foi incorporada e não recebe PASS de compatibilidade por herança da prova antiga até 0147. A instrução do founder é preservar branches/journals separados nesta rodada.

## Alerta entregue e composição fixada na 0149 — 11/11/2026

[Checkpoint atual §43](RELATORIO-HOMOLOGACAO-FINAL.md#43-alerta-entregue-e-composição-sql-fixada-na-0149--11112026). As provas anteriores permanecem datadas; esta atualização usou SQL TISS commitado em `b450a560897d4004b2de305ac91c3ffa1197ec89` até0149, depois estendido à0150 publicada em `6b101e892e4e856c5653e7bb89a1791ce452815c`. Somente objetos Git imutáveis; não lê SQL em edição nem altera journals.

| Grupo | Evidência desta rodada | Limite |
|---|---|---|
| Alerta Preview | Test Notification recebido; único probe414eb196 aceito HTTP200 e recebido pelo founder | Emissor direto Sentry; regras internas não auditadas por API401; não prova Production/SLA |
| Composição SQL até0150 | 21/21 nas duas ordens/rollback, índices/constraints/RLS/funções e dados anteriores preservados | Não é aplicação DEV, merge TypeScript ou homologação integral TISS |
| Gatilhos compartilhados | Trial/convênio coexistem; cobrança integral recusada antes de consumir quota; particular preservado | Dados sintéticos, sem chamada Asaas |
| Função substituída0149 | Congelamento sem gap; correção com gap/autor; duplicidade e leitura cruzada recusadas | Não muda regra de convênio |
| Financeiro com TISS | 120/120 cenários financeiros em banco composto0000–0150 + candidato; prova até0149 preservada | São os mesmos120, não somar como novas compras; zero rede externa |
| MFA normal Preview | Titular confirmou login/TOTP, página administrativa, logout negado e novo login | Não prova recuperação do fator, expiração forçada, replay ou MFA dos serviços externos |
| CI | Baseline b18407c3:7016 testes +22 E2E/zeroSKIP | Novo incremento tem CI própria no PR53 |

Os erros iniciais da fixture (slug longo e savepoint mal utilizado) foram corrigidos no harness, sem relaxar guards de produto. Fechamento real de fixture, renovação externa e composição live seguem pendentes. Não repetir pagamento inicial, probe entregue ou jornada normal MFA aprovada; recuperação/incidentes de acesso continuam separados.

## Trial definitivo e contrato SQL0151 — 12/11/2026

Estado atual em [relatório §44](RELATORIO-HOMOLOGACAO-FINAL.md#44-trial-definitivo-e-composição-com-0151--12112026). As cinco compras iniciais permanecem homologadas, sem repetição. Sentry Preview e MFA normal já passaram. Os checkpoints anteriores continuam históricos.

| Requisito | Evidência executada | Estado / limite |
| --- | --- | --- |
| Trial dia1/dia14/expirado, pendente/cancelado/período vencido/plano desconhecido | Policy/adapter unitários e PostgreSQL143/152 migrations | PASS local; nenhuma conta real alterada |
| Checkout SaaS durante o trial | UI e contrato server, journal, webhook autenticado, invoice e período atômicos | PASS unidade/PG49 e1/1 E2E autenticado no Preview4b666cc0, desktop/celular, fixture antiga preservada; sem nova compra |
| Bloqueio Asaas antes de provedor | Hosted checkout inicial/renovação recusados antes de claim e GET/POST; jobs de cobrança cancelados | PASS testes dirigidos com I/O controlado |
| IA inbound/ferramenta/worker | Decisão central antes de turno, revalidação transacional da ferramenta e jobs antes de contato/template/send | PASS testes dirigidos; flags/permissões existentes não removidas |
| Trial → pago | Mesma invoice positiva paga/same tenant/subscription e liberação; checkout pendente nunca concede | PASS PG49 com função SQL real0151 e N-1 sem função |
| TISS não operacional no trial | SQL0151 recusa enable/appointment e active sem release; wrapper preso à sessão/core privado | PASS entre33 verificações SQL |
| Pagamento não ativa TISS não liberado | App retorna module_unavailable, preservando a decisão operacional | PASS local; integração/revisão final dos PRs ainda necessária |
| Composição candidato + TISS0151 |33 checks, duas ordens/rollback, catálogo/contratos/recebíveis/gatilhos/RLS preservados | PASS local no snapshot2a707880; sem journal ou aplicação DEV |
| Recuperação/cotas/idempotência com0151 |120 checks financeiros reais de PG/HTTP controlado | PASS local; zero rede externa; não equivale a renovação externa |
| CI do código/build/E2E público | CI43154102122,4b666cc0:7061 testes/22E2E semSKIP | PASS; commit documental tem acompanhamento próprio no PR53 |

Próxima dependência de banco: acordar cauda final/número/timestamp, refazer preflight de hashes e obter aprovação específica DEV. Nenhum pagamento novo precisa ser solicitado para estes resultados. Fechamento externo, renovação real e composição live continuam gates independentes.

## Histórico da matriz G01–G24 — 12/11/2026, antes do scanner

**Esta versão foi substituída pela matriz G01–G28 ao final do documento.** A numeração antiga fica preservada para interpretar os registros anteriores; não é a decisão corrente.

Esta é a matriz corrente de decisão. Os checkpoints anteriores preservam evidências históricas; não são outras matrizes GO. `PASS local` não implica homologação externa ou autorização de publicação. Fonte detalhada: [relatório46](RELATORIO-HOMOLOGACAO-FINAL.md#46-atualização-da-cauda-tiss-para-0154--12112026) e incremento `scalabilityFollowup` no [registro canônico](evidencias/recuperacao-financeira-20261111.json). Estados abaixo se referem ao gate inteiro, incluindo suas dependências.

| ID | Descrição | Critério de aceite | Implementação | Evidência | Teste | Resultado | Risco | Responsável | Dependências | Estado | Ação pendente |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G01 | Trial14 dias | Marco Auth absoluto, sem reinício | `signup-free-trial`, claims privados | PG49 e Preview anterior | Dia1/14/expirado/pago | PASS local/Preview | Data incorreta libera acesso | Engenharia | Mesma origem Auth | PASS | Preservar no rollout |
| G02 | Entitlements backend | Trial não opera Asaas/IA/TISS | Policy central + guard SQL0151 | PG49/SQL35 e testes dirigidos | API/worker/ferramenta, tenant cruzado | PASS local | Bypass em futura composição | Engenharia | Flags/permissões mantidas | PASS | Revalidar a composição final TISS/live |
| G03 | Checkout idempotente | Dono/plano/preço, um comando | Binding/journal/CAS + contenção Redis | Cinco primeiras compras históricas | Concorrência/timeout/POST único | PASS local; controle Redis novo isolado | GET/Redis externo não medido sob carga | Engenharia | Redis/store/Preview | PARTIAL | Conferir novo transporte no Preview, sem repetir compra |
| G04 | Pagamento confirmado | Prova autenticada, sem ACTIVE como prova | Reader do provedor | Matriz197/397/544/691/838 preservada | Cinco pagamentos externos | PASS externo inicial | Renovação não se prova por saldo | Engenharia/financeiro | Loja/ambiente/vínculo | PASS | Não repetir pagamentos |
| G05 | Ativação única | Invoice/período/release atômicos | Apply transacional | PG120 + carga1000 | Duplicidade/rollback/concorrência | PASS local; iniciais externas preservadas | Composição futura pode regredir | Engenharia | G04/G17 | PASS | Preservar invariant tests |
| G06 | Invoice | Uma por obrigação/ciclo | Constraints + ledger |2000 invoices/1000 ciclos na carga | Retry/duplicata/falha transacional | PASS local | Invoice órfã em restore parcial | Engenharia | Integridade transacional | PASS | Postflight na janela autorizada |
| G07 | Cotas | Só o plano do período pago concede | Capacidade/trigger/release | PG120/49 e cinco compras | Médico extra, rollback, quota | PASS local/primeira contratação externa | Alteração remota só vale após renovação | Engenharia | Plano/evidência de ciclo | PASS | Homologar mudança no ciclo externo quando possível |
| G08 | Renovação normal | Receipt novo, calendário original | Reader + apply | PG120 | Repetida/tardia/fora de ordem | PASS local | Sem simulador recorrente | Engenharia/provedor | Evento natural | PARTIAL | Observar renovação externa ou submeter risco formal |
| G09 | Sem webhook | GET prova dono/valor/período e aplica uma vez | API provenance + recovery | PG120 | Ausência/concorrência/reparo | PASS local | Schema ausente, scan e scheduler limitados | Engenharia | G17/G18 e provedor | PARTIAL | Concluir execução incremental/agenda e homologação possível |
| G10 | Checkout consumido | Link fechado, históricos continuam consultáveis | Closure journal, sem retry cego | PG120 | Timeout/GET posterior/webhook tardio | PASS local | Sem prova externa após delete | Engenharia/provedor | Autorização de fixture irreversível | PARTIAL | Não fechar as cinco fixtures sem aprovação específica |
| G11 | Cancelar/recontratar | Preserva período pago; nova compra após fim | Management + histórico privado | PG120, contrato aprovado | Cancelamento/recontratação/negative events | PASS local | Cancelamento remoto irreversível | Engenharia/financeiro | Provedor/período vigente | PARTIAL | Preservar provas externas existentes; ampliar composição final |
| G12 | Upgrade/downgrade | Nova cota só na renovação paga; redução cabe | Plan changes + capacidade | PG120 |2–5 médicos, atraso/rollback | PASS local | Ciclo change-plan externo não antecipável | Engenharia/provedor | G08 | PARTIAL | Evidência natural e sem proporcional inventado |
| G13 | Multi-tenant | Nenhum efeito financeiro cruzado | RLS/vínculos/roles/guards | PG120/49/35 e carga1000 | Dono/loja/tenant incorretos | PASS local | Join amplo anterior corrigido | Engenharia | Gates de segurança do SHA | PASS | Confirmar CI final e postflight |
| G14 | MFA admin | MFA exigido, logout revoga sessão | Guard administrativo | Founder confirmou Preview | Login/TOTP/página/logout/novo login | PASS Preview | Não cobre recuperação do fator externo | Operador/engenharia | Mesmo guard | PASS | Não repetir jornada normal aprovada |
| G15 | Alertas | Falhas persistentes chegam ao responsável | Métricas/Sentry/heartbeat | Probe414eb196 entregue | Canal real Preview | PASS Preview | Regras Production não verificadas | Operação | Responsável/canal Production | PARTIAL | Preparar regra equivalente; não alterar Production agora |
| G16 | CI completa | Todos gates no SHA final | Workflow existente | CI43265236442 no 7e35aa3e; checks finais dos scripts no PR53 | Unitários/cobertura/build/E2E/security | 7080 testes/22 E2E zeroSKIP/build/cobertura PASS | Baseline não aprova mudança nova | Engenharia | Publicação da branch | PASS | Conferir checks do SHA final no PR antes da publicação |
| G17 | Schema TISS | Journal único, ordem/hashes, dados preservados | Manifest/pré/pós + journal proposto0155 fora do repositório | SQL35 + Drizzle8;144 hashes DEV auditados com baseline histórica | Upgrade Drizzle144→156 e segunda execução idempotente | PASS local | Número/cauda ainda não consolidados | Engenharia financeira/TISS | Cauda congelada e aprovação DEV | PARTIAL | Revisar proposta, congelar cauda e aprovar DEV pelos hashes finais |
| G18 | Escala | Invariantes, fila/capacidade/latência/custo medidos | Locks corrigidos, Redis, batch/backoff | 100/500/1000 clínicas; Redis real | 32 tarefas/20 controladores | Integridade PASS nas duas cargas; p95 até10,3s, diagnóstico de desempenho reprovado | Cron diário; scan500; custo não contratado | Engenharia/operação | G17/agenda/provedor | PARTIAL | Scan com checkpoint e execução frequente; medir fila HTTP |
| G19 | Resiliência/DR | Recuperar sem efeito financeiro duplicado | Leases/inbox/review/GET-only | PG120, provas de restore históricas | Falha DB/worker/provedor e retry | PASS local | RTO completo não medido; RPO sem PITR; auxiliar CLI aguarda limpeza autorizada | Engenharia/operação | Backup/cofre/plantão | PARTIAL | Ensaio operacional completo e cobertura de backlog |
| G20 | Segredos | Segredos fora de log/Git/browser | Env/cofre/sanitização | Inventário/diff sem segredo e gates 7e35aa3e aprovados | Bundle/AST/secret review | PASS do código runtime; checks finais no PR | Chave presente não é ativação | Engenharia | CI final | PASS | Confirmar gates do SHA; nunca ler chave live |
| G21 | Flags/kill switch | Pausa aquisição sem parar reconciliação | New-checkouts flag/allowlist Sandbox | Testes de aquisição e PG | Pause/cohort/consumidores | PASS Sandbox | Composição live inexistente | Engenharia | Implementação live | PARTIAL | Implementar/revisar live sem usar bypass Sandbox |
| G22 | Rollout/rollback | Sequência executável com stop/backup | Plano final e runbook | Procedimento revisado | Pré/pós SQL em scratch | Preparado | Rollback não desfaz cobrança remota | Engenharia/operação | G17/G21/G24 | PARTIAL | Completar release/journal live e ensaiar pacote final |
| G23 | Prova externa | Não chamar fixture de homologação | Readers/operador restritos | Cinco compras/Sentry/MFA preservados | Sem novo pagamento | Iniciais PASS; ciclos PARTIAL | Limites do Sandbox/fechamento | Engenharia/provedor | Evento/autorização específica | PARTIAL | Renovação/fechamento com evidência própria, sem cobrar de novo |
| G24 | Aprovação | Risco/cohort/plantão/janela autorizados | Termos de risco preparados | Nenhum aceite novo inventado | Revisão humana posterior aos gates | Não solicitado prematuramente | Cobrança/acesso de clientes | Founder/financeiro/operação | Gates críticos completos | BLOCKED | Submeter pacote final; não publicar nesta rodada |

**NO-GO de Production.** G17/G18/G21 incluem engenharia ainda pendente; não são genericamente dependências humanas. Renovação temporal e semântica pós-fechamento exigem prova externa; não se dispensam critérios por inferência. Testes novos e CI são vinculados ao SHA da implementação no registro de evidência, sem atribuir a ele os checks da baseline.

## Matriz corrente G01–G28 — scanner incremental, 12/11/2026

Numeração conforme a última missão do founder; os IDs G10–G24 da matriz anterior não devem ser interpretados com os significados novos. Evidência detalhada: [relatório §51](RELATORIO-HOMOLOGACAO-FINAL.md#51-ci-final-composição-isolada-e-incidente-tiss--12112026) e `executiveFollowup` no [registro canônico](evidencias/recuperacao-financeira-20261111.json). **Implementação/teste local não equivalem a homologação externa, Production Ready ou publicação.**

Tipos de dependência: **A** engenharia; **B** ambiente; **C** validação externa; **D** aprovação humana. Responsável padrão dos testes/código é Engenharia; gates operacionais/comerciais pertencem ao founder e aos responsáveis nomeados. Nenhum PASS é autorização de escrita compartilhada.

| ID | Critério e aceite | Implementação / teste / evidência | Estado do gate completo | Bloqueio / responsável | Próxima ação |
|---|---|---|---|---|---|
| G01 | Trial 14 dias desde Auth | Claims, provisionamento e prova PG de trial/expiração/pagamento antecipado | PASS local | Não; Engenharia | Preservar marco no rollout |
| G02 | Entitlements seguros | Trial nega IA/Asaas/TISS; pagamento não ativa módulo indisponível; SQL/runtime/worker | PASS local | Não na candidata; Engenharia | Revalidar pacote final/live |
| G03 | Checkout idempotente | Cinco compras preservadas; Preview autenticado e duas entregas concorrentes de evento sintético, uma inbox/um processamento; repetição não altera contrato/invoice/cota | PASS Sandbox/Preview delimitado | Não para caminho provado; Engenharia | Manter prova de falhas distribuídas isoladas; não repetir compra |
| G04 | Pagamento confirmado | R$197/397/544/691/838 com comprovação externa histórica | PASS Sandbox inicial | Não para primeira compra; Engenharia | Preservar evidências |
| G05 | Ativação única | PG125 inclui 10.000º comprovante, concorrência e falha transacional | PASS local | Não; Engenharia | Postflight na futura aplicação |
| G06 | Invoice correta | Uma invoice por obrigação/ciclo, valor e vínculo verificados, rollback/duplicata | PASS local | Não; Engenharia | Preservar invariantes |
| G07 | Cotas corretas | Plano pago, variantes 1–5 médicos, reservas e testes de capacidade | PASS local / Sandbox inicial | Não na contratação inicial; Engenharia | Homologação externa de mudança de ciclo separada |
| G08 | Renovação | Receipt novo e calendário original; atraso, duplicata, fora de ordem | PARTIAL | C; Engenharia/provedor | Evento natural ou aceite formal; não afirmar transcurso mensal |
| G09 | Recuperação sem webhook | Proveniência privada e125 checks PG; schema0159 aplicado DEV, scanner durável disponível | PARTIAL | C; Engenharia/provedor | Observar receipt/período de ciclo real quando disponível; ambiguidades em revisão |
| G10 | Scanner incremental | Cursor/fencing/backoff/identidades,22 checks PG com mais de10.000 registros por finalidade; schema aplicado DEV | PASS local + schema DEV | A/B para carga remota; Engenharia | Execução operacional sem carga destrutiva no DEV compartilhado |
| G11 | Fechamento/readback | Um POST real Sandbox200, ausência na listagem; GET/subscrição/extrato preservados; retry zeroPOST; evento tardio sintético Preview aplicado; UI “Não encontramos este link”, zero campos de cartão | PASS externo delimitado | C apenas para ciclo posterior; nenhuma nova tentativa de pagamento | Preservar fixture; próximo vencimento consultado11/12 não é renovação observada |
| G12 | Cancelamento/reativação | Preserva período pago; recontratação posterior; eventos negativos vão à revisão | PARTIAL | A/C; Engenharia | Validar composição final; sem reativação remota fictícia nem refund automático |
| G13 | Upgrade/downgrade | Nova cota somente na renovação paga; capacidade e período protegidos | PARTIAL | C; Engenharia/provedor | Observar ciclo externo; não inventar proporcional |
| G14 | Concorrência | Leases, fencing, transações, contrato correto antes do lock; PG125/22 e carga1000 | PASS local | Não; Engenharia | Preservar sob pacote integrado |
| G15 | Escalabilidade |100/500/1000 isolados e scanner10.000; Preview autenticado com concorrência pequena e cliente/DB reais | PARTIAL | B; Engenharia/operação | Medir capacidade em infraestrutura isolada equivalente; não usar volume destrutivo no DEV |
| G16 | Rate limit/circuit | Redis real isolado:429/outage/reset/retry; caminho obrigatório Redis no Preview autenticado concluído | PASS local + Preview saudável | B para pane/capacidade no ambiente-alvo | Não derrubar Redis compartilhado para testar; ensaio de pane permanece isolado |
| G17 | Multi-tenant | RLS forçada, vínculos de loja/cliente/geração, sem invoice/cota cruzada | PASS local | Não; Engenharia | CI/isolamento e postflight finais |
| G18 | MFA | Login/TOTP/página/logout/novo login confirmados pelo founder no Preview | PASS Preview histórico | Não; Operador | Não repetir sem mudança relevante |
| G19 | Sentry/alertas | Probe414eb196 entregue; métricas de scanner/backlog e falha de ativação | PARTIAL | D; Operação | Aprovar/ensaiar regras Production sem novo probe financeiro |
| G20 | CI completa |04a4fd73:7.139/7.139,22E2E semSKIP, build/tipos/lint/cobertura/segurança/isolamento; Semgrep/Snyk/VercelPASS | PASS no SHA04a4fd73 | Não nesse SHA; Engenharia | Conferir os checks próprios do commit documental posterior |
| G21 | SQL/journal reconciliados | Manifesto fixo, Drizzle real e backup; TISS já aplicado pelo outro agente;0159 aplicada por este operador,159→160, segundo runnoop,224 tabelas preservadas | PASS DEV | D apenas para futura aplicação Production | Preservar pacote/hashes; Production não autorizada por esta permissão |
| G22 | Compatibilidade TISS | SQL41/financeiro125/trial50/migrator9, DEV160; composição isolada com journal160,36 testes de ordem, arquitetura1.999 arquivos e NextbuildREADY(tipos/lint); incidente confirmado CARE_TYPES no PreviewTISS9b463168 | PARTIAL; FAIL funcional TISS conhecido | A; responsável PR55 e integração | Mover constante de use-client para módulo compartilhado e provar RSC real; build não encerra esse incidente |
| G23 | Homologação externa | Cinco iniciais, fechamento/readback, Sentry e MFA preservados; renovação natural ainda não observada | PARTIAL | C/D; Provedor/founder | Monitorar renovação ou tratar formalmente risco; não repetir compras/fechamento/probes |
| G24 | Rollout/rollback | Live explícito, catálogo separado, cohort obrigatório e kill switch; consumers continuam; DEV release ensaiado/aplicado | PARTIAL | D/C; Engenharia/operação | Configuração live/webhook/catalog/cohort e janela somente após gates; não usar chave real agora |
| G25 | Incidente Vercel | Auxiliar exato removido após preflight, GET posterior404; QoroProductionSHA5620a098 preservado/app e landing200 | PASS | Não; Engenharia | Sem nova remoção; custos residuais não foram medidos |
| G26 | Aprovação operacional | Responsável, monitoramento, capacidade, backup/recuperação e janela definidos no runbook | BLOCKED | D; Operação/founder | Aceitar pacote operacional depois dos gates técnicos |
| G27 | Aprovação comercial | Trial/preços/cotas/cancelamento preservados; risco de renovação separado | BLOCKED | D; Founder/financeiro | Aprovação final dos riscos externos e modalidades efetivas |
| G28 | Aprovação Production | Preparação e rollout condicional autorizados; nenhuma migration Production autorizada pela etapa DEV | BLOCKED pelos gates restantes | C/D; Founder/Operação | Não executar rollout enquanto critérios obrigatórios pendentes |

**Decisão: NO-GO de Production.** O scanner e a primeira contratação não eliminam os gates externos. A composição live explícita já está implementada e testada na candidata, sem credencial ou configuração Production alterada. Capacidade e falhas no ambiente-alvo continuam distintas das provas isoladas; o código operacional TISS pertence ao PR55. A busca de estornos agora usa checkpoints de finalidade própria, com isolamento dos comprovantes de cartão e atualização de movimentos sob identidade estável. O fallback N-1 de cinco páginas permanece somente sem o schema aprovado. Isso não equivale a comprovar externamente disputas ou outros eventos que o provedor não simula. Não alterar contratos/cotas nem usar cobranças adicionais para resolver divergências.

## Matriz corrente G01–G28 — reconciliação e infra, 13/11/2026

Esta tabela substitui os estados correntes anteriores, sem apagar o histórico. Fonte: [relatório§52](RELATORIO-HOMOLOGACAO-FINAL.md#52-reconciliação-final-com-tiss-e-prova-operacional--13112026) e `finalTissReconciliation` na evidência canônica. PASS local, Sandbox e externo são escopos distintos. Tipos A engenharia, B ambiente, C validação externa, D aprovação humana.

| Gate | Área | Estado | Evidência / ação restante |
| --- | --- | --- | --- |
| G01 | Trial 14 dias desde Auth | PASS local | Provas anteriores50 e gates compostos; não reconta desde checkout |
| G02 | Entitlements | PASS local/composto | Trial e status-only negam; invoice paga libera somente plano; TISS operacional separado |
| G03 | Checkout idempotente | PASS Sandbox/Preview | Cinco compras preservadas; repetição recusada no Preview com aquisição pausada |
| G04 | Pagamento confirmado | PASS Sandbox inicial | Sem nova transação nesta rodada; renovação é G08 |
| G05 | Ativação | PASS local/Sandbox | Financeiro125, readback e UI paga1440/390px |
| G06 | Invoice | PASS local/Sandbox | Uma obrigação, valor/vínculo corretos; carga sem duplicação |
| G07 | Cotas | PASS contratação inicial | Cinco valores e variantes preservados; UI5 médicos conferida |
| G08 | Renovação externa | PARTIAL — C | Não existe acelerador; aguardar ciclo ou aceite formal específico |
| G09 | Recuperação sem webhook | PARTIAL externo; PASS local | Scanner/125/HTTP reais locais; novo ciclo externo não observado |
| G10 | Scanner/cursor | PASS local + DEV schema | Mais de10.000 por finalidade, fencing/retry; sem volume no DEV compartilhado |
| G11 | Fechamento/readbacks | PASS externo delimitado | Prova anterior preservada; não repetir fechamento/pagamento |
| G12 | Cancelamento/recontratação | PASS local; PARTIAL externo | Período preservado/revisão; eventos não simuláveis não recebem PASS externo |
| G13 | Upgrade/downgrade | PASS local; PARTIAL externo | Cota só em renovação paga; falta ciclo externo de alteração |
| G14 | Concorrência | PASS local integrado | Leases/worker morto/restart, Redis/PG, zero ciclo/invoice cruzada |
| G15 | Escala | PASS integridade isolada; PARTIAL capacidade alvo | Coortes100/500/1000, backlog0; não garante SLA Vercel/provedor |
| G16 | Rate limit/circuito | PASS infra isolada + Preview saudável | 429/Retry-After, Redis pausado, cinco503/circuito e recuperação reais locais |
| G17 | Multi-tenant | PASS local + readback DEV | RLS/constraints45relações; nenhum vínculo financeiro cruzado |
| G18 | MFA | PASS Preview histórico | Confirmação anterior do founder preservada, sem mudança relevante |
| G19 | Sentry/alertas | PASS Preview; PARTIAL live | 414eb196 entregue; tag preview confirmada; regras/cohort live pendentes |
| G20 | CI do incremento | PENDING final commit | Baseline5144:7139/22 semSKIP; não atribuir ao novo código; conferir PR53 |
| G21 | SQL/journal | PASS DEV | 160 entradas;0159 correta e não reaplicada;6 exceções históricas preservadas |
| G22 | Compatibilidade TISS | PASS composição fixada; PARTIAL UI TISS final | e144 corrigido;125+regressões PG/build/tipos/lint/711; três SKIP corpus preexistentes; UI financeira PASS. Jornada TISS autenticada/delta posterior pertencem PR55 |
| G23 | Homologação externa | PARTIAL — C/D | Cinco iniciais/fechamento/MFA/alerta preservados; ciclo natural pendente |
| G24 | Rollout/rollback | PREPARADO; PARTIAL live | Catálogo/loja/webhook/cohort/agenda e janela faltam; consumers separados da aquisição |
| G25 | Auxiliar Vercel | PASS histórico | Remoção anterior comprovada; nenhuma nova remoção |
| G26 | Aprovação operacional | BLOCKED — D | Nomear responsáveis/cohort e aprovar cobertura/risco; proposta piloto até10 |
| G27 | Aprovação comercial | BLOCKED — D | Nenhum aceite implícito de risco externo ou autorização para cobrar/migrar |
| G28 | Production | NO-GO — C/D | Sem merge/deploy/migration/contrato real nesta rodada |

**GO técnico condicionado** aos checks do commit final e à composição fixada/revisada. **NO-GO operacional live e comercial.** O TISS permanece desligado para clínicas reais; o avanço posterior do proprietário não é automaticamente coberto por estas provas. Não reexecutar as cinco compras, MFA ou alerta já comprovados.

## Matriz vigente G01–G28 — fechamento live e piloto, 13/11/2026

Substitui estados correntes anteriores, preservando histórico. SHA base financeiro16d9062b + incremento desta seção; pin TISS4d0ed1d5 (runtime igual a bf59). O commit e os hashes LF do incremento, os resultados finais e o Preview estão em liveFinalization do [JSON canônico](evidencias/recuperacao-financeira-20261111.json). O SHA do documento não é apresentado como SHA de um merge que não ocorreu. Toda linha usa esse pacote salvo quando marca evidência histórica. A engenharia executa as validações técnicas; C é evento externo e D é decisão humana.

| Gate | Área | Estado | Evidência | Ambiente | Risco / responsável | Próxima ação |
|---|---|---|---|---|---|---|
| G01 | Trial desde Auth | PASS local | PG de trial50 e129 financeiro; datas absolutas preservadas | Local/DEV | Regressão de release; Engenharia | Conferir pós-voo; sem novo trial |
| G02 | Entitlements | PASS local/composto | Gates SQL/runtime/worker; premium11, invoices reais sintéticas | Local composto | Não habilitar TISS por pagamento; Engenharia | Manter módulo condicionado à liberação |
| G03 | Checkout único por operação | PASS delimitado | Cinco compras históricas, journal/CAS/concorrência;106 testes dirigidos | Sandbox/Preview/local | Reuso do link R1; Engenharia | Fechamento automático preparado; monitorar live autorizado |
| G04 | Pagamento inicial | PASS Sandbox | 197/397/544/691/838 preservados, sem repetição | Sandbox histórico | Não prova ciclo seguinte; Financeiro | Não criar novas compras de teste |
| G05 | Ativação atômica | PASS local/Sandbox | 129 PG; invoice/período/cota na mesma transação | Local + iniciais Sandbox | Evidência ausente não concede; Engenharia | Pós-voo na janela |
| G06 | Invoice | PASS local/Sandbox | Constraints/rollback/duplicata e129 PG | Local + iniciais Sandbox | Uma obrigação por ciclo; Engenharia | Preservar ledger e trilha |
| G07 | Cotas | PASS inicial/local | 1–5 médicos e release só após invoice paga | Local/Sandbox | Nova cota só na renovação; Engenharia | G13 separado |
| G08 | Renovação externa | PARTIAL C/D | Calendário/readers/129 PG; suporte sem acelerador | Local; externo NOT RUN | Impacto alto/probabilidade desconhecida; Founder/provedor | Ciclo natural ou aceite formal delimitado |
| G09 | Sem webhook | PARTIAL externo | Receipts/scanner/API provenance/transação; perfil pilot | Local isolado | Ambiguidade vai à revisão; Engenharia/provedor | Observar novo ciclo externo quando disponível |
| G10 | Scanner durável | PASS local + DEV | 22 checks e >10.000 movimentos/finalidade;160 entradas DEV | Local/DEV leitura | Capacidade remota distinta; Engenharia | Conferir cron/cursor no piloto autorizado |
| G11 | Fechamento/readback | PASS externo delimitado + local | Sandbox anterior fechado; novo automático live129 PG:1POST/1audit/unknown sem replay | Sandbox anterior/local sintético | Janela pré-fechamento R1; Engenharia/operação | Sem encerrar fixtures retidas; prova live só autorizada |
| G12 | Cancelar/recontratar | PASS local; PARTIAL externo | 129 PG e evidências anteriores; acesso até fim pago | Local/Sandbox anterior | Cancelamento remoto irreversível; Financeiro | Nova contratação só após período; observar negativos |
| G13 | Upgrade/downgrade | PASS local; PARTIAL externo | Cota agendada só no ciclo pago; rollback/capacidade | Local | Sem proporcional separado; Engenharia/provedor | Ciclo change-plan natural ou risco formal |
| G14 | Concorrência | PASS isolado | 129 PG; workers/Redis/leases reais, audit idempotente | Local | Host gerenciado ainda não certificado; Engenharia | Preservar no pacote composto |
| G15 | Escala | PASS isolado; PARTIAL alvo | 100/500/1000 anteriores, perfil10/ticks frios adicionais | Local isolado | Sem SLA Vercel/provedor; Operação | Piloto1→3→10 proposto, não ativado |
| G16 | Rate limit/circuito | PASS isolado/Preview saudável | Redis real;429/cinco503/pane/retry e106 testes dirigidos | Local/Preview histórico | Não derrubar Redis compartilhado; Engenharia | Monitorar consumo/conexões no alvo autorizado |
| G17 | Multi-tenant | PASS local + leitura DEV | RLS/loja/cliente/ambiente;45 relações/227 fingerprints | Local/DEV leitura | Nenhum vínculo artificial; Engenharia | CI isolamento + pós-voo |
| G18 | MFA | PASS Preview histórico | Founder confirmou login/TOTP/logout/novo login | Preview | Recuperação do fator distinta; Operação | Preservar prova; não repetir jornada normal |
| G19 | Alertas/observação | PASS Preview; PARTIAL live | 414eb196 entregue; watch agora no tick existente; cron falho sem heartbeat | Preview/local | Canal/live/responsáveis; Operação | Ensaiar regra live somente em janela autorizada |
| G20 | CI final | PASS código1703b3f2 | CI43416581923:7147/22E2E semSKIP, build/tipos/lint/segurança; demais checksSUCCESS | GitHub Actions | Commit documental tem checks próprios; Engenharia | Conferir HEAD atual no PR antes da publicação |
| G21 | SQL/journal | PASS DEV/local | 160 entradas,0159 hash congelado;Drizzle9/9;no reapply | DEV leitura/local | Seis hashes históricos não reescritos; Engenharia | Preflight específico Production em janela |
| G22 | Composição TISS | PASS composição fixada; TISS live separado | 1703b3f2+4d0ed1d5:tipos/lint/build,836 testes e3 SKIP antigos, UI paga1440/390;PG13/10/11/10 e journal160 | Export descartável | UI TISS específica pertence PR55; Engenharia/TISS | Rever só delta futuro e manter TISS condicionado à sua liberação |
| G23 | Homologação externa | PARTIAL C/D | Cinco iniciais/closure/MFA/alerta preservados | Sandbox/Preview | Renovação natural/eventos sem simulador; Provedor/founder | Não repetir compras para substituir ciclo |
| G24 | Rollout/rollback | PREPARADO; PARTIAL live | Catálogo/ambiente/cohort/flag, consumers e rotação bounded; dossiê executável | Código/local | Configuração real e janela; Engenharia/operação | Não usar chave live nem publicar agora |
| G25 | Auxiliar Vercel | PASS histórico | GET404 projeto exato;Production5620a098 preservada | Vercel leitura | Custos residuais não medidos; Operação | Sem nova remoção |
| G26 | GO operacional | BLOCKED D | Proposta de cohort/responsáveis/controles no dossiê | Documento | Faltam nomes/cobertura/configuração; Founder/operação | Definir clínica consentida e responsáveis |
| G27 | GO comercial/risco | BLOCKED D | R1–R4 explicitados sem aceite; preços/regras preservados | Documento | Nenhuma autorização para cobrar/migrar; Founder/financeiro | Aprovar ou rejeitar risco delimitado |
| G28 | Production | NO-GO C/D | Nenhum merge/deploy/DDL/contrato real nesta rodada | Production intocada | G08/G19/G24/G26/G27; Founder/operação | Autorizar janela só depois dos gates |

**GO técnico delimitado** ao código1703b3f2 e pacote composto aprovado; confirmar checks próprios do HEAD documental. **NO-GO operacional live, comercial e de Production.** Não repetir compras iniciais, MFA ou alerta comprovados. A proposta de piloto não é autorização para ativá-lo.


## Delta corrente G01–G28 — janela técnica13/11, relatório54

As linhas abaixo substituem apenas os estados citados; os demais G01–G28 e suas evidências permanecem. Fonte: authorizedWindowHomologation no JSON canônico.

|Gate|Estado corrente|Evidência / próxima ação|
|---|---|---|
|G01/G02/G07|PASS preservado + trial real Preview sem checkout|Nova EARLY-01:14dias desde Auth, zero liberação paga e WhatsApp/Asaas bloqueados; conversão antecipada ainda aguarda pagamento|
|G03/G11|PASS local/closure externa anterior; PARTIAL automático live|Não repetir closure anterior; consumer Production ainda ausente,404; sem publicar nesta rodada|
|G04–G06|Cinco compras anteriores PASS preservado|Sem novo checkout/pagamento; EARLY-01 tem objetivo adicional distinto|
|G08/G09/G12/G13/G23|PARTIAL externo|Sem acelerador de renovação localizado; manter fixtures e calendário; novo checkout inicial não supre novo ciclo|
|G15/G16|PASS isolado ampliado; PARTIAL alvo|Coortes1/3 HTTP/Redis/PG passaram sem invariantes quebradas; manter10/100/500/1000 anteriores, sem SLA/custo externo|
|G19|PASS entrega Preview e Production; PARTIAL consumidores financeiros live|ed622a74 aceito200 e recebido pelo founder; não comprova código ainda não implantado|
|G20|7161/632 locais PASS; CI do novo commit a conferir|64 dirigidos/tipos/lint; registrar build/CI reais, sem herdar baseline|
|G21/G22|PASS preservado, nenhuma migration nova|Operador agora aceita somente cauda congelada160 e recusa drift; fontesruntime/TISS não mudaram|
|G24|PREPARADO parcialmente executado|Catálogo5 e cinco variáveis salvas; checkoutsfalse; segredo exclusivo. Webhook/cron dependem de release autorizado|
|G26|Janela técnica encerrada; piloto BLOCKED D|Founder e canal disponíveis na janela; clínica/financeiro/plantão/substituto do piloto não selecionados|
|G27|BLOCKED D|Nenhum aceite de R1–R4 ou autorização financeira real|
|G28|NO-GO de ativação comercial|Configuração live mudou com autorização; release5620a098/contratos/banco preservados. Publicação/migrations/piloto não autorizados|

### Checkpoint corrente — EARLY-01 paga, 13/11

Substitui apenas o estado corrente acima; histórico preservado. Evidência: relatório §55 e JSON canônico `earlyPaymentAndHydration20261113`.

| Gate | Estado | Prova e limite |
|---|---|---|
| G01/G02/G04–G07 | PASS EARLY-01 Sandbox/Preview | R$197 confirmados, completed aplicado, uma invoice/attempt/receipt, período13/11–13/12 antes do fim do trial, 1 médico/3 administrativos, UI1440/390; não habilitou TISS nem conectou integrações |
| G03/G14/G17 | PASS delimitado | Inbox duplicate, worker/recuperação sem reaplicar, snapshot inalterado; recusa409 de nova contratação. Falhas/concorrência/cross-tenant isoladas anteriores preservadas, sem injeção no DEV compartilhado |
| G11 | PASS fechamento Sandbox controlado; PARTIAL automático live | Um journal/audit, removido da listagem, assinatura/invoice preservadas. Não comprova invalidação absoluta do link ou fechamento automático no Sandbox |
| G08/G09/G12/G13/G23 | PARTIAL externo preservado | Compra antecipada não demonstra renovação natural, novo ciclo com cota alterada ou evento negativo sem simulador |
| G20 | PASS código dc95caa4 | CI43457077686:7161 testes/22E2E semSKIP;17 testes de observabilidade repetidos PASS. Conferir checks do commit documental final |
| UI/Sentry R51 | FAIL reproduzido; causa PARTIAL | #418 no dashboard TISS a04a1535; não reproduzido nas repetições do SHA exato. Financeiro dc95:22 verificações de navegação/logout sem pageerror. Mapeamento Sentry corrigido no PR53, ainda ausente do PR55 |
| G21/G22/G24/G26–G28 | Preservados; NO-GO live | Nenhum SQL/runtime/deploy alterado nesta rodada; composição final deve incluir classificação Sentry correta e tratar R51. Sem novo pagamento solicitado |

### Consolidação vigente — relatório56

Esta tabela substitui somente o checkpoint corrente; as evidências anteriores e as cinco compras iniciais ficam preservadas. Não pedir outro pagamento EARLY-01.

| Gates | Estado e ambiente | Evidência / requisito restante |
|---|---|---|
|G01–G07|PASS Sandbox/local delimitado|Cinco contratações e EARLY-01 preservadas; nenhuma compra repetida ou segundo trial. Cotas1médico/3administrativos da fixture paga|
|G08/G09|PASS técnico local; PARTIAL externo|Observador read-only novo: próxima cobrança oficial13/12/2026, ACTIVE, zero ciclo; só observar o ciclo natural pode ampliar a prova externa|
|G10|PASS anterior preservado|Scanner/cursor PostgreSQL sem novo SQL; não confundir com scanner publicado em Production|
|G11/G14|PASS local131 checks; closure Sandbox anterior PASS|Novos testes de crash e falha pré-comando sem POST/replay, outra geração prossegue. Automático Production NOT RUN; R1 não aceito|
|G12/G13/G23|PASS local; PARTIAL externo|Ciclo de vida incluído nos131; sem alterar cotas antes de renovação paga nem simular estorno externo como real|
|G15/G16|PASS isolado preservado; PARTIAL alvo|Sem novo SLA.1closure/tick e20s de deadline;10links exigem no mínimo10ticks. Redis/429/backlog e scheduler precisam de observação autorizada|
|G17/G18|PASS anterior preservado|Sem novo tenant/conta, sem repetir MFA, sem desabilitar isolamento|
|G19|PASS canais anterior; PARTIAL financeiro live|Alertas Preview e ed622a74 já entregues; nenhum probe repetido. Consumidor/cron live ainda não implantados|
|G20|PASS CI do código c2431ab7; checks documentais no PR|Run43516219770:7179/634 e22E2E semSKIP, build/tipos/lint/segurança. Semgrep/Snyk/Vercel PASS|
|G21/G22|PASS build, regressões e navegador do pin|Financeiroc2431ab7+TISS30126eff; journal160/hash SQL preservados; Preview dpl_4kk22srPhRSRBZAq4aCmE1F8A5i3 READY.778 testes/3SKIP antigos,7 credenciamento e13 cobertura PostgreSQL PASS.26 verificações estritas desktop/mobile/Tóquio/SãoPaulo sem erro. Nenhum SQL remoto; R51 não encerrado por amostragem|
|G24|PARTIAL; ativação depende de janela|Catálogo/segredo preparados; Production5620a098 preservada, sem webhook ativo para endpoint incompatível|
|G25|PASS histórico preservado|Auxiliar Vercel removido anteriormente com GET404; nenhuma nova remoção, custo residual não medido|
|G26/G27/G28|BLOCKED D / NO-GO live|Faltam responsáveis/cohort, tratamento expresso deR1–R4 e autorização Production. Nenhuma cobrança real ou merge|
|UI/R51|FAIL reproduzido / causa PARTIAL|Novo#418 em carga mobile TISS com resposta coletada integralmente;16cargas+logout.13casos instrumentados sem reprodução não encerram o incidente compartilhado|
