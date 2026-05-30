# lib/outbox

Outbox pattern para eventos cross-context (C4).

## API pública

- [publish.ts](./publish.ts) — `publishEvent(tx, args)` é o **único** ponto de emissão. Insere row em outbox na MESMA tx da business mutation. Atomicidade total: rollback do caller rola o evento também.
- [catalog.ts](./catalog.ts) — `registerEventSchema(eventType, schema)` / `getEventSchema(eventType)`. Producer-side. Populado pelos `<context>/events.ts` ao serem importados.
- [registry.ts](./registry.ts) — `registerHandler(eventType, handler)` / `getHandler(eventType)`. Consumer-side. Populado apenas pelo boot file `src/app/api/cron/outbox/handlers.ts` que importa cada `<context>/internal/handlers/*`.
- [worker.ts](./worker.ts) — `runOutboxOnce({ batchSize, parallelism })`. Cron-friendly. 3 TXs por evento; SKIP LOCKED para concorrência.
- [janitor.ts](./janitor.ts) — `reclaimStuckProcessing()`. Reclama rows presas em `processing` > 5min.
- [circuit.ts](./circuit.ts) — `applyCircuitBreaker()`. Pausa events de tipos tóxicos (≥10 failures em 5min).
- [backoff.ts](./backoff.ts) — `backoffDelayMs(attempt)`. Schedule frozen: `[0, 30s, 5m, 30m, 6h, FAIL]`.
- [errors.ts](./errors.ts) — `HandlerError(msg, code)` para handlers categorizarem falha; `serializeError` capped + production-safe.
- [types.ts](./types.ts) — `Handler<T>`, `HandlerCtx<T>`, `PublishEventArgs<T>`, `WorkerTickSummary`.

## Contratos (ADR-011)

- **enqueue exactly-once** (UNIQUE constraint + INSERT em mesma TX da mutação)
- **delivery at-least-once** (Vercel Cron best-effort + retry com backoff)
- **handlers MUST be idempotent** (não negociável — dedup via idempotency_keys do destino)
- **producer não conhece handler runtime** (catalog separado de registry → deploy ordering safe)

## Como escrever um handler (a partir de C5)

1. **Definir schema do evento** em `src/contexts/<X>/events.ts`:

   ```ts
   import { z } from 'zod';
   import { registerEventSchema } from '@/lib/outbox/catalog';

   export const PatientCreatedSchema = z.object({
     patientId: z.string().uuid(),
     clinicId: z.string().uuid(),
   });
   export type PatientCreated = z.infer<typeof PatientCreatedSchema>;

   registerEventSchema('patient.patient.created', PatientCreatedSchema);
   ```

2. **Escrever handler** em `src/contexts/<X>/internal/handlers/patient-created.ts`:

   ```ts
   import { registerHandler } from '@/lib/outbox/registry';
   import { PatientCreatedSchema } from '@/contexts/patient/events';

   registerHandler('patient.patient.created', async ({ tx, clinicId, payload }) => {
     // tx is `withTenant(clinicId)` scoped — RLS aplica.
     // Handler MUST be idempotent (delivery is at-least-once).
   });
   ```

3. **Importar handler no boot file** `src/app/api/cron/outbox/handlers.ts`:

   ```ts
   import '@/contexts/patient/internal/handlers/patient-created';
   ```

4. **Publicar evento** em uma Server Action via `idempotentMutation`:

   ```ts
   await publishEvent(tx, {
     clinicId,
     eventType: 'patient.patient.created',
     payload: { patientId, clinicId },
     idempotencyKey: crypto.randomUUID(),
   });
   ```

## Failure modes

Veja [docs/adr/011-outbox-audit-idempotency-patterns.md](../../../docs/adr/011-outbox-audit-idempotency-patterns.md) e [docs/runbooks/c4-validation.md](../../../docs/runbooks/c4-validation.md).
