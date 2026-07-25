# Auditoria de Lógica de Negócio — Qoro

**Data:** 2026-07-24  
**Escopo:** auditoria estática de regras de negócio, estados, transições e integrações. Não é uma revisão de estilo de código.  
**Método:** leitura de documentação e implementação dos contextos de agenda, pacientes, financeiro, IA, WhatsApp, billing, permissões, prontuário e relatórios.  
**Status:** remediação implementada e coberta por testes automáticos; o item 10 (PIX) permanece adiado por decisão do produto.

## Veredito executivo

A fundação é consistente: há isolamento por clínica, trilha de auditoria, idempotência, outbox e máquinas de estado para agenda e financeiro. As permissões granulares estão implementadas no servidor para os planos **Clínica** e **Pro**; usuários são a única quota comercial bloqueante, enquanto agendamentos e conversas de IA são apenas métricas.

Ainda assim, eu não aprovaria a operação autônoma em larga escala antes dos P0. Os principais riscos são: ações da IA sem confirmação técnica, identificação ambígua de pacientes por telefone, financeiro sem ledger de pagamentos parciais, estorno que não representa reembolso real, referências cross-tenant não validadas em todos os fluxos e estados de agenda sem recuperação operacional.

## Estado da remediação em 2026-07-24

O texto original dos achados foi mantido abaixo como registro do diagnóstico. Esta seção documenta o estado do código após a implementação. Foram resolvidos 25 dos 26 itens; o PIX continua fora do escopo conforme decisão explícita do produto.

| Item | Estado | Implementação validada no código | Teste automático principal |
| --- | --- | --- | --- |
| 1 | Resolvido | Ações sensíveis da IA viram intenção pendente cifrada, expiram e só executam após confirmação vinculada ao turno. | `src/contexts/ai-agent/internal/pending-action.test.ts` |
| 2 | Resolvido | O registro de tools permite no máximo uma mutação por turno; múltiplas mutações são rejeitadas. | `src/contexts/ai-agent/tools/registry.test.ts` |
| 3 | Resolvido | Telefone compartilhado falha fechado, marca identidade ambígua e exige seleção/desambiguação antes de ação sensível. | `src/contexts/ai-agent/internal/conversation-identity.test.ts`, `appointment-selection.test.ts` |
| 4 | Resolvido | Ledger append-only de pagamentos com valor, data, método, operador, comprovante e saldo derivado. | `src/contexts/financial/internal/payment-ledger.test.ts`, `payment-ledger-migration.test.ts` |
| 5 | Resolvido | Reembolso parcial/total é uma transação financeira própria vinculada ao pagamento, sem apagar o histórico. | `src/contexts/financial/internal/payment-ledger.test.ts`, `types.test.ts` |
| 6 | Resolvido | Referências externas recebidas por financeiro e agenda são validadas por `id + clinic_id` na transação. | `src/contexts/financial/internal/tenant-references.test.ts`, `src/contexts/scheduling/internal/tenant-references.test.ts` |
| 7 | Resolvido | Correções excepcionais auditadas para interromper, cancelar, reabrir e transferir; interface disponível na visão diária da agenda. | `recovery-policy.test.ts`, `appointment-recovery.test.ts`, `agenda-operations-ui.test.ts` |
| 8 | Resolvido | A IA lista consultas elegíveis e vincula “SIM/NÃO” à consulta correta antes da confirmação. | `appointment-selection.test.ts`, `tools/registry.test.ts` |
| 9 | Resolvido | `maxDaysAhead` e anonimato são revalidados pelo seam autoritativo antes de criar agenda. | `prompts/system.test.ts`, `tools/registry.test.ts` |
| 10 | Adiado | PIX/link/baixa automática não foram implementados. A IA continua consultando pendências e encaminhando quando necessário. | Não aplicável por decisão de escopo. |
| 11 | Resolvido | Handoff possui responsável formal, reatribuição explícita, prioridade, prazo persistido de 30 minutos, destaque e filtro de vencidos. Responder, priorizar e devolver exigem ser o responsável atual. | `handoff-sla.test.ts`, `internal/reply-policy.test.ts` |
| 12 | Resolvido | Callbacks reconciliam `sent/delivered/read/failed`; a thread mostra o estado real e permite reenvio somente de falha confirmada, criando nova tentativa imutável. | `messaging/internal/delivery-status.test.ts`, `ai-agent/manual-message-retry.test.ts` |
| 13 | Resolvido | No instante do envio, follow-up relê prontuário assinado, necessidade de retorno, paciente e consulta posterior equivalente. | `proactive-jobs/application/process.test.ts` |
| 14 | Resolvido no núcleo | Ausência por período reorganiza em transação única, cancela ou transfere, registra correções e eventos individualizados; há tela operacional e histórico futuro. O aviso externo requer template Meta aprovado. | `doctor-absence-validation.test.ts`, `doctor-absence.test.ts`, `agenda-operations-ui.test.ts` |
| 15 | Resolvido | Salas, equipamentos e outros recursos reserváveis possuem cadastro, reserva e conflito de período, sem limitação por plano. | `schedulable-resources.test.ts` |
| 16 | Resolvido | Walk-ins entram em fila persistida com prioridade, ordem, estimativa e capacidade operacional. | `internal/walkin-queue.test.ts` |
| 17 | Resolvido | Cobrança considera saldo parcial e dívidas antigas entram em casos de cobrança manual com estágios. | `dunning-candidates.test.ts`, `dunning-policy.test.ts`, `collection-cases.test.ts` |
| 18 | Resolvido | Consentimento é append-only por finalidade e canal; opt-out cria supressão específica e novo consentimento remove somente supressão gerada por consentimento. | `consent-decisions.test.ts` |
| 19 | Resolvido | Óbito é registrado com data/motivo/auditoria, bloqueia agenda e mensagens e cancela operações futuras compatíveis. | `patient-death.test.ts` |
| 20 | Resolvido operacionalmente | Pedido LGPD tem responsável, prazo, motivo de estado, histórico e marcação de notificação. Prazo de acesso completo: até 15 dias; hard delete permanece em 30 dias. Envio de e-mail fica manual enquanto não houver provider configurado. | `lgpd-workflow.test.ts`, `lgpd-policy.test.ts` |
| 21 | Resolvido | Importação histórica possui fluxo separado, permissão, lote, origem, justificativa, status terminal e proveniência por consulta. | `appointment-import.test.ts` |
| 22 | Resolvido | Jobs usam lease com token, recuperação de lease vencido, finalização condicional e seleção justa por clínica. | `infra/proactive-lease.test.ts`, `application/enqueue.test.ts`, `application/process.test.ts` |
| 23 | Resolvido | Relatórios agregam no banco, processam todos os IDs em lotes sem teto funcional e agrupam caixa no fuso da clínica. | `src/app/(app)/(shell)/relatorios/report-aggregation.test.ts` |
| 24 | Resolvido | Evento de ativação publica o código real do plano carregado da assinatura. | `src/contexts/billing/internal/subscriptions.test.ts` |
| 25 | Resolvido | Lista de espera e recorrência semanal possuem entidades, políticas, actions e telas operacionais. | `waitlist-policy.test.ts`, `recurrence-policy.test.ts` |
| 26 | Resolvido | Responsáveis/dependentes, regra de menor, merge conservador e auditado e redirecionamento da origem foram implementados. Seleção de candidatos usa busca assíncrona, sem truncar em 200 pacientes. | `minor-policy.test.ts`, `patient-relationships-merge.test.ts`, `patient-relationship-search.test.ts` |

