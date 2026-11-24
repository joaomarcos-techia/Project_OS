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

/** A saga controla transações curtas por fase, sem uma TX externa longa. */
export type DetachedHandlerCtx<TPayload> = Omit<HandlerCtx<TPayload>, 'tx'>;
export type DetachedHandler<TPayload> = (ctx: DetachedHandlerCtx<TPayload>) => Promise<void>;

export type RegisteredHandler<TPayload> =
  | { execution: 'transactional'; handler: Handler<TPayload> }
  | { execution: 'detached'; handler: DetachedHandler<TPayload> };

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
  /**
   * M20 — distributed-tracing correlation id. Optional + additive: existing
   * producers omit it (column nullable). Threaded so one logical operation is
   * traceable across Scheduling → Clinical → Financial → AI → Webhook.
   */
  correlationId?: string | null;
};

/**
 * Worker tick summary. Returned by `runOutboxOnce` and surfaced both in the
 * cron route response (JSON) and as a `worker.tick` metric.
 */
export type WorkerTickSummary = {
  processed: number;
  failed: number;
  /**
   * F-03: events terminally `skipped` (in catalog, no registered handler). NOT
   * failures — they never retry. DB status='skipped'. Distinct from `empty`.
   */
  skipped: number;
  /** Reserve slots that found no pending row (processOne returned 'empty'). */
  empty: number;
  stuck_reclaimed: number;
  circuit_paused: number;
  duration_ms: number;
  /**
   * R61 (opcional, só com `reserveUntil`): vagas do lote que NÃO reservaram evento porque o
   * prazo de reserva da invocação passou. Os eventos continuam `pending` para o próximo tick.
   */
  deferred?: number;
  /**
   * R61 (opcional, só com `skipUnhandledInBulk`): eventos do catálogo SEM handler registrado
   * finalizados como `skipped` em bloco, no início do tick, sem ocupar vaga do lote.
   */
  skipped_bulk?: number;
};

/** Outcome of a single processOne() invocation (exhaustive). */
export type ProcessOneResult = 'empty' | 'processed' | 'failed' | 'skipped' | 'deferred';
