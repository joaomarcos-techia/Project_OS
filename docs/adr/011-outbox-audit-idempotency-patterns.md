# ADR-011 — Outbox, audit e idempotência

## Status

Accepted — Reference. Fluxo canônico em [backend/http-jobs-outbox.md](../backend/http-jobs-outbox.md).

## Decision

- Mutation e outbox são persistidas na mesma transação.
- Evento tem schema Zod, payload JSON seguro, `clinicId`, versão/nome estável e chave idempotente.
- Worker é at-least-once; handler precisa deduplicar por `eventId` ou identidade persistida.
- Provider I/O fica fora da tx de negócio e usa reserva/finalização ou mecanismo equivalente.
- Header de idempotência externo só é enviado quando o provider documenta suporte. Meta usa estado local/provider message id; não se presume suporte a `Idempotency-Key`.
- Audit registra ação sanitizada; outbox entrega trabalho. Uma tabela não substitui a outra.

## Retry

Imediato, 30 s, 5 min, 30 min e 6 h; depois `failed` com replay manual. Poison pill falha terminalmente. Evento catalogado sem handler pode ser `PRODUCER_AHEAD`/`skipped`.