### Decisões comerciais preservadas

- A única quota comercial bloqueante é a quantidade de usuários do plano.
- Agendamentos, mensagens e conversas com IA não possuem bloqueio por quota; continuam mensuráveis para observabilidade.
- Salas e equipamentos estão disponíveis em todos os planos.
- Permissões granulares ficam disponíveis nos planos Clínica e Pro; o dono mantém permissões gerais e pode personalizar acessos dos demais usuários.
- Relatórios continuam obedecendo aos entitlements de plano já definidos no código.

### Migrations aditivas

As migrations `0054` a `0070` cobrem limites/entitlements, permissões, ações pendentes da IA, ledger financeiro, cobrança, recuperação de agenda, ausências, recursos, filas, recorrência, entrega WhatsApp, consentimento, LGPD, importação, leases, relacionamentos/merge e handoff. `pnpm check:migrations` confirmou que não há operação destrutiva nova não aprovada.

### Validação automatizada

- Baseline anterior às remediações: **88 arquivos / 909 testes**, todos aprovados.
- Cada item recebeu teste específico ou ampliação de teste existente, conforme a matriz acima.
- Validações direcionadas executadas durante a implementação: testes de domínio, type-check e verificação de segurança das migrations, todos verdes após os ajustes.
- O resultado da suíte integral, lint e build fica registrado na seção “Resultado final de validação”, ao fim deste documento.

### Testes manuais complementares

Estes testes dependem de integrações ou observação operacional e não substituem os testes automáticos:

1. **WhatsApp real:** receber callbacks da Meta para `sent`, `delivered`, `read` e `failed`; confirmar os selos na thread; provocar uma falha e usar “Reenviar”, verificando que a tentativa antiga permanece como falha e nasce uma nova tentativa.
2. **Template de ausência:** cadastrar e aprovar um template Meta específico antes de automatizar aviso de cancelamento/transferência por ausência. O repositório hoje publica os eventos, mas não inventa esse template.
3. **LGPD por e-mail:** enquanto não houver provider de e-mail configurado, o operador deve realizar a comunicação externa e marcar a notificação na tela de LGPD.
4. **Correção de agenda:** em ambiente de homologação, interromper um atendimento em andamento, reabri-lo quando cancelado/faltou e transferi-lo; confirmar fila, recursos, profissional atual e trilha de correção.
5. **Ausência médica:** cadastrar período com cancelamento e com substituição; revisar a contagem afetada, conflitos do substituto e histórico de ausências.
6. **Merge de pacientes:** usar dois cadastros de homologação com agenda, financeiro e prontuário; confirmar bloqueio de conflitos ambíguos, transferência dos vínculos e redirecionamento do cadastro origem.
7. **Migrations em dev:** a primeira aplicação de `pnpm db:migrate:dev` falhou de forma transacional na `0068`, com PostgreSQL `55P04`, porque o novo valor `processing` do enum era usado antes do commit. A migration foi corrigida sem operação destrutiva e ganhou teste de regressão; repetir o comando e verificar as versões `0054`–`0070`. Não executar em produção como parte desta auditoria.

Referência regulatória usada no item 20: [Direitos dos titulares — ANPD](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares) e [Lei 13.709/2018 — Planalto](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm).

## P0 — bloquear antes de escalar

### 1. Ações destrutivas da IA sem confirmação server-side

**Categoria:** IA / Segurança / Agenda  
**Gravidade:** Crítica  
**Probabilidade:** Média  
**Impacto financeiro:** Alto — cancelamentos, encaixes e perda de horários.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Alto.

**Descrição:** O prompt exige confirmação, mas as ferramentas de agendamento, cancelamento e reagendamento executam diretamente quando chamadas pelo modelo. A confirmação é uma instrução textual, não uma regra do servidor.

**Como o problema acontece:** O modelo interpreta uma frase ambígua como confirmação e chama a ferramenta.

**Exemplo real:** O paciente pergunta “posso cancelar a consulta de amanhã?” e a IA cancela em vez de explicar o procedimento.

**Consequência:** Consulta cancelada sem consentimento inequívoco e sem mecanismo formal de desfazer.

**Como corrigir:** Criar intenção pendente no servidor, resumo da ação, confirmação explícita vinculada à ação, expiração e idempotência por confirmação.

