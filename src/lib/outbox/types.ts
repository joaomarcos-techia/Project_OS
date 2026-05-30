import type { Tx } from '@/lib/db';

/**
 * Handler invocation context.
 *
 * - `tx` — the active transaction opened by `withTenant(clinicId)` inside the
 *   worker's TX2. Handler MUST use this tx for every query (no `db.…` direct).
 * - `clinicId` — the tenant the event belongs to. Already set on
 *   `app.current_clinic` via SET LOCAL in TX2; available here for handler-side
 *   branching.
 * - `payload` — Zod-parsed payload, narrowed to the handler's schema type.
 * - `eventId` — globally unique ID of the outbox row driving this invocation.
 *   **MUST be used as the dedup key** for any INSERTs the handler makes
 *   (`ON CONFLICT (event_id) DO NOTHING`) and as the idempotency-key for any
 *   external API call (Stripe, Meta, etc.). Without this discipline, at-least-once
 *   delivery causes duplicate writes / duplicate side-effects (ADR-011 §26).
 * - `attempt` — 1-indexed retry count. attempt=1 means first delivery; ≥2 means
 *   prior attempt failed and we are retrying. Handlers MAY branch on attempt
 *   (e.g. fall back to a slower path on the 5th attempt before failing for good).
 */
export type HandlerCtx<TPayload> = {
  tx: Tx;
  clinicId: string;
  payload: TPayload;
  eventId: string;
  attempt: number;
};

export type Handler<TPayload> = (ctx: HandlerCtx<TPayload>) => Promise<void>;

/**
 * `publishEvent` arguments. `idempotencyKey` is client-generated (UUID v7
 * recommended) and combined with `eventType` enforces exactly-once enqueue
 * via the UNIQUE constraint on (event_type, idempotency_key).
 */
export type PublishEventArgs<TPayload = unknown> = {
  clinicId: string;
  eventType: string;
  payload: TPayload;
  idempotencyKey: string;
};

/**
 * Worker tick summary. Returned by `runOutboxOnce` and surfaced both in the
 * cron route response (JSON) and as a `worker.tick` metric.
 */
export type WorkerTickSummary = {
  processed: number;
  failed: number;
  skipped: number;
  stuck_reclaimed: number;
  circuit_paused: number;
  duration_ms: number;
};
