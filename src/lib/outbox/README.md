# lib/outbox

Outbox pattern para eventos cross-context. Emissão transacional + worker dedicado.

**Status:** vazio. **Camada:** C4 preenche.

C4 vai criar:
- Tabela `outbox_events` (id, type, clinic_id, payload jsonb, idempotency_key, status, attempts, created_at, processed_at)
- `emit.ts` com `emitEvent(tx, { type, clinicId, payload, idempotencyKey })`
- `worker.ts` com loop `FOR UPDATE SKIP LOCKED` + retry exponencial
- `register.ts` com mapeamento `type -> handler` (handlers vivem em `<context>/internal/handlers/`)
