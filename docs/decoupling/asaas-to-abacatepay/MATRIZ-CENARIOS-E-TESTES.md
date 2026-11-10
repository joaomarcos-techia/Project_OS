# Cenários financeiros e nível real de validação

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
