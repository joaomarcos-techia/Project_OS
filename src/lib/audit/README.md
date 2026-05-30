# lib/audit

Audit log síncrono na mesma TX da operação. NUNCA assíncrono (C4 contract).

## API pública

- [log.ts](./log.ts) — `logAudit(tx, args)` é o **único** ponto de gravação em `audit_events`. Sanitiza `before`/`after` via `sanitizePayload`.
- [mutation.ts](./mutation.ts) — `auditedMutation(opts, fn)` é wrapper de mutação + audit (sem idempotency). **Raro** — para C5+ Server Actions prefira `idempotentMutation`.
- [super-admin.ts](./super-admin.ts) — `superAdminAction(opts, fn)` é o wrapper de ações cross-tenant do super_admin. Loga em `super_admin_actions` com policy `is_super_admin()`.
- [request-context.ts](./request-context.ts) — `buildRequestContext(headers)` extrai IP/UA/x-request-id no boundary.
- [types.ts](./types.ts) — `RequestContext` interface.

## Contratos (ADR-011)

- **Atômico**: logAudit usa o `tx` do caller. Falha no INSERT rola a TX inteira — política "no audit, no op".
- **Sanitizado**: SENSITIVE_KEYS viram `[REDACTED]`; strings com Bearer/JWT/sk_/DSN passam por value-level redaction. Mesma lib que metrics.emit usa.
- **Append-only**: RLS permite INSERT+SELECT; sem policy de UPDATE/DELETE; FORCE bloqueia.
- **Particionado**: audit_events PARTITION BY RANGE (created_at), 12 partitions mensais (2026-05 → 2027-04) + default catch-all.
- **Retention**: 90d hot / 1y warm / archive-or-delete. DETACH PARTITION manual no MVP (runbook c4-validation), automation em C16.

## auditableAction REMOVIDO em C4

O placeholder de C3 (`auditableAction` em `src/lib/auth/tenant-context.ts`) foi removido. Use:
- `idempotentMutation` — default para Server Actions mutativas (C5+).
- `auditedMutation` — raro: mutação sem idempotency.
- `superAdminAction` — ações cross-tenant.

ESLint bloqueia reintrodução do nome `auditableAction`.
