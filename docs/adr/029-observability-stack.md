# ADR-029 — Observability stack (Sentry + logger in-house + Better Stack + error envelope)

**Status:** accepted
**Date:** 2026-06-29

## Context

Até a C16 o sistema tinha só `metrics.emit` (JSON em stdout) e dois healthchecks
operacionais. Faltava: captura central de exceções, logger por nível, formato único
de erro para o frontend/correlação, e um healthcheck que olhasse as dependências
externas. Sem isso, operar o primeiro cliente pagante dependeria de descoberta manual
de problemas. A C16 (camada de produção) precisa fechar essa lacuna **sem** reescrever
o que já é production-grade (correlation id, audit, sanitização).

## Decision

Adotar uma stack de observabilidade em camadas, reusando o que já existe:

- **Erros → Sentry** (`@sentry/nextjs`, client/server/edge via `instrumentation.ts` +
  `sentry.*.config.ts`). `sendDefaultPii: false` + `beforeSend` reusando `sanitizePayload`
  (nunca PII/segredo/dado clínico). Sem Session Replay (telas clínicas). `tracesSampleRate`
  0.1. Source maps via `withSentryConfig` (token em `.env.sentry-build-plugin`, gitignored).
- **Logs → logger fino in-house** (`src/lib/observability/logger.ts`): níveis gated por
  `LOG_LEVEL`, JSON `kind:'log'` em stdout, reusando o **mesmo** `sanitizeFields` do
  `metrics.emit`. **Sem Pino** — evita duplicar o pipeline e bundling serverless.
- **Busca/agregação → Better Stack** via Vercel Log Drain (logs já são JSON). Saved
  searches + uptime documentados em `docs/runbooks/log-search.md`.
- **Envelope de erro único** (`src/lib/http/error-response.ts`):
  `{ error, code, message, trace_id, timestamp }`. Erros de domínio (`code`+`httpStatus`)
  mapeiam 1:1; o resto vira 500 genérico sem vazar mensagem. `trace_id` = `request_id`
  (carimbado no middleware), correlacionando resposta ↔ logs ↔ audit ↔ Sentry.
- **Healthcheck unificado** (`/api/health`): `ok|degraded|down` agregando db + gemini +
  meta + asaas + fila outbox (com SLIs de fila). Mesma auth dos health existentes.
- **SLOs** formais em `docs/c16/slo.md` definem os thresholds de alerta.

## Consequences

- Toda exceção tem destino (Sentry) e todo log é pesquisável (Better Stack) com o mesmo
  `request_id`. MTTR cai: do alerta ao `trace_id` à linha do log em um salto.
- `metrics.emit` e `logger` compartilham `sanitize-fields.ts` — uma fonte de redação de PII.
- Novas rotas/handlers devem retornar via `toErrorResponse`/envelope e logar via `logger`.
- Custo: assinatura Sentry + Better Stack; amostragem (traces 0.1, sem replay) controla volume.
- Saída: o logger é trocável por um SDK sem mexer nos call sites; Sentry/Better Stack são
  plugáveis (DSN/drain por env/dashboard).

## Alternatives

- **Pino como logger:** rejeitado — duplica o emissor JSON+sanitize já existente e adiciona
  atrito de bundling no serverless da Vercel.
- **OpenTelemetry/APM completo agora:** adiado — overkill para o estágio; Sentry já dá
  tracing básico. Pode ser adicionado depois sem quebrar os call sites.
- **Session Replay do Sentry:** rejeitado por padrão — risco LGPD de gravar telas com dado
  de paciente. Reavaliar só com masking revisado.
- **Mandar logs também pro Sentry (`enableLogs`):** desligado — duplicaria o que vai pro
  Better Stack e aumentaria superfície de vazamento.

## References

- Plano C16 (Onda 1/2), `docs/c16/c16-inventory.md`, `docs/c16/slo.md`
- `docs/runbooks/log-search.md`, `docs/runbooks/alert-tuning.md`
- ADR-011 (sanitização em audit), ADR-007 (RLS) — reaproveitados aqui
