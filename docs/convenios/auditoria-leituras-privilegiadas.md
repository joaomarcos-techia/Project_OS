# Auditoria das leituras privilegiadas do convênio e dos pagamentos (P6, 14/11/2026)

Escopo: todo uso de conexão administrativa (`dbAdmin`, que ignora RLS) introduzido pelo módulo de
convênios e pelo R54. São quatro caminhos:

| # | Caminho | Arquivo | Desde |
| --- | --- | --- | --- |
| 1 | Exportação do lote em segundo plano: a permissão de quem pediu, conferida na execução | `src/contexts/health-insurance/internal/delegation-permission.ts` | R45 (12/11) |
| 2 | Varreduras do cron `financial-reconcile`: "convênio sem guia" e coparticipação atrás do dinheiro | `src/contexts/health-insurance/billing-gap-candidates.ts` | P7.4 / P10.5 |
| 3 | Varredura do estorno feito direto no Asaas (webhook perdido) | `src/app/api/cron/financial-reconcile/route.ts` + `external-refund-sweep.ts` | R54 (14/11) |
| 4 | Lista de clínicas da manutenção de Convênios (fim do `financial-reconcile`) | `src/contexts/health-insurance/billing-gap-candidates.ts` (`listInsuranceMaintenanceClinics`) | P6.6/P12.6 (16/11) |

O lint e o `arch:db-check` só permitem `dbAdmin` em arquivos listados com justificativa. Isso
**não** é a prova de segurança: as provas são os testes adversariais da última seção.

## 1. Permissão de quem pediu a exportação (leitura delegada)

| Pergunta | Resposta |
| --- | --- |
| Identidade | O worker do outbox (handler destacado `insurance-batch-export`) age **em nome** de quem pediu (`requestedBy` do evento). |
| Por que admin | A view `effective_permissions_v` (papel + exceções + filtro do plano) lê `role_permissions`, que o papel `authenticated` não enxerga. É a mesma decisão do `requireFreshPermission`, mas sem sessão. |
| Escopo | Uma pessoa, uma clínica, uma permissão do catálogo (`manage:financial`). |
| Clínica | A do evento do outbox. O handler recusa sem nova tentativa se `payload.clinicId` difere da clínica do evento. |
| Registro | Negação auditada (`health_insurance.guide.access_denied`, motivo `permission_revoked`, ator `delegated`); leitura permitida auditada em nome de quem pediu, com serviço e job. |
| Conferência | `ativo` e `deleted_at IS NULL` da view; permissão no array efetivo. Conferida na **execução**, não só no pedido. |
| Tabelas | Só a view `effective_permissions_v`. |
| Colunas | Nenhuma: a resposta é um booleano (`EXISTS`). |
| Menos privilégio | Possível com uma função `SECURITY DEFINER` estreita, concedida a `authenticated`. Seria equivalente em escopo; fica como melhoria, não como falha. |
| Risco entre clínicas | Pessoa de outra clínica não tem linha na view para esta clínica: `false`. As guias são lidas sob RLS da clínica do evento, só as do lote. |
| Assinatura | Reconferida na exportação. Trial, suspensa ou cancelada viram bloqueio comercial (`premium_denied`), sem nova tentativa. |
| Job cancelado | O lote precisa continuar `prepared` e na mesma `version`. Cancelado ou alterado: o job caduca sem gerar nada. |
| Identificador manipulado | `batchId` de outra clínica: "lote inexistente nesta clínica". `userId`/`clinicId` fora do formato UUID: `false` antes de consultar. |
| Auditoria | Sim (acima). |
| Limites | Um lote por job; a exportação já limita guias por lote (até 100, padrão TISS, e a regra da operadora). |

## 2. Varreduras do `financial-reconcile` (convênio sem guia; coparticipação)

