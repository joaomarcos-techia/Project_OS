# Busca de logs

## Status

Reference — consultas versionadas; criação no provedor é manual.

## Regras

- pesquise pelo `requestId`, `traceId`, `clinicId` e ids técnicos; nunca por CPF, telefone, e-mail ou conteúdo clínico;
- correlacione Vercel/stdout, Sentry e Better Stack; ausência em um painel não prova ausência do evento;
- ajuste janela/timezone antes de concluir.

## Saved searches válidas

```text
message.event:"ai.provider.error"
message.event:"ai_agent.mode.read_failed"
message.event:"worker.tick"
message.event:"outbox.failed"
message.event:"outbox.retry"
message.event:"outbox.lost_race"
message.event:"outbox.skipped_no_handler"
message.event:"outbox.skipped_missing_clinic"
message.event:"messaging.whatsapp.template_category_drift"
message.event:"proactive.job.failed"
message.event:"proactive.job.retried"
message.event:"proactive.job.cancelled"
message.event:"messaging.whatsapp.messaging_health_changed"
message.event:"messaging.whatsapp.messaging_health_blocked"
message.event:"premium.denied"
message.event:"insurance.xml.validation_failed"
message.event:"insurance.file.missing"
message.event:"insurance.file.orphan"
message.event:"insurance.billing_gap.processing_failed"
message.event:"insurance.payout.ensure_failed"
message.event:"insurance.authorization.expired"
message.event:"insurance.reconcile.run"
message.event:"insurance.maintenance.run"
message.event:"insurance.maintenance.daily_summary"
message.event:"insurance.maintenance.clinic_failed"
message.event:"insurance.maintenance.error"
```

**Convênios (TISS, P12.6).** Nenhuma destas linhas leva paciente, carteirinha ou conteúdo de guia:
- `premium.denied`: recusa comercial (D24). Campos `feature`, `reason` (`trial`, `subscription_inactive`,
  `clinic_suspended`…) e `source` (`service` ou `database`). Uma linha por recusa; nova tentativa é nova linha. Muitas
  de uma clínica ativa indicam assinatura vencida ou tela oferecendo o que o servidor recusa. É telemetria, não
  auditoria;
- `insurance.xml.validation_failed`: um XML (lote, solicitação, recurso) reprovou no XSD oficial antes de sair. A guia
  ou o lote não foi exportado. Repetido para a mesma operadora sugere cadastro ou terminologia;
- `insurance.file.missing`: o banco aponta um arquivo TISS que o armazenamento privado não devolve. Leitura recusada
  e auditada. **Investigar sempre**;
- `insurance.file.orphan`: um objeto gravado não foi removido depois de uma transação desfeita (compensação falhou).
  Não expõe dado, mas ocupa armazenamento;
- `insurance.billing_gap.processing_failed`: o atendimento de convênio concluído não virou guia por falha técnica.
  A pendência guarda tentativas e próxima tentativa (reconcile do `financial-reconcile`);
- `insurance.payout.ensure_failed`: o repasse do profissional não foi criado na hora; a sincronização da tela o cria
  depois. A guia não é afetada;
- `insurance.authorization.expired`: autorizações cuja senha venceu foram marcadas "vencidas" (campo `count`);
- `insurance.reconcile.run`: resumo de cada volta do reconcile de convênio (candidatos, processados, guia pronta,
  pendência aberta, ocupados, falhas, adiados por tempo). `failed` > 0 em voltas seguidas é falha persistente;
- `insurance.maintenance.run` (P6.6/P12.6): cada volta da manutenção de Convênios no fim do `financial-reconcile`
  (clínicas, processadas, autorizações vencidas, falhas, adiadas por tempo, se houve resumo). `deferred` > 0 sempre
  indica o cron sem orçamento; a próxima volta de 15 min retoma;
- `insurance.maintenance.daily_summary`: o resumo do dia (uma vez, na volta das 09:00–09:14 UTC), só contagens:
  senhas vencendo em até 3 dias, sessões acabando, pedidos parados na operadora há mais de 3 dias, revisões de repasse
  abertas (0163), cancelamentos aguardando o recibo da operadora (0165) e clínicas com algum alerta. É o alerta
  operacional diário: nenhum destinatário externo recebe nada, e o detalhe por clínica está na fila de autorizações e
  nas telas de repasses e guias;
- `insurance.maintenance.clinic_failed`: a manutenção de UMA clínica falhou (só o tipo do erro); as outras seguiram.
  Repetido em voltas seguidas = investigar;
