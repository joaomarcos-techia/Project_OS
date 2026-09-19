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
```

`template_category_drift` (D104) aparece quando a Meta reclassificou um template
aprovado — tipicamente `UTILITY` → `MARKETING`, com a justificativa "não atendeu
às nossas diretrizes de utilidade". **É silencioso do lado do envio:** a API
continua respondendo `accepted` e o job termina `sent`, mas passa a valer o
opt-in de marketing, que o Qoro não enxerga — a mensagem pode nunca chegar.
Editar não muda a categoria; a correção é criar outro template, com nome novo.
O log traz `nome:esperada->atual`.

Consultas acima são verificadas contra strings emitidas no código por `pnpm check:observability`. Acrescentar evento inexistente cria falsa cobertura e falha o gate.

## Triagem

1. delimite commit/deploy, rota, janela e request id;
2. localize erro original e `cause`, sem expor payload;
3. confira estado persistido (outbox/invoice/outbound/heartbeat);
4. identifique se provider foi chamado e se houve compensação;
5. reprocessamento só após confirmar idempotência e estado externo.