| Pergunta | Resposta |
| --- | --- |
| Identidade | O cron, autenticado por `CRON_SECRET` (`withCron`). |
| Por que admin | É uma varredura **entre clínicas**: descobrir quais clínicas têm trabalho exige ler mais de um tenant. |
| Escopo | Só leitura, numa transação curta com `RESET ROLE`. |
| Clínica | Vem da própria linha encontrada. O processamento de cada candidato roda depois em `withTenant(clinicId)`, sob RLS. |
| Registro | Métricas por execução (`financial.reconcile.run`) e o heartbeat do cron. Mudanças feitas pelo processamento por clínica entram na auditoria dele (ex.: `health_insurance.copay.synced_from_payment` com ator de sistema). |
| Conferência | Não há pessoa. A regra de cada mudança é reaplicada sob RLS (funções do banco com `hi_session_clinic`). |
| Tabelas | `hi_clinic_settings`, `appointments`, `hi_billing_gaps`, `hi_guide_items`/`hi_guides`, `outbox` (estado do evento); `hi_copayments`, `lancamentos`, `payment_transactions`, `patient_charges` para a coparticipação. |
| Colunas | Devolve só `clinic_id`, `appointment_id`/`copayment_id` e o estado do evento. Valores entram só em filtros e agregados internos, nunca no resultado. |
| Menos privilégio | Não há alternativa sem leitura entre clínicas. Iterar clínica por clínica exigiria listar clínicas, que também é leitura entre tenants. |
| Risco entre clínicas | O resultado não sai do processo do cron. Cada candidato é tratado só na própria clínica, sob RLS. |
| Assinatura | Na criação de guia, o bloqueio comercial é reaplicado e vira pendência. A coparticipação só acompanha o dinheiro que já entrou ou saiu (não é operação nova). |
| Job cancelado | Não se aplica (varredura periódica, idempotente). |
| Identificador manipulado | Os ids vêm do próprio banco, não de entrada externa. |
| Auditoria | Por mudança, no processamento por clínica. |
| Limites | `LIMIT` (25 e 50 por execução) e prazos de tempo (começar antes de 45 s, terminar até 52 s). |

## 3. Varredura do estorno externo (R54)

| Pergunta | Resposta |
| --- | --- |
| Identidade | O mesmo cron `financial-reconcile` (`CRON_SECRET`). |
| Por que admin | Descobrir cobranças pagas a reler, em todas as clínicas, quando o webhook se perdeu. |
| Escopo | Só leitura, transação curta com `RESET ROLE`, só identificadores. |
| Clínica | A da cobrança encontrada. A leitura no Asaas usa a **chave daquela clínica** (`getClinicAsaasClient`), e o reconhecimento roda em `withTenant`, sob RLS. |
| Registro | Reconhecimento auditado (`payments.patient_charge.external_refund_recognized`, ator de sistema, origem `reconcile`) com evidência só de inclusão em `patient_external_refunds`; métricas da varredura. |
| Conferência | A regra de atribuição (`decideExternalRefund`) e a idempotência por patamar valem igual ao webhook. |
| Tabelas | `patient_charges`. |
| Colunas | Só `id`, `clinic_id` e `provider_payment_id` (provado no teste da rota: nem valor, nem paciente). |
| Menos privilégio | Igual ao caminho 2. |
| Risco entre clínicas | O pagamento é sempre lido com a chave da clínica dona da cobrança, e a cobrança é procurada só na clínica da sessão (RLS). |
| Assinatura | Não se aplica: conciliar dinheiro que saiu não é operação nova. Clínica suspensa continua tendo o livro corrigido. Sem conta Asaas ativa, a cobrança é pulada e o cursor avança. |
| Job cancelado | Não se aplica. |
| Identificador manipulado | Ids vêm do banco; o reconhecimento confere que o pagamento lido é o pedido. |
| Auditoria | Sim (acima). |
| Limites | 10 cobranças por execução, prazo de tempo próprio (começar antes de 38 s, terminar até 44 s) e janela de 180 dias. O cursor `refund_checked_at` avança mesmo em falha, então uma conta quebrada não prende a fila. |