**Complexidade:** Alta  
**Prioridade:** P0

**Evidência:** `src/contexts/ai-agent/prompts/system.ts`, `src/contexts/ai-agent/tools/{schedule,cancel,reschedule,confirm}-appointment.ts`.

### 2. A IA pode executar várias mutações em uma mensagem

**Categoria:** IA / Segurança  
**Gravidade:** Alta  
**Probabilidade:** Média  
**Impacto financeiro:** Alto.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Alto.

**Descrição:** O prompt determina “uma ação por mensagem”, mas o handler percorre todos os tool calls devolvidos pelo modelo.

**Como o problema acontece:** Uma resposta do modelo contém cancelamento e novo agendamento, ambos executados sequencialmente.

**Exemplo real:** “Cancele terça e marque quinta” resulta em duas alterações automáticas sem confirmações separadas.

**Consequência:** A unidade de decisão do paciente deixa de ser controlável e auditável.

**Como corrigir:** Rejeitar mais de uma mutação por turno ou representar uma única intenção transacional com confirmação explícita.

**Complexidade:** Média  
**Prioridade:** P0

**Evidência:** `src/contexts/ai-agent/internal/handlers/inbound-received.ts`.

### 3. Identificação por telefone pode selecionar o paciente errado

**Categoria:** Pacientes / IA / LGPD  
**Gravidade:** Crítica  
**Probabilidade:** Alta  
**Impacto financeiro:** Alto.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Crítico — exposição de agenda e cobranças.

**Descrição:** O telefone não é único no cadastro. Ao encontrar mais de um paciente com o mesmo hash de telefone, a conversa seleciona a primeira linha encontrada.

**Como o problema acontece:** Famílias, responsáveis e filhos compartilham um WhatsApp.

**Exemplo real:** A mãe pergunta sobre a consulta do filho, mas a IA associa a conversa ao cadastro da mãe e expõe pendências ou altera a agenda errada.

**Consequência:** Agendamento, cancelamento, confirmação e cobrança aplicados ao paciente incorreto.

**Como corrigir:** Criar modelo de responsável/dependente e exigir desambiguação por nome, CPF parcial ou data de nascimento antes de qualquer ação sensível.

**Complexidade:** Alta  
**Prioridade:** P0

**Evidência:** `src/contexts/patient/schema.ts`, `src/contexts/ai-agent/internal/conversation.ts`.

### 4. Pagamento parcial não possui histórico financeiro próprio

**Categoria:** Financeiro / Caixa  
**Gravidade:** Crítica  
**Probabilidade:** Alta  
**Impacto financeiro:** Crítico.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Médio.

**Descrição:** Um lançamento guarda apenas o total acumulado pago, um método e a data final de quitação. Pagamentos parciais sobrescrevem o método anterior e não têm valor, data, operador e comprovante próprios.

**Como o problema acontece:** Um atendimento é recebido em mais de uma parcela ou por mais de um meio de pagamento.

**Exemplo real:** R$ 500 em dinheiro hoje e R$ 500 em PIX na semana seguinte.

**Consequência:** Conciliação, auditoria e relatórios não mostram o dinheiro efetivamente recebido em cada dia.

**Como corrigir:** Criar ledger/tabela de transações de pagamento vinculadas ao lançamento, com valor, data, método, comprovante, operador e reversão.

**Complexidade:** Alta  
**Prioridade:** P0

**Evidência:** `src/contexts/financial/{schema,actions,queries,types}.ts`.

### 5. Estorno não representa necessariamente o reembolso real

**Categoria:** Financeiro / Auditoria  
**Gravidade:** Crítica  
**Probabilidade:** Média/alta  
**Impacto financeiro:** Crítico.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Alto em disputas.

**Descrição:** O estorno cria um lançamento oposto com `valorPago = 0` e status `estornado`; ele não registra a saída real do dinheiro nem suporta reembolso parcial.

**Como o problema acontece:** Um atendimento pago precisa ser total ou parcialmente devolvido.

**Exemplo real:** A clínica devolve R$ 200, mas o sistema apenas muda o status do lançamento original.

**Consequência:** Fluxo de caixa e saldo histórico podem não refletir o reembolso efetuado.

**Como corrigir:** Separar cancelamento, ajuste contábil e reembolso financeiro; registrar valor devolvido, data, método, comprovante, aprovador e vínculo com o pagamento original.

**Complexidade:** Alta  
**Prioridade:** P0

**Evidência:** `src/contexts/financial/actions.ts`, `src/contexts/financial/queries.ts`.

### 6. Referências entre clínicas não são validadas em todos os fluxos

**Categoria:** Multi-tenancy / Integridade  
**Gravidade:** Alta  
**Probabilidade:** Baixa/média  
**Impacto financeiro:** Alto.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Alto.

**Descrição:** Alguns fluxos aceitam UUIDs de paciente, fornecedor, unidade ou feriado sem validar explicitamente que o recurso pertence à clínica atual. Uma FK prova a existência do registro, mas não o pertencimento ao mesmo tenant.

**Como o problema acontece:** Um ID conhecido de outra clínica é usado em lançamento ou configuração.

**Exemplo real:** Uma conta da clínica A referencia uma unidade ou paciente da clínica B.

**Consequência:** Contaminação de dados, relatórios errados e risco de exposição indireta.

**Como corrigir:** Validar `id + clinic_id` dentro da mesma transação para toda referência cross-context recebida como input.

**Complexidade:** Média  
**Prioridade:** P0

**Evidência:** `src/contexts/financial/actions.ts`, `src/contexts/scheduling/{config-actions,internal/appointment-core}.ts`.

### 7. Agenda sem recuperação para atendimento iniciado por engano ou interrompido

**Categoria:** Agenda / Operação  
**Gravidade:** Alta  
**Probabilidade:** Alta  
**Impacto financeiro:** Alto.  
**Impacto operacional:** Crítico.  
**Impacto para o paciente:** Alto.

