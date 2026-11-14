# Auditoria das leituras privilegiadas do convênio e dos pagamentos (P6, 14/11/2026)

Escopo: todo uso de conexão administrativa (`dbAdmin`, que ignora RLS) introduzido pelo módulo de
convênios e pelo R54. São três caminhos:

| # | Caminho | Arquivo | Desde |
| --- | --- | --- | --- |
| 1 | Exportação do lote em segundo plano: a permissão de quem pediu, conferida na execução | `src/contexts/health-insurance/internal/delegation-permission.ts` | R45 (12/11) |
| 2 | Varreduras do cron `financial-reconcile`: "convênio sem guia" e coparticipação atrás do dinheiro | `src/contexts/health-insurance/billing-gap-candidates.ts` | P7.4 / P10.5 |
| 3 | Varredura do estorno feito direto no Asaas (webhook perdido) | `src/app/api/cron/financial-reconcile/route.ts` + `external-refund-sweep.ts` | R54 (14/11) |

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
| Varredura devolve só identificadores | `financial-reconcile/route.test.ts` (colunas da consulta do R54); R54 (5) |

## Riscos que sobram

- A permissão delegada poderia sair de `dbAdmin` para uma função `SECURITY DEFINER` estreita. O escopo
  já é o mesmo, então é melhoria e não falha.
- As varreduras do cron dependem do `CRON_SECRET`. Vazar o segredo permite acionar o cron, mas não ler o
  resultado (a resposta HTTP só traz contagens).