## 4. Lista de clínicas da manutenção de Convênios (P6.6/P12.6, 16/11)

| Pergunta | Resposta |
| --- | --- |
| Identidade | O mesmo cron `financial-reconcile` (`CRON_SECRET`), na última etapa, depois de todas as obrigações financeiras. |
| Por que admin | Saber quais clínicas têm Convênios instalado é leitura entre clínicas (mesmo motivo do caminho 2). |
| Escopo | Só leitura, transação curta com `RESET ROLE`, uma consulta. |
| Clínica | A da própria linha. O trabalho de cada clínica (vencer autorizações, contagens do resumo, limpeza de envios abandonados) roda em `withTenant(clinicId)`, sob RLS. |
| Registro | Métricas só com contagens (`insurance.maintenance.run`, `.daily_summary`, `.clinic_failed` com o tipo do erro); o vencimento grava o histórico da autorização com ator de sistema. |
| Conferência | Não há pessoa. O vencimento reaplica a regra no banco (data da clínica). |
| Tabelas | Só `hi_clinic_settings`. |
| Colunas | Só `clinic_id` (provado no harness: nem `enabled`, nem dados da clínica). |
| Menos privilégio | Igual ao caminho 2: não há alternativa sem leitura entre clínicas. |
| Risco entre clínicas | A lista não sai do processo do cron. Cada clínica é tratada só na própria sessão; a falha de uma não para as outras e a métrica não leva o id. |
| Usuário excluído | Não se aplica (sem pessoa). |
| Assinatura / módulo desligado | A clínica entra com o módulo ligado ou desligado, e com assinatura suspensa: vencer senha é manutenção de estado, não operação nova (a 0164 preserva o UPDATE de `hi_authorizations`). Provado no harness (6): rodada sem falha com o módulo desligado. |
| Job cancelado | Não se aplica (varredura periódica, idempotente: a segunda execução não vence nada de novo). |
| Identificador manipulado | Os ids vêm do próprio banco, não de entrada externa. |
| Limites | `LIMIT 200` clínicas por execução, prazos próprios (parar de começar clínica aos 53 s, encerrar até 56 s) e só depois das etapas financeiras: falha ou estouro aqui não interrompe obrigação financeira legada (teste da rota). |

## 5. Interruptor do módulo pela plataforma (P1.13, 17/11)

