# src/lib/observability

Structured logging for production debugging. MVP scope: one function, `metrics.emit(event, fields)`, that writes a JSON line to stdout.

## Primitivas (ADR-045)

| Módulo | Papel |
|---|---|
| `context.ts` | Correlação **ambiente** (AsyncLocalStorage). A fronteira abre um escopo com `runWithContext`; todo `metrics.emit`/`logger` dentro dele herda `request_id`/`clinicId`/`userId`/`flow` sem que o call-site mude. |
| `capture.ts` | `captureBackgroundError` — leva exceções de background ao Sentry **com stack** (o stream de métricas descarta stack por design). |
| `sanitize-fields.ts` | 2ª camada de redação (denylist) compartilhada por logs e métricas. |
| `sentry-scrub.ts` | `beforeSend` do Sentry. **Leia os limites no docblock** — não cobre `tags`. |

**Duas invariantes que não se negocia:**

1. **`ObsContext` e o `ctx` do `capture` são allowlists TIPADAS FECHADAS.** Conteúdo clínico não compila. A sanitização do repo é *denylist* e não segura prosa clínica — foi assim que 32 `audit_events` guardaram SOAP em claro (A1/ADR-044). Guard enforçado por `@ts-expect-error` nos testes: afrouxar o tipo quebra o `typecheck` no CI.
2. **`captureBackgroundError` nunca faz throw.** Telemetria não altera o fluxo de quem chama.

Contexto só funciona em runtime **Node** (Edge não suporta `AsyncLocalStorage`); o middleware apenas carimba `x-request-id` no header.

## Catalog of events emitted in C4

| Event | Source | Fields |
|---|---|---|
| `outbox.enqueued` | publishEvent | clinicId, eventType |
| `outbox.processed` | worker TX3 | clinicId, eventType, attempts |
| `outbox.retry` | worker TX3 | clinicId, eventType, attempts, errorCode, errorMessage |
| `outbox.failed` | worker TX3 (cap) | clinicId, eventType, attempts, errorCode, errorMessage |
| `outbox.stuck.reclaimed` | janitor | count |
| `outbox.circuit.opened` | circuit | eventTypes, pausedCount, observationWindow, cooldown |
| `worker.tick` | worker | processed, failed, skipped, stuck_reclaimed, circuit_paused, duration_ms |
| `worker.error` | cron route catch | error |
| `idempotency.hit` | idempotentMutation | key |
| `idempotency.conflict` | idempotentMutation | key |
| `idempotency.in_flight` | idempotentMutation | key |
| `idempotency.lock_timeout` | idempotentMutation | key |
| `idempotency.completed` | idempotentMutation | key, action |
| `audit.written` | logAudit | action, resourceType |
| `super_admin.action` | superAdminAction | action, targetClinicId |

## Eventos acrescentados na remediação de monitoramento (2026-07-18)

| Event | Source | Achado |
|---|---|---|
| `cron.heartbeat.write_failed` | `recordHeartbeat` catch | M2 — o sinal de liveness falhava em silêncio |
| `auth.login.failed` | `login/actions.ts` | A1 — brute-force era invisível |
| `auth.mfa.failed` | `login/mfa/actions.ts` | A1 |
| `auth.ratelimit.tripped` | `rate-limit` (login/mfa) | A1/M3 — só havia `degraded` (fail-open) |
| `auth.session.revoked` | `authenticate()` (`tenant-context.ts`) | A1/N3 — sítio corrigido (ADR-037 tirou do middleware) |
| `auth.session.locked` | `authenticate()` (`tenant-context.ts`) e `lockSessionAction` | S2 / requisito 83 da ANS — sessão do perfil TISS bloqueada por inatividade (`reason`: `idle`, `no_activity_record`, `client_idle`); só com `TISS_SECURITY_PROFILE_ENFORCE=true` |
| `checkout.activation_failed` | `join/[token]/actions.ts` | M1 — era `console.error` |
| `db.pool.saturation` | `pool-stats.ts` | A4/E4 — golden signal ausente |
| `ai.provider.error` | `gemini.ts` | N1 — a saved-search citava; nada emitia |
| `cron.audit_partitions.degraded` | `audit-partitions` (auditoria de banco) | A7/N8 — **não vai ao Sentry** (ADR-043 §4) |

⚠️ Mudança de payload: `retention.run` foi de 3 para **8 chaves** (ADR-043).

## Why structured (JSON) not free-form

- One field shape across all events → filterable in any log pipeline.
- `kind: 'metric'` tag separates these lines from `console.warn` debug output.
- Sanitized through `sanitizePayload` — no Bearer/JWT/sk_/DSN leakage.

## NOT in scope (yet)

- Histograms, gauges, percentiles → C16, real metrics SDK.
- OpenTelemetry traces → C16.
- Alerting rules → operator-side (PagerDuty / Better Stack / similar).
