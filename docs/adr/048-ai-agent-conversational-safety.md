# ADR-048 — Segurança conversacional

## Status

Accepted — Reference. Fonte canônica: [ai/agent.md](../ai/agent.md).

## Decision

- Pedido clínico recebe fallback fixo/handoff; o modelo não diagnostica nem prescreve.
- Agendar, cancelar e reagendar usam prepare e confirmação explícita em turno posterior.
- Uma mensagem executa no máximo uma mutation.
- Confirmação exige afirmação inequívoca ligada à pending action ativa.
- Data é resolvida server-side com timezone/instante da clínica.
- Chave de idempotência inclui episódio para não reutilizar sucesso antigo após cancelar/repetir.
- Rajadas podem ser coalescidas; handoff é rechecado antes de persistir/responder.
- Contato desconhecido é cadastrado e retoma a intenção preservada.

Mudança em prompt, guard, léxico ou tool exige testes adversariais e de jornada correspondentes.