**Descrição:** `em_atendimento` só pode transicionar para `atendido`; estados terminais não podem ser corrigidos ou reabertos por fluxo oficial.

**Como o problema acontece:** O paciente é chamado por erro, o médico falta, há queda de sistema ou o atendimento precisa ser transferido.

**Exemplo real:** O paciente fica preso como “em atendimento” após o médico se ausentar.

**Consequência:** Agenda, fila, prontuário e faturamento passam a refletir uma realidade falsa.

**Como corrigir:** Criar ações auditadas de interromper, corrigir, transferir, reabrir e cancelar excepcionalmente, com motivos obrigatórios.

**Complexidade:** Alta  
**Prioridade:** P0

**Evidência:** `src/contexts/scheduling/state-machine.ts`.

## P1 — corrigir antes de ampliar operação e vendas

### 8. Lembrete pede “SIM/NÃO”, mas não fecha a confirmação

**Categoria:** WhatsApp / Agenda / IA  
**Gravidade:** Alta  
**Probabilidade:** Alta  
**Impacto financeiro:** Médio/alto.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Médio.

**Descrição:** O template pergunta “Confirma? SIM/NÃO”, mas não há ferramenta para listar as consultas do paciente nem mecanismo que relacione a resposta a uma consulta específica.

**Como o problema acontece:** O paciente responde “SIM” e a IA não possui o `appointment_id` exigido para confirmar.

**Exemplo real:** O lembrete é enviado, mas o status permanece `agendado`.

**Consequência:** A clínica acredita em uma confirmação que não existe no sistema.

**Como corrigir:** Adicionar `list_my_appointments`, seleção contextual e confirmação auditável da consulta correta.

**Complexidade:** Média  
**Prioridade:** P1

**Evidência:** `src/contexts/ai-agent/proactive-jobs/infra/templates.ts`, `src/contexts/ai-agent/tools/confirm-appointment.ts`.

### 9. Configurações da IA não são regras autoritativas

**Categoria:** IA / Configuração  
**Gravidade:** Alta  
**Probabilidade:** Média  
**Impacto financeiro:** Médio.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Médio.

**Descrição:** `maxDaysAhead` e `canScheduleAnonymous` estão no contexto/prompt, mas não são aplicados como regra independente no core de agenda.

**Como o problema acontece:** Uma IA ou integração fornece diretamente data fora do limite configurado.

**Exemplo real:** A clínica limita agendamentos a 30 dias e uma consulta é marcada para 90 dias.

**Consequência:** A configuração administrativa não corresponde ao comportamento real.

**Como corrigir:** Enforçar essas regras no Scheduling/AI seam; implementar de fato ou remover o modo anônimo.

**Complexidade:** Média  
**Prioridade:** P1

**Evidência:** `src/contexts/ai-agent/{schema,internal/context-builder,prompts/system}.ts`, `src/contexts/ai-agent/tools/schedule-appointment.ts`.

### 10. A IA não conclui cobrança

**Categoria:** Produto / Comercial / WhatsApp  
**Gravidade:** Alta, se “cobrança por IA” significar gerar e receber pagamento.  
**Probabilidade:** Certa no código atual.  
**Impacto financeiro:** Alto.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Médio.

**Descrição:** A IA lista pendências, mas não cria cobrança, não gera PIX, não envia link de pagamento e não confirma recebimento.

**Como o problema acontece:** A promessa comercial é entendida como cobrança efetiva, mas o atendimento humano precisa concluir a operação.

**Exemplo real:** O paciente pede “me envie o PIX” e recebe handoff.

**Consequência:** Frustração, esforço manual e possível divergência entre produto e comunicação comercial.

**Como corrigir:** Implementar cobrança integrada ou explicitar que a IA apenas consulta e encaminha.

**Complexidade:** Alta  
**Prioridade:** P1

**Evidência:** `src/contexts/ai-agent/tools/list-pending-payments.ts`.

### 11. Fila humana sem SLA, responsável e escalonamento

**Categoria:** Atendimento / IA  
**Gravidade:** Alta  
**Probabilidade:** Alta  
**Impacto financeiro:** Médio/alto.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Alto.

**Descrição:** Há fila de handoff, porém não há fluxo completo de atribuição, SLA, alerta de envelhecimento ou escalonamento operacional.

**Como o problema acontece:** A IA encaminha uma conversa e ninguém assume formalmente a responsabilidade.

**Exemplo real:** Um pedido de atendimento humano fica aberto até o dia seguinte sem notificação.

**Consequência:** Leads, cancelamentos e reclamações ficam sem resposta.

**Como corrigir:** Criar responsável, prazo, prioridade, alertas e relatório de conversas vencidas.

**Complexidade:** Média  
**Prioridade:** P1

**Evidência:** `src/contexts/ai-agent/{schema,actions,internal/conversation}.ts`.

### 12. Status do WhatsApp não representa entrega real

**Categoria:** WhatsApp / Confiabilidade  
**Gravidade:** Alta  
**Probabilidade:** Alta  
**Impacto financeiro:** Médio.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Alto.

**Descrição:** Callbacks de entrega são persistidos como eventos crus, mas não atualizam o status da mensagem enviada. `accepted` significa aceitação pelo provedor, não entrega.

**Como o problema acontece:** A equipe toma decisões porque acredita que uma mensagem chegou.

**Exemplo real:** Confirmação de consulta é aceita pela Meta, mas nunca entregue ao paciente.

**Consequência:** No-show, comunicação enganosa e perda de chance de retry.

**Como corrigir:** Consumir callbacks, manter estados `sent/delivered/read/failed` e criar alertas/retry para falhas.

**Complexidade:** Média  
**Prioridade:** P1

**Evidência:** `src/contexts/messaging/{schema,events,internal/inbound}.ts`.

### 13. Follow-up clínico pode ser enviado fora de contexto

