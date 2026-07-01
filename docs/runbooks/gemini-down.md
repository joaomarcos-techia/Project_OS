# Runbook — Gemini (IA) indisponível

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice de runbooks](./README.md) · [índice mestre](../README.md).


> C16 FASE 9. SEV2 (degrada, não derruba). O AI Agent roda no worker do outbox;
> falha de IA não afeta o resto do app.

## Sintoma
- `GET /api/health` → `gemini: degraded`.
- Better Stack: `event:"ai.provider.error"` ou timeouts; SLO de IA (`< 2%` erro) estourado.
- WhatsApp não recebe respostas automáticas.

## Como o sistema já se protege
- Timeout por chamada (`AI_HTTP_TIMEOUT_MS`, default 15s) → `AIProviderUnreachableError` (retryável) vs `AIProviderError` 4xx (definitivo).
- Circuit breaker in-memory no provider + circuit do outbox por event_type (pausa o tipo tóxico).
- Turnos da IA são saga idempotente: ao voltar, reprocessam sem duplicar.

## Diagnóstico
1. É a key ou o provedor? Cheque o status do Google AI / cota da API key.
2. Better Stack: o erro é 4xx (key inválida/cota) ou timeout/5xx (provedor)?
3. `GET /api/health/outbox` → o event_type da IA está em `failures_by_type` / pausado pelo circuit?

## Resolução
- **Key inválida/expirada/cota**: rotacione `GEMINI_API_KEY` (ver [secret-rotation.md](./secret-rotation.md)) e redeploy. A fila reprocessa os turnos pendentes.
- **Provedor instável**: aguarde; o circuit reabre sozinho após o cooldown e o outbox drena. Não force replay em loop.
- **Precisa parar de tentar** (provedor em outage longo): o circuit já pausa o event_type; opcionalmente desabilite o gatilho proativo até estabilizar.

## Comunicação
- Impacto: respostas automáticas do WhatsApp atrasadas. Atendimento humano segue normal.
- Quando voltar: confirme `gemini: ok` e que a fila de turnos drenou.
