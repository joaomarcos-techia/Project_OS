# Busca de logs

## Status

Reference — consultas versionadas; criação no provedor é manual.

## Regras

- pesquise pelo `requestId`, `traceId`, `clinicId` e ids técnicos; nunca por CPF, telefone, e-mail ou conteúdo clínico;
- correlacione Vercel/stdout, Sentry e Better Stack; ausência em um painel não prova ausência do evento;
- ajuste janela/timezone antes de concluir.

## Saved searches válidas

```text
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
```

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