**Categoria:** IA / Clínico / WhatsApp  
**Gravidade:** Alta  
**Probabilidade:** Média  
**Impacto financeiro:** Médio.  
**Impacto operacional:** Médio.  
**Impacto para o paciente:** Alto.

**Descrição:** O job de follow-up não possui guard forte no momento do envio.

**Como o problema acontece:** O paciente já retornou, mudou de profissional ou o plano clínico foi alterado.

**Exemplo real:** O sistema envia “está na hora de retornar” depois que o paciente já retornou.

**Consequência:** Comunicação incoerente e perda de confiança clínica.

**Como corrigir:** Revalidar a necessidade de retorno e ausência de consulta posterior equivalente antes do envio.

**Complexidade:** Média  
**Prioridade:** P1

**Evidência:** `src/contexts/ai-agent/proactive-jobs/application/process.ts`.

### 14. Ausência do profissional não reorganiza consultas futuras

**Categoria:** Agenda / Equipe  
**Gravidade:** Alta  
**Probabilidade:** Média/alta  
**Impacto financeiro:** Alto.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Alto.

**Descrição:** É possível desativar profissional mediante override consciente, mas não existe fluxo de realocação, cancelamento em lote ou aviso aos pacientes.

**Como o problema acontece:** Profissional entra de férias, adoece ou é desligado com agenda futura.

**Exemplo real:** O lembrete continua sendo enviado com o nome de um médico inativo.

**Consequência:** Cancelamentos tardios, no-show e quebra de confiança.

**Como corrigir:** Criar ausência por período, substituição, reagendamento em lote e notificações.

**Complexidade:** Alta  
**Prioridade:** P1

**Evidência:** `src/contexts/identity/internal/lifecycle.ts`, `src/contexts/scheduling/api.ts`.

### 15. Não existe calendário de salas, equipamentos ou recursos

**Categoria:** Agenda / Capacidade  
**Gravidade:** Alta  
**Probabilidade:** Média  
**Impacto financeiro:** Alto em clínicas com recursos compartilhados.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Médio/alto.

**Descrição:** Conflitos são controlados pelo profissional. Unidade não representa sala, equipamento ou recurso individual.

**Como o problema acontece:** Dois profissionais usam o mesmo recurso no mesmo horário.

**Exemplo real:** Dois exames são marcados para a única sala de ultrassom.

**Consequência:** Conflito é descoberto apenas na chegada do paciente.

**Como corrigir:** Modelar recursos reserváveis ou declarar explicitamente a limitação de escopo.

**Complexidade:** Alta  
**Prioridade:** P1

**Evidência:** `src/contexts/scheduling/schema.ts`, `src/contexts/scheduling/slot-resolver.ts`.

### 16. Walk-ins não têm fila, ordem ou capacidade explícita

**Categoria:** Agenda / Consultório  
**Gravidade:** Alta  
**Probabilidade:** Alta  
**Impacto financeiro:** Médio.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Alto.

**Descrição:** Walk-ins são excluídos do bloqueio de conflito e podem ser criados ilimitadamente para o mesmo profissional.

**Como o problema acontece:** Vários pacientes chegam juntos e todos entram como `chegou`.

**Exemplo real:** O consultório recebe oito encaixes sem prioridade, previsão ou ordem verificável.

**Consequência:** Fila informal, conflitos e reclamações.

**Como corrigir:** Criar fila explícita, prioridade, tempo estimado e regra de capacidade de encaixe.

**Complexidade:** Média  
**Prioridade:** P1

**Evidência:** `src/contexts/scheduling/{schema,actions}.ts`.

### 17. Cobrança não trata saldo parcial nem escalonamento completo

**Categoria:** Financeiro / Cobrança  
**Gravidade:** Alta  
**Probabilidade:** Alta  
**Impacto financeiro:** Alto.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Médio.

**Descrição:** Dunning seleciona apenas lançamentos `pendente`, não `parcial`, e encerra a busca após 30 dias.

**Como o problema acontece:** O paciente paga parte da dívida ou permanece inadimplente por mais de 30 dias.

**Exemplo real:** Uma cobrança de R$ 1.000 recebe R$ 400; o saldo não entra na cobrança automática.

**Consequência:** Receita perdida e ausência de fila de cobrança antiga.

**Como corrigir:** Cobrar saldo residual, criar estágios posteriores e encaminhar casos antigos para cobrança manual.

**Complexidade:** Média  
**Prioridade:** P1

**Evidência:** `src/contexts/financial/dunning-candidates.ts`, `src/contexts/ai-agent/proactive-jobs/application/process.ts`.

### 18. Consentimentos são revogados de forma ampla demais

**Categoria:** LGPD / WhatsApp  
**Gravidade:** Alta  
**Probabilidade:** Média  
**Impacto financeiro:** Médio.  
**Impacto operacional:** Médio.  
**Impacto para o paciente:** Alto.

**Descrição:** Revogar um tipo de consentimento marca o registro inteiro como revogado. A revogação não cria automaticamente uma supressão de mensagens; lembretes transacionais continuam permitidos pela política atual.

**Como o problema acontece:** O paciente revoga marketing ou cobrança, mas o sistema trata a versão inteira de consentimento como revogada.

**Exemplo real:** Revogar marketing também bloqueia cobrança; revogar cobrança não impede automaticamente lembretes.

**Consequência:** Comportamento difícil de explicar e risco de desrespeitar preferências.

**Como corrigir:** Versionar consentimento por finalidade/canal e transformar opt-out em suppression quando aplicável.

**Complexidade:** Média  
**Prioridade:** P1

**Evidência:** `src/contexts/patient/{actions,queries,schema}.ts`, `src/contexts/ai-agent/proactive-jobs/application/policy.ts`.

### 19. Falecimento do paciente não possui fluxo operacional completo

