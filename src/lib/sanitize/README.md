# src/lib/sanitize

Shared payload sanitization. Used by audit, super_admin_actions, observability/metrics, and idempotency response capping.

## Modules

- [keys.ts](./keys.ts) — `SENSITIVE_KEYS` set (case-insensitive). Values at matching keys become `[REDACTED]`.
- [patterns.ts](./patterns.ts) — `VALUE_PATTERNS` regex list. Catches Bearer/JWT/sk_/DSN in string values, including under non-sensitive keys.
- [redact.ts](./redact.ts) — `sanitizePayload(value)`. Recursive key + value level.
- [cap.ts](./cap.ts) — `capJsonSize(value, maxBytes=64KB)`. Replaces oversized responses with envelope `{ truncated, originalBytes, originalHash, note }`.

## Why shared

`audit.log`, `audit.super-admin`, `observability.metrics` all need the same redaction logic. If each had its own copy, the SENSITIVE_KEYS list would drift in 6 months. Single source.

## Adding a new pattern

1. Pattern in [patterns.ts](./patterns.ts) — conservative; false negatives preferred over false positives in forensic data.
2. Run `pnpm tsx scripts/smoke-c4.ts` test 4.6.11 to confirm matching.
3. PR description names the new pattern.

## NOT in scope

- JSON-safety validation (Date/BigInt/NaN/Infinity rejection) — lives in `src/lib/idempotency/json-safe.ts` (called by callers that own the payload, not by sanitize).
- Encryption at rest — that's a DB-level concern (Supabase manages).
