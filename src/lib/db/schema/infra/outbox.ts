/**
 * outbox — cross-context event queue (C4).
 *
 * Categoria (ADR-007 §10): tenant-scoped (clinic_id FK).
 * Frozen contracts (ADR-011):
 *   - Append-only para tenant. INSERT permitido via RLS; UPDATE/DELETE BLOQUEADOS
 *     (sem policy + FORCE RLS). O worker faz UPDATE de status/attempts via dbAdmin
 *     (BYPASSRLS pool) — pattern idêntico a _reserved_slugs e login_attempts.
 *   - DLQ metadata (first_failed_at, last_failed_at, error_code) povoada pelo worker
 *     em cada falha; first_failed_at é set apenas na primeira falha.
 *   - last_error CAP 4000 chars em TS (serializeError truncate) + CHECK defensivo
 *     octet_length <= 8192 nesta tabela.
 *   - event_type formato '<context>.<entity>.<action>' enforced via CHECK regex.
 *   - error_code formato snake_case curto enforced via CHECK regex.
 *   - processing_started_at é preenchida em TX1 (reserve) e zerada em TX3 (finalize).
 *     Janitor reclama rows com processing > 5min para 'pending'.
 *   - UNIQUE (event_type, idempotency_key) garante exactly-once enqueue.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenantId, uuidPk } from '@/lib/db/types';

// F-03: 'skipped' is a TERMINAL state for an event that is in the catalog but
// has NO registered handler (a legitimate "producer ahead of consumer" event).
// It is NOT a failure — it never retries and never trips the circuit breaker.
export const outboxStatus = pgEnum('outbox_status', [
  'pending',
  'processing',
  'processed',
  'failed',
  'skipped',
]);

/** Single source of truth for the outbox status union (exhaustiveness checks). */
export type OutboxStatus = (typeof outboxStatus.enumValues)[number];

export const outbox = pgTable(
  'outbox',
  {
    id: uuidPk(),
    clinicId: tenantId(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    // HIGH-16: hash sha256-hex do payload canonicalizado. Permite a publishEvent
    // detectar collision (mesmas (event_type, idempotency_key) com payloads
    // diferentes = bug do caller) e tomar ação explícita em vez de silenciar.
    payloadHash: text('payload_hash').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    // M20: tracing cross-context. Nullable/aditivo — produtores antigos omitem.
    correlationId: uuid('correlation_id'),
    status: outboxStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    errorCode: text('error_code'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    firstFailedAt: timestamp('first_failed_at', { withTimezone: true }),
    lastFailedAt: timestamp('last_failed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    eventTypeIdempotencyKeyUniq: uniqueIndex('outbox_event_type_idempotency_key_uniq').on(
      t.eventType,
      t.idempotencyKey,
    ),
    dispatchIdx: index('outbox_dispatch_idx')
      .on(t.nextAttemptAt, t.createdAt)
      .where(sql`status = 'pending'`),
    processingAgeIdx: index('outbox_processing_age_idx')
      .on(t.processingStartedAt)
      .where(sql`status = 'processing'`),
    circuitIdx: index('outbox_circuit_idx')
      .on(t.eventType, t.lastFailedAt)
      .where(sql`status = 'failed'`),
    clinicCreatedIdx: index('outbox_clinic_created_idx').on(t.clinicId, t.createdAt),
    eventTypeFormatChk: check(
      'outbox_event_type_format_chk',
      sql`${t.eventType} ~ '^[a-z_][a-z0-9_]*\\.[a-z_][a-z0-9_]*\\.[a-z_][a-z0-9_]*$'`,
    ),
    lastErrorSizeChk: check(
      'outbox_last_error_size_chk',
      sql`${t.lastError} IS NULL OR octet_length(${t.lastError}) <= 8192`,
    ),
    errorCodeFormatChk: check(
      'outbox_error_code_format_chk',
      sql`${t.errorCode} IS NULL OR ${t.errorCode} ~ '^[a-z_][a-z0-9_]{0,63}$'`,
    ),
    // HIGH-16: hash format (sha256 hex)
    payloadHashFormatChk: check(
      'outbox_payload_hash_format_chk',
      sql`${t.payloadHash} ~ '^[a-f0-9]{64}$'`,
    ),
    // HIGH-07: defense in depth against payload explosion
    payloadSizeChk: check(
      'outbox_payload_size_chk',
      sql`pg_column_size(${t.payload}) <= 65536`,
    ),
    // MEDIUM-23: temporal coherence — defense against worker bugs / manual replay
    temporalChk: check(
      'outbox_temporal_chk',
      sql`(${t.processingStartedAt} IS NULL OR ${t.processingStartedAt} >= ${t.createdAt})
       AND (${t.processedAt} IS NULL OR ${t.processedAt} >= ${t.createdAt})
       AND (${t.firstFailedAt} IS NULL OR ${t.firstFailedAt} >= ${t.createdAt})
       AND (${t.lastFailedAt} IS NULL OR ${t.lastFailedAt} >= ${t.createdAt})
       AND (${t.firstFailedAt} IS NULL OR ${t.lastFailedAt} IS NULL OR ${t.lastFailedAt} >= ${t.firstFailedAt})`,
    ),
  }),
);

export type OutboxRow = typeof outbox.$inferSelect;
export type OutboxInsert = typeof outbox.$inferInsert;