**Categoria:** Pacientes / WhatsApp / Clínico  
**Gravidade:** Alta  
**Probabilidade:** Baixa/média  
**Impacto financeiro:** Médio.  
**Impacto operacional:** Médio.  
**Impacto para o paciente:** Crítico.

**Descrição:** Existe campo para óbito, mas não há fluxo completo de registro e os jobs proativos não o usam como bloqueio.

**Como o problema acontece:** O dado chega por importação ou ajuste externo e o telefone permanece ativo.

**Exemplo real:** Lembrete ou cobrança enviado para paciente falecido.

**Consequência:** Dano reputacional grave e possível incidente de privacidade.

**Como corrigir:** Criar fluxo auditado de óbito e bloquear agenda, cobrança e mensagens automaticamente.

**Complexidade:** Baixa/média  
**Prioridade:** P1

**Evidência:** `src/contexts/patient/{schema,types,queries}.ts`.

### 20. Pedidos LGPD podem ficar sem conclusão visível

**Categoria:** LGPD / Atendimento  
**Gravidade:** Alta  
**Probabilidade:** Média  
**Impacto financeiro:** Médio.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Alto.

**Descrição:** Existem estados para pedidos LGPD, porém a entrega por e-mail da exportação está marcada como stub e não há SLA operacional visível.

**Como o problema acontece:** O paciente solicita exportação ou exclusão e o pedido permanece pendente.

**Exemplo real:** A IA registra uma solicitação, mas nenhum responsável é notificado até o vencimento do prazo legal.

**Consequência:** Risco regulatório e perda de confiança.

**Como corrigir:** Definir responsável, SLA, alertas, histórico de tratamento e comunicação de conclusão/falha.

**Complexidade:** Média  
**Prioridade:** P1

**Evidência:** `src/contexts/patient/internal/handlers/lgpd-export-requested.ts`, `src/contexts/patient/schema.ts`.

### 21. Importação histórica e origem de criação são autodeclaradas

**Categoria:** Agenda / Auditoria / Fraude  
**Gravidade:** Alta  
**Probabilidade:** Média  
**Impacto financeiro:** Alto.  
**Impacto operacional:** Médio.  
**Impacto para o paciente:** Baixo/médio.

**Descrição:** O contrato de criação permite `isHistoricalImport` e `createdVia`, sem permissão específica de importação, lote ou justificativa.

**Como o problema acontece:** Um usuário com permissão de agenda envia o mesmo contrato usado para importações.

**Exemplo real:** Uma consulta antiga é inserida sem trilha de importação formal e altera métricas históricas.

**Consequência:** Indicadores, faturamento e auditoria podem ser manipulados.

**Como corrigir:** Separar importação em fluxo próprio, exigir permissão, lote, origem e justificativa.

**Complexidade:** Média  
**Prioridade:** P1

**Evidência:** `src/contexts/scheduling/{types,actions,internal/appointment-core}.ts`.

### 22. Jobs proativos podem disputar execução e não têm fairness por clínica

**Categoria:** Escala / WhatsApp  
**Gravidade:** Alta  
**Probabilidade:** Média em crescimento  
**Impacto financeiro:** Médio.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Médio/alto.

**Descrição:** O job tem tentativas incrementadas, mas continua `pending` durante o envio. Após a reserva, outra execução pode reivindicá-lo. Os scans também têm limite global, sem distribuição justa por clínica.

**Como o problema acontece:** Dois crons rodam próximos ou uma clínica grande monopoliza o lote.

**Exemplo real:** Lembretes de clínicas menores atrasam enquanto uma clínica gera centenas de candidatos.

**Consequência:** Retries e métricas distorcidos, além de mensagens atrasadas.

**Como corrigir:** Usar lease/estado `processing`, timeout de recuperação, cursor e fairness por clínica.

**Complexidade:** Média  
**Prioridade:** P1

**Evidência:** `src/contexts/ai-agent/proactive-jobs/{infra/repository,application/enqueue,application/process}.ts`.

### 23. Relatórios não são confiáveis acima de 500 atendimentos

**Categoria:** Relatórios / Escala / Financeiro  
**Gravidade:** Alta  
**Probabilidade:** Alta em clínicas maiores  
**Impacto financeiro:** Alto.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Indireto.

**Descrição:** O consolidado por profissional limita a leitura aos 500 atendimentos mais recentes. O histórico diário também agrega por data UTC, enquanto a interface usa o fuso da clínica.

**Como o problema acontece:** O período tem mais de 500 atendimentos ou um pagamento ocorre próximo da meia-noite local.

**Exemplo real:** PDF de produtividade omite parte dos atendimentos e atribui um recebimento ao dia errado.

**Consequência:** Decisões gerenciais e repasses podem usar dados incompletos.

**Como corrigir:** Agregar no banco por período e fuso da clínica, sem limite arbitrário de linhas.

**Complexidade:** Média/alta  
**Prioridade:** P1

**Evidência:** `src/app/(app)/(shell)/relatorios/data.ts`, `src/app/api/cron/cash-flow-rollup/route.ts`.

### 24. Evento de ativação da assinatura pode informar plano errado

**Categoria:** Billing SaaS / Planos  
**Gravidade:** Média  
**Probabilidade:** Certa no caminho observado  
**Impacto financeiro:** Médio.  
**Impacto operacional:** Médio.  
**Impacto para o paciente:** Indireto.

**Descrição:** O evento `subscription.activated` publica `planCode: 'solo'` fixo, mesmo quando a assinatura pode ser Clínica ou Pro.

**Como o problema acontece:** Uma clínica Pro é ativada e consumidores downstream recebem “solo”.

**Exemplo real:** Analytics, suporte ou futuros entitlements classificam a clínica no plano errado.

**Consequência:** Métricas, comunicação e decisões comerciais incorretas.

**Como corrigir:** Carregar o código real do plano da assinatura antes de publicar o evento.

**Complexidade:** Baixa  
**Prioridade:** P1

**Evidência:** `src/contexts/billing/internal/subscriptions.ts`.

