# C5 — Patient Context — Validation Runbook

Validates the C5 layer (PlanoAção §5.6 tests + §5.7 checklist). Split into
**automated** (smoke + static checks) and **manual** (need a running app session
or external setup: Secret Manager / Storage bucket).

## 0. One-time setup

### 0.1 Crypto secrets (dev/test — env backend)
Generate a 32-byte master key and a 16-byte lookup salt, add to `.env.local`:

```bash
# 32-byte AES master key, base64
openssl rand -base64 32   # -> CRYPTO_MASTER_KEY_V1
# 16-byte lookup salt, base64
openssl rand -base64 16   # -> CRYPTO_LOOKUP_SALT
```

```
CRYPTO_MASTER_KEY_V1=<base64 32 bytes>
CRYPTO_LOOKUP_SALT=<base64 16 bytes>
MASTER_KEY_VERSION=1
# CRYPTO_SECRET_BACKEND defaults to 'env' outside production.
```

> The `smoke:c5` script injects its OWN test provider, so it does NOT need these.
> The running app (UI + Server Actions) DOES.

### 0.2 Production secrets (Google Secret Manager)
In prod set `CRYPTO_SECRET_BACKEND=gcp`, `GCP_PROJECT_ID`,
`GCP_SECRET_MASTER_KEY_NAME`, `GCP_SECRET_LOOKUP_SALT_NAME`, and install the
optional dep: `pnpm add @google-cloud/secret-manager`. Master key versions are
GCP secret versions (1, 2, …). NEVER put the master key in `.env` in prod (§5.7).

### 0.3 Supabase Storage bucket (LGPD export)
Create a **private** bucket named `lgpd-exports` (no public access). Downloads
happen only via the 7-day signed URL the export handler writes onto
`lgpd_requests.export_signed_url`.

## 1. Migration

```bash
pnpm db:generate     # (only if schema changed; migration 0011 is hand-authored)
pnpm db:migrate:dev  # applies 0011_patient_core.sql
```

## 2. Automated checks (must all pass)

```bash
pnpm typecheck
pnpm lint
pnpm arch:db-check
pnpm check:registry          # 2 handlers (lgpd export/delete); 6 producer-only events WARN (consumed by future contexts — not strict)
pnpm test                    # crypto unit tests (round-trip, cross-tenant, CPF checksum)
pnpm smoke:c5                # DB-level 5.6.x — see below
```

`smoke:c5` covers, against qoro-dev (self-contained fixtures, auto-cleanup):
- **5.6.1** encryption at-rest — ciphertext is base64, version byte = 1, no plaintext CPF/phone in the row.
- **5.6.2** CPF lookup via hash.
- **5.6.3** cross-tenant decrypt fails (auth tag).
- **5.6.4** soft delete hides from `patientsActive`.
- **5.6.5** hard-delete cascade — children removed, `suppression_list` survives.
- **5.6.6** export bundle is decrypted AND clinic B cannot export clinic A's patient (RLS).
- **5.6.9** UNIQUE (clinic_id, cpf_hash) — dup blocked in same clinic, allowed in another.

## 3. Manual checks (running app / external)

### 3.1 — pg_dump has no plaintext (5.6.1 final)
After creating a patient through the UI with CPF `123.456.789-00`:
```bash
pg_dump "$DATABASE_URL" --data-only --table=patients | grep -F '12345678900' ; echo "exit=$?"
pg_dump "$DATABASE_URL" --data-only --table=patients | grep -F '99999-9999' ; echo "exit=$?"
```
Expected: no matches (grep exit=1). ✋ Any match = encryption failed.

### 3.2 — Audit captures update, omits sensitive (5.6.7)
Edit a patient's `nome` in the UI. Then:
```sql
SELECT action, before->>'nome' AS before_nome, after->>'nome' AS after_nome,
       (before ? 'cpf_encrypted') AS has_cpf
FROM audit_events WHERE action = 'patient.core.updated' ORDER BY created_at DESC LIMIT 1;
```
Expected: before/after show the name change; `has_cpf = false` (encrypted/hash fields never in audit).

### 3.3 — Permission check (5.6.10)
As an `attendant` (no `delete:patient`), attempt delete → 403 (`requireFreshPermission`).
Grant via `user_permission_overrides` → succeeds.

### 3.4 — Idempotency (5.6.11)
Double-submit "create patient" with the same client `idempotencyKey` → 1 row, second call returns cached.
Change a field but reuse the key → `IdempotencyConflictError` (409).

### 3.5 — LGPD export end-to-end (5.6.6 full)
1. Trigger `requestLgpdExport(patientId, key)` from the UI.
2. Run the worker: `GET /api/cron/outbox` (or `pnpm smoke:c4` style invocation).
3. `SELECT status, export_signed_url, export_signed_url_expires_at FROM lgpd_requests WHERE type='export' ORDER BY created_at DESC LIMIT 1;` → `completed`, URL present, expiry +7d.
4. Download the PDF/JSON via the signed URL → contains decrypted CPF/phone/address.
5. Email is **stubbed** (logged): expect `[lgpd-export] email send stubbed` in worker logs.

### 3.6 — LGPD delete + hard-delete cron (5.6.5 full)
1. `requestLgpdDelete(patientId, key)` → patient soft-deleted, suppressed, `lgpd_requests` delete row, event emitted.
2. Simulate window: `UPDATE patients SET deleted_at = now() - interval '31 days' WHERE id = '<id>';`
3. `GET /api/cron/patient-hard-delete` (Bearer CRON_SECRET) → patient + children gone (cascade), `suppression_list` remains, audit PII (`nome`/`email`) stripped, action trail retained.

## 4. §5.7 stability checklist
- [x] All patient logic in `src/contexts/patient/`; only generic crypto/audit/outbox in `src/lib`.
- [x] No cross-context schema imports (only `@/contexts/tenancy` public surface for `tenantIdRef`, sanctioned exception).
- [x] No cross-context SQL JOINs.
- [x] Crypto helpers always require `clinicId`.
- [x] Master key not in plaintext `.env` in production (Secret Manager backend).
- [x] Encryption version byte embedded (rotation-ready).
- [x] `getPatientWithDecryptedFields` / `collectExportBundle` are the only decrypt points.
- [x] Audit never includes `*_encrypted`; before/after built from non-sensitive projection + `SENSITIVE_KEYS`.
- [x] Hard-delete cron is bounded by `LIMIT`.

## 5. Deferred (not C5 scope)
- **5.6.8** suppression blocks outbound — verified in C14 (AI Agent) when proactive messaging exists; `suppression_list` is keyed by `contact_hash` for that check.