- `insurance.maintenance.error`: a manutenção inteira falhou antes de percorrer as clínicas (ex.: leitura da lista).
  O resto do `financial-reconcile` já tinha terminado.

`messaging_health_changed` (ADR-063) é a Meta mudando o que a clínica pode
**iniciar** — lembrete, link do sinal, cobrança, oferta de vaga. `to:"blocked"`
com `codes` contendo `141006` é a conta sem forma de pagamento: todo template
será aceito e recusado depois com 131042, enquanto as respostas na janela de 24 h
continuam chegando. `141010` é negócio sem verificação (limite de volume). O
`trigger` diz quem leu: `connect`, `settings`, `daily` ou `delivery_failure`.
`messaging_health_blocked` é o resumo da varredura diária com ao menos uma conta
bloqueada. Quem resolve é a clínica, na Meta; a tela de WhatsApp e o painel já
mostram a ação.

`template_category_drift` (D104) aparece quando a Meta reclassificou um template
aprovado — tipicamente `UTILITY` → `MARKETING`, com a justificativa "não atendeu
às nossas diretrizes de utilidade". **É silencioso do lado do envio:** a API
continua respondendo `accepted` e o job termina `sent`, mas passa a valer o
opt-in de marketing, que o Qoro não enxerga — a mensagem pode nunca chegar.
Editar não muda a categoria; a correção é criar outro template, com nome novo.
O log traz `nome:esperada->atual`.

`proactive.job.failed` com `stage:"delivery"` (EC-32) é a Meta recusando uma
mensagem proativa **depois** de aceitá-la. Com `stage:"send"`, a recusa veio na
resposta do próprio envio. Nos dois casos:
- o `reason` traz o código da Meta (`meta_131042`, por exemplo, indica a WABA sem
  moeda ou forma de pagamento no Billing);
- o paciente não recebeu a mensagem;
- o `why` diz por que ela não foi reenviada (ADR-064):
  - `not_retryable`: código definitivo;
  - `attempts_exhausted`: tentativas esgotadas;
  - `past_deadline`: o prazo do tipo já passou (ADR-065), por exemplo o hold do
    sinal ou o dia da consulta. Também aparece sem `stage`, quando um reenvio é
    reivindicado depois do prazo;
  - `invalid_payload`: o payload guardado do job não valida mais. Só aparece no
    callback.

`reason:"meta_unknown"` é timeout: a mensagem pode ter chegado e nunca é
reenviada. Sem `stage` nem `why`, a falha não veio de uma recusa da Meta:
template não configurado, número desconectado, payload inválido ou tentativas
esgotadas sem resposta (`meta_pending`, `meta_error`).

`proactive.job.retried` com `resend:true` é recusa por código passageiro (131000,
131016, 130429…): o job volta à fila com chave nova e reenvia de verdade. Sem
`resend`, é o backoff com a mesma chave (`meta_pending`, `meta_error`).

`proactive.job.cancelled` com `reason` começando por `expired_` (ADR-065) é um job
que perdeu a janela útil na fila e foi cancelado em vez de sair atrasado. Exemplos:
um lembrete que já não seria "amanhã", ou um link de sinal depois do hold. Vários
de uma vez indicam fila parada: cron fora do ar ou conta do WhatsApp bloqueada.
Os outros motivos de cancelamento (`suppressed`, `no_consent`, `already_paid`,
`charge_not_payable`…) são decisões deliberadas, não atraso.

Consultas acima são verificadas contra strings emitidas no código por `pnpm check:observability`. Acrescentar evento inexistente cria falsa cobertura e falha o gate.

## Triagem

1. delimite commit/deploy, rota, janela e request id;
2. localize erro original e `cause`, sem expor payload;
3. confira estado persistido (outbox/invoice/outbound/heartbeat);
4. identifique se provider foi chamado e se houve compensação;
5. reprocessamento só após confirmar idempotência e estado externo.

## Falha de leitura do modo da IA

`ai_agent.mode.read_failed` informa somente `reason: unavailable|invalid_value`; nunca valor da configuração, prompt, paciente ou erro SQL. O handler usa fallback operacional sem provider. Há cache por instância de até 30 segundos; depois desse TTL, falha de banco não pode assumir modo normal. Alertar a operação ao detectar esse evento; conferir banco/configuração e `ai.provider.error` (402/429), sem remover credencial para desligar o serviço. A saved search versionada não significa que um destinatário de alerta já foi configurado.
