# src/lib/observability

Structured logging for production debugging. MVP scope: one function, `metrics.emit(event, fields)`, that writes a JSON line to stdout.

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

## Why structured (JSON) not free-form

- One field shape across all events → filterable in any log pipeline.
- `kind: 'metric'` tag separates these lines from `console.warn` debug output.
- Sanitized through `sanitizePayload` — no Bearer/JWT/sk_/DSN leakage.

## NOT in scope (yet)

- Histograms, gauges, percentiles → C16, real metrics SDK.
- OpenTelemetry traces → C16.
- Alerting rules → operator-side (PagerDuty / Better Stack / similar).