## P2 — lacunas de produto a decidir

### 25. Não há lista de espera nem recorrência

**Categoria:** Agenda / Retenção  
**Gravidade:** Média/alta  
**Probabilidade:** Alta em psicologia, fisioterapia e tratamentos contínuos  
**Impacto financeiro:** Alto por perda de ocupação e retorno.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Médio.

**Descrição:** Cancelamentos liberam horários sem lista de espera; não há entidade para séries ou consultas recorrentes.

**Como o problema acontece:** A clínica precisa preencher horário ou repetir semanalmente a marcação de modo manual.

**Exemplo real:** Um paciente cancela a sessão de quinta e o horário permanece vazio; outro precisa agendar quatro semanas uma a uma.

**Consequência:** Perda de receita, esforço de recepção e abandono de tratamentos.

**Como corrigir:** Adicionar lista de espera, notificações e recorrência com regras de exceção.

**Complexidade:** Alta  
**Prioridade:** P2

### 26. Não há fluxo de merge de pacientes nem modelo de dependentes

**Categoria:** Pacientes / Operação  
**Gravidade:** Alta  
**Probabilidade:** Média/alta  
**Impacto financeiro:** Médio.  
**Impacto operacional:** Alto.  
**Impacto para o paciente:** Alto.

**Descrição:** Há unicidade por CPF e e-mail, mas não há merge de cadastros, responsável legal, dependentes ou fluxo de menores.

**Como o problema acontece:** CPF é digitado errado, o paciente muda de telefone, ou uma família usa um número compartilhado.

**Exemplo real:** Duas fichas do mesmo paciente dividem agenda, financeiro e histórico clínico.

**Consequência:** Histórico fragmentado, cobrança no cadastro errado e risco clínico.

**Como corrigir:** Criar merge auditado, responsável/dependente e regras específicas para menor de idade.

**Complexidade:** Alta  
**Prioridade:** P2

## Sequência recomendada para o plano de execução

1. **Fase A — controles P0:** confirmação de IA, identidade por telefone, ledger de pagamentos, reembolso e validações cross-tenant.
2. **Fase B — operação diária:** recuperação de agenda, ausência de profissional, entrega WhatsApp, handoff e cobrança parcial.
3. **Fase C — LGPD e escala:** consentimento granular, óbito, SLA de pedidos LGPD, jobs proativos e relatórios.
4. **Fase D — expansão de produto:** recursos/salas, lista de espera, recorrência, dependentes e merge de pacientes.

## Premissas a validar antes de implementar

- “Cobrança por IA” na comunicação comercial significa apenas lembrete/consulta ou também PIX/link/baixa?
- Quais especialidades fazem parte do ICP imediato: psicologia, fisioterapia, pediatria, estética, diagnóstico por imagem?
- A clínica pode corrigir um atendimento finalizado ou essa correção deve exigir aprovação de gestor?
- Quais mensagens são consideradas transacionais após um opt-out geral do WhatsApp?
- Como deve funcionar reembolso: integral, parcial, por qual meio e com qual aprovação?

## Resultado final de validação

| Verificação | Resultado |
| --- | --- |
| Testes automáticos (`pnpm test`) | **Aprovado:** 126 arquivos e 1.056 testes. |
| Lint (`pnpm lint`) | **Aprovado:** zero erros e zero avisos. |
| Type-check (`pnpm typecheck`) | **Aprovado.** |
| Build de produção (`pnpm build`) | **Aprovado:** Next.js 15.5.21 compilou, validou tipos e gerou as 10 páginas estáticas. |
| Segurança das migrations (`pnpm check:migrations`) | **Aprovado:** nenhuma operação destrutiva nova não autorizada. |
| Fronteiras de banco (`pnpm arch:db-check`) | **Aprovado:** 743 arquivos verificados, zero achados. |
| Dependências circulares (`pnpm arch:check`) | **Aprovado:** nenhum ciclo encontrado. |
| Formatação global (`pnpm format:check`) | **Baseline não verde:** 624 arquivos preexistentes ou fora deste escopo não seguem o formatador. As verificações direcionadas feitas durante as ondas e nos arquivos do fechamento passaram; não foi feita uma reescrita global para não misturar mudanças alheias. |
| Aplicação das migrations em desenvolvimento (`pnpm db:migrate:dev`) | **Aplicada em dev pelo responsável:** a primeira tentativa falhou e foi revertida na `0068`; após a correção do `55P04`, o comando foi repetido no Supabase de desenvolvimento. Não foi reaplicado nesta execução. |

O código e as migrations estão validados estaticamente, mas os fluxos que dependem de Meta, e-mail ou observação operacional ainda exigem os testes manuais listados acima. Não houve deploy nem alteração em produção nesta remediação.

### Correção posterior — PostgreSQL `55P04` na migration 0068

O `drizzle-orm 0.36.4` executa todas as migrations pendentes dentro de uma única transação. O PostgreSQL aceita `ALTER TYPE ... ADD VALUE` nesse contexto, mas não permite converter o novo literal para o enum antes do commit. A migration `0068_proactive_job_leases.sql` passou a:

- manter a adição do enum como operação aditiva;
- comparar `status::text` na nova constraint, sem converter `processing` para o enum durante a migration;
- usar índice normal incluindo a coluna `status`, sem predicado que converta o novo literal;
- preservar a modelagem tipada do enum depois do commit.

O teste `proactive-lease.test.ts` reproduz a condição estrutural que causou a falha. Baseline: 3 testes aprovados; teste novo falhou antes da correção; depois: 4 testes aprovados. A suíte integral, lint, type-check, segurança de migrations e build foram repetidos após o ajuste.

### Correção posterior — timeout e auto-bloqueio do outbox