Arquivo: `src/contexts/health-insurance/platform.ts` (contrato para o console do #57; sem tela nem rota neste PR).
Não usa `dbAdmin` direto: roda dentro da transação do `superAdminAction`.

| Pergunta | Resposta |
| --- | --- |
| Identidade | Super admin com AAL2 (`requireSuperAdmin`), conferido antes de qualquer leitura. |
| Por que admin | Ligar ou desligar o módulo de uma clínica e listar o estado de todas é operação de plataforma, fora de qualquer clínica. |
| Escopo | Uma transação por pedido; ligar/desligar toca só `hi_clinic_settings` da clínica pedida (`FOR UPDATE`). |
| Clínica | A do pedido (uuid validado; inexistente é recusada). Nenhuma outra linha muda (provado: B continua como estava). |
| Registro | Duas trilhas na mesma transação: `super_admin_actions` (quem, ação, clínica, motivo) e `audit_events` da PRÓPRIA clínica (antes, depois e motivo). Pedido repetido não grava nada. |
| Conferência | Ligar exige a disponibilidade comercial `convenios.available = true` (ausente = desligado) e assinatura que inclua Convênios (D24: serviço e gatilho `hi_aa_premium_settings`). Desligar é sempre possível (contenção). |
| Tabelas e colunas | Lista: `clinics` (id, nome, situação) e `hi_clinic_settings` (instalado, ligado, data), mais o motivo comercial (`qoro_premium_denial_for`). Nada de paciente, guia, valor ou credencial. |
| Menos privilégio | O console é a única porta; a função fica fora de `internal/` só para o console importar. |
| Risco entre clínicas | A lista é só para o super admin e também fica registrada (`health_insurance.module.states_read`). |
| Usuário excluído / sessão | Sem super admin ativo com AAL2, recusa antes de abrir transação. |
| Identificador manipulado | Clínica inexistente: erro conhecido, sem detalhe interno. |
| Limites | Lista paginada (até 200 por página, continuação por id). |

Prova: `scripts/security/health-insurance-platform-db.ts` (6/6) e `platform.test.ts` (7 unitários).

## Provas adversariais

| Caso | Onde |
| --- | --- |
| Clínica diferente / lote de outra clínica | `health-insurance-batch-export-async-db.ts` (1); R54: `payments-external-refund-db.ts` (8) |
| Job adulterado (clínica do payload ≠ do evento) | handler: falha sem nova tentativa `clinic_mismatch` |
| Permissão revogada | export (2) |
| Pessoa desativada ou excluída | export (8a, novo neste ciclo) |
| Trial | export (8a, novo neste ciclo) |
| Clínica suspensa / assinatura cancelada | export (8) |
| Documento inexistente | export (1): lote inexistente; R54 (8): cobrança inexistente |
| Concorrência | export (dois workers, um arquivo); R54 (11): quatro instâncias, um reconhecimento |
| Reprocessamento | export (replay = `already_exported`); R54 (2): evento do livro reprocessado à força |
| Identificador manipulado | export (1); R54 (8): pagamento da clínica A pela conta da clínica B |
| Varredura devolve só identificadores | `financial-reconcile/route.test.ts` (colunas da consulta do R54); R54 (5); manutenção: `health-insurance-maintenance-db.ts` (6) |
| Clínica sem o módulo / módulo desligado na manutenção | `health-insurance-maintenance-db.ts` (6): sem Convênios não entra; desligado entra e não falha |
| Isolamento por clínica na manutenção | `health-insurance-maintenance-db.ts` (4) e `maintenance.test.ts` (falha de uma clínica não para as outras) |

## Riscos que sobram

- A permissão delegada poderia sair de `dbAdmin` para uma função `SECURITY DEFINER` estreita. O escopo
  já é o mesmo, então é melhoria e não falha.
- As varreduras do cron dependem do `CRON_SECRET`. Vazar o segredo permite acionar o cron, mas não ler o
  resultado (a resposta HTTP só traz contagens).

## Gate permanente (14/11, noite)

`src/contexts/health-insurance/privileged-reads-gate.test.ts` roda em toda execução do vitest, portanto no CI. Ele
reprova:

- arquivo novo com `dbAdmin.` em `src/contexts/health-insurance/**` ou `src/app/api/cron/financial-reconcile/**`;
- uso a mais num arquivo já auditado. Hoje: `delegation-permission.ts` 1, `billing-gap-candidates.ts` 3 (as duas
  varreduras do caminho 2 e a lista do caminho 4, desde 16/11), `financial-reconcile/route.ts` 3; a 3ª é a
  transação em que roda `external-refund-sweep.ts`;
- arquivo auditado que este documento deixe de citar.

Para passar com um caminho novo: responder as 15 perguntas aqui, acrescentar a prova adversarial e só então
atualizar a lista do teste.

**Conferência do ciclo de 14/11 (noite): nenhuma leitura privilegiada nova.**

- A aba Convênios da ficha do paciente (`getPatientInsuranceOverview`) lê por `withTenant`, com a RLS da clínica da
  sessão. A prova de outra clínica receber "não encontrado" está em `health-insurance-config-db.ts`.
- O guarda de composição de migrations (`scripts/security/migration-composition-io.ts`) lê só
  `drizzle.__drizzle_migrations` e o catálogo (`to_regclass`/`to_regprocedure`). Roda nos migradores operados por
  pessoa (`db-migrate-prod.ts`, `db-migrate-dev-limited.ts`), não no runtime do app, e não lê dado de clínica.