O pool dedicado do worker havia sido reduzido para uma conexão, mas a decisão de manter o advisory lock ainda consultava `OUTBOX_DB_POOL_SIZE`, cujo padrão era cinco. O cron abria uma transação para segurar o lock e, dentro dela, tentava obter uma segunda conexão do mesmo pool para processar o lote. Como o pool real tinha apenas uma conexão, a própria execução aguardava indefinidamente até o timeout de 60 segundos da Vercel. Isso explica o `504 FUNCTION_INVOCATION_TIMEOUT`, a ausência de chamadas para APIs externas e a degradação dos health checks do outbox.

A correção mantém o pool do worker fixo em duas conexões: uma para o advisory lock e outra para o processamento. O worker usa a mesma constante exportada pela configuração do banco para decidir o modo de lock, eliminando divergência entre configuração declarada e capacidade real. A variável `OUTBOX_DB_POOL_SIZE` foi removida da validação de ambiente e do exemplo de configuração para evitar uma falsa possibilidade de ajuste que não correspondia ao pool efetivo.

O teste `worker-pool.test.ts` fixa esse contrato. Ele foi adicionado antes da implementação e falhou no estado regressivo; após a correção, passou. Também passaram os testes focados (3 arquivos / 20 testes), a suíte completa (124 arquivos / 1.050 testes), lint, type-check, fronteiras de banco, dependências circulares, verificação de whitespace do diff e build de produção.

#### Testes manuais após o deploy

1. Acionar `/api/cron/outbox` pela integração autorizada e confirmar resposta antes de 60 segundos, sem `FUNCTION_INVOCATION_TIMEOUT`.
2. Consultar `/api/health/outbox?strict=1`. Um `503` inicial pode refletir backlog ou alarmes antigos; confirmar que o JSON é retornado rapidamente e que a fila diminui nas execuções seguintes.
3. Consultar `/api/health?strict=1` e confirmar que o componente `outbox` volta a `ok` depois de processar o backlog.
4. Entrar como administrador e validar que dashboard e abas carregam sem `Connection closed` ou loading infinito.
5. Verificar nos logs que não reaparecem `EMAXCONNSESSION` e que as URLs de runtime, em Preview e Production, usam o transaction pooler na porta `6543`; a porta `5432` deve permanecer reservada a migrations e backups.

Esta correção ainda não foi implantada nem validada contra os endpoints remotos nesta execução.

### Correção posterior — timeout de 300 segundos no console admin

Os logs da Preview mostraram MFA concluído (`POST /login/mfa` com `303`), seguido por `GET /admin` e `GET /admin/clinicas` presos até o timeout de 300 segundos. No mesmo instante, o navegador iniciou todas as oito rotas do menu administrativo (`/admin`, clínicas, billing, conversas, métricas, auditoria, saúde e configuração). A causa desse burst era o prefetch automático dos oito `next/link` visíveis no `AdminNav`: cada destino é uma página dinâmica com autenticação e consultas próprias ao banco.

O `SideNavLink` passou a aceitar a opção tipada `prefetch`, preservando o comportamento automático nos demais shells. Somente o `AdminNav` envia `prefetch={false}`, de modo que cada página administrativa é carregada quando o operador efetivamente clica nela. O teste `admin-nav.test.tsx` renderiza o menu completo e prova que os oito links chegam ao Next com prefetch desativado. O teste falhou antes da implementação (`enabled`) e passou depois.

Como defesa adicional, a validação de ambiente agora rejeita, em deployments, `DATABASE_URL` ou `DATABASE_URL_RUNTIME` do Supabase usando o Session Pooler na porta `5432`. O aplicativo serverless deve usar o Transaction Pooler `6543`; `DATABASE_URL_PROD` continua fora desse guard porque migrations e backups usam `5432` deliberadamente. Dois testes falharam antes do guard e passaram depois, cobrindo as duas URLs de runtime; um terceiro confirma que `6543` é aceito.

O deployment analisado ainda apontava para o commit remoto `f02432b`; as correções do pool do outbox, do prefetch e do guard de porta estavam apenas no working tree local durante o diagnóstico. Portanto, o timeout remoto observado não constitui teste das correções atuais.

Após esta correção passaram: testes focados (4 arquivos / 24 testes), suíte completa (126 arquivos / 1.056 testes), lint, type-check, fronteiras de banco (743 arquivos), dependências circulares e build de produção do Next.js 15.5.21.

#### Teste manual recomendado na Preview

1. Confirmar na Vercel, sem copiar senhas para logs, que `DATABASE_URL` e `DATABASE_URL_RUNTIME` da Preview usam o projeto dev e a porta `6543`.
2. Publicar a branch `preview/teste-nova-feature` com as correções e usar a URL do novo deployment, não o deployment `dpl_DBSeGzmB39naQNcL2G4qg4NgLJPM`.
3. Entrar como `super_admin`, concluir o MFA e confirmar que apenas `/admin` é carregado inicialmente; o menu não deve iniciar as outras sete páginas em paralelo.
4. Abrir `/admin/clinicas`, `/admin/saude` e `/admin/config` por clique e confirmar resposta sem timeout de 300 segundos.
5. Validar `/api/cron/outbox`, `/api/health/outbox?strict=1` e `/api/health?strict=1` conforme a seção anterior.
6. Somente depois desse smoke verde: aplicar a migration no banco de produção, fazer merge na `main` e repetir um smoke curto em produção.

Os avisos do console referentes a `vercel.live` não causavam o loading: o header é `Content-Security-Policy-Report-Only`, portanto o navegador apenas registrava as violações. Mesmo assim, a política foi separada por ambiente para manter o console da Preview limpo sem ampliar Production. O builder `buildContentSecurityPolicy` permite `https://vercel.live` em `script-src` e `frame-src` somente quando `VERCEL_ENV=preview`; Production mantém `frame-src 'self'` e não contém essa origem. O teste dedicado foi criado antes do builder e falhou pela ausência da política; depois, os dois cenários passaram e a suíte/build foram repetidos.

Nenhuma migration de produção nem deploy foi executado nesta correção.
